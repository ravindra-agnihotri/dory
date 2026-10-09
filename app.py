"""
Dory's Bakehouse: website + admin backend.

Serves the public site, generates /content.js from the saved content, and provides a
password-protected admin panel at /admin for editing text and uploading photos.

Storage
  - Text content: Postgres when DATABASE_URL is set (needed on Vercel), else data/content.json.
  - Photos: Cloudinary when CLOUDINARY_URL is set (needed on Vercel), else data/uploads/.
    With Cloudinary, the browser uploads photos straight to Cloudinary using a signature
    from this server, so large phone photos never pass through the server.

Run locally: put your settings in a .env file (see .env.example), then
    pip install -r requirements.txt
    python3 app.py
"""
import encodings.idna  # noqa: F401. Loaded up front: the startup warm-up thread and the first request both need it, and loading it lazily made them wait on each other
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

try:  # local development: read settings from .env
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

from flask import Flask, Response, abort, jsonify, redirect, request, send_from_directory, session
from markupsafe import escape

BASE = Path(__file__).resolve().parent
SITE_DIR = BASE / "public"          # public site; on Vercel these are served straight from the CDN
ADMIN_DIR = BASE / "admin"
DEFAULT_CONTENT = BASE / "default_content.json"

ON_VERCEL = bool(os.environ.get("VERCEL"))
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or ""
USE_DB = bool(DATABASE_URL)
USE_CLOUDINARY = bool(os.environ.get("CLOUDINARY_URL"))
def _folder_env(name, default=""):
    """Folder names from settings, forgiving common typos: spaces, quotes, leading/trailing slashes."""
    return os.environ.get(name, "").strip().strip("\"'").strip().strip("/") or default


CLOUDINARY_FOLDER = _folder_env("CLOUDINARY_FOLDER", "dorys-bakehouse")
# The Gallery page shows every photo in this Cloudinary folder. Set CLOUDINARY_GALLERY_FOLDER
# to use a folder you already have (e.g. "dory-gallery"); otherwise it's "<CLOUDINARY_FOLDER>/gallery".
GALLERY_FOLDER = _folder_env("CLOUDINARY_GALLERY_FOLDER") or f"{CLOUDINARY_FOLDER}/gallery"
MAX_UPLOAD_MB = 12
MAX_IMAGE_PX = 1800
KEEP_HISTORY = 30

if ON_VERCEL and not (USE_DB and USE_CLOUDINARY and os.environ.get("SECRET_KEY")):
    raise RuntimeError(
        "On Vercel, set DATABASE_URL, CLOUDINARY_URL and SECRET_KEY in Project → Settings → "
        "Environment Variables. Vercel has no permanent disk, so content and photos can't be kept locally."
    )

# File storage (local development / hosts with a disk)
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
HISTORY_DIR = DATA_DIR / "history"
CONTENT_FILE = DATA_DIR / "content.json"
if not USE_DB or not USE_CLOUDINARY:
    for d in (UPLOAD_DIR, HISTORY_DIR):
        d.mkdir(parents=True, exist_ok=True)

if USE_CLOUDINARY:
    import cloudinary
    import cloudinary.api
    import cloudinary.uploader
    import cloudinary.utils
    import cloudinary.search  # noqa: F401  (cloudinary.Search)
    cloudinary.config(secure=True)  # reads CLOUDINARY_URL from the environment
    # Hosts that force outbound traffic through a proxy (e.g. PythonAnywhere free: http://proxy.server:3128).
    _proxy = os.environ.get("CLOUDINARY_API_PROXY")
    if _proxy:
        cloudinary.config(api_proxy=_proxy)


def _secret_key():
    """Stable secret key: env var, else one generated once and kept in data/ (local only)."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    key_file = DATA_DIR / ".secret_key"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not key_file.exists():
        key_file.write_text(secrets.token_hex(32))
    return key_file.read_text().strip()


app = Flask(__name__, static_folder=None)
app.config.update(
    SECRET_KEY=_secret_key(),
    MAX_CONTENT_LENGTH=MAX_UPLOAD_MB * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_SECURE=ON_VERCEL or os.environ.get("HTTPS", "0") == "1",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 14,  # stay logged in 14 days
)


def _default_content():
    return json.loads(DEFAULT_CONTENT.read_text(encoding="utf-8"))


# ======================================================= content storage
class DBStore:
    """Postgres (Neon, Supabase, …). Tables are created on first use."""

    def __init__(self, url):
        import psycopg
        from psycopg.types.json import Jsonb
        self.psycopg, self.Jsonb, self.url, self.ready = psycopg, Jsonb, url, False

    _schema_lock = threading.Lock()

    def conn(self):
        # prepare_threshold=None: no server-side prepared statements, so this works through
        # Supabase's poolers (the transaction pooler rejects them) as well as Neon or plain Postgres.
        c = self.psycopg.connect(self.url, autocommit=False, connect_timeout=10, prepare_threshold=None)
        if not self.ready:
            with self._schema_lock, c.cursor() as cur:
                # The advisory lock stops two server processes creating the tables at the same
                # moment (Postgres' IF NOT EXISTS isn't safe against that race).
                cur.execute("SELECT pg_advisory_xact_lock(727274)")
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS site_content (
                        id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
                    CREATE TABLE IF NOT EXISTS content_history (
                        id bigserial PRIMARY KEY, data jsonb NOT NULL, saved_at timestamptz NOT NULL DEFAULT now());
                    CREATE TABLE IF NOT EXISTS login_failures (
                        ip text PRIMARY KEY, count int NOT NULL, first_at double precision NOT NULL);
                    -- Supabase publishes tables in the public schema through its web API. Row-level
                    -- security with no policies blocks that API; this app connects as the tables'
                    -- owner, which isn't affected. On Neon or plain Postgres this changes nothing.
                    ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE content_history ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE login_failures ENABLE ROW LEVEL SECURITY;
                    -- Customer reminders: never published, only read through the signed-in admin API
                    CREATE TABLE IF NOT EXISTS private_data (
                        key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
                    ALTER TABLE private_data ENABLE ROW LEVEL SECURITY;
                """)
            c.commit()
            self.ready = True
        return c

    def load(self):
        with self.conn() as c, c.cursor() as cur:
            cur.execute("SELECT data FROM site_content WHERE id = 1")
            row = cur.fetchone()
            if row:
                return row[0]
            data = _default_content()
            cur.execute("INSERT INTO site_content (id, data) VALUES (1, %s) ON CONFLICT (id) DO NOTHING",
                        (self.Jsonb(data),))
            return data

    def save(self, data):
        with self.conn() as c, c.cursor() as cur:  # one transaction: backup + save + trim
            cur.execute("INSERT INTO content_history (data) SELECT data FROM site_content WHERE id = 1")
            cur.execute("""INSERT INTO site_content (id, data, updated_at) VALUES (1, %s, now())
                           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()""",
                        (self.Jsonb(data),))
            cur.execute("""DELETE FROM content_history WHERE id NOT IN
                           (SELECT id FROM content_history ORDER BY id DESC LIMIT %s)""", (KEEP_HISTORY,))

    def history(self):
        with self.conn() as c, c.cursor() as cur:
            cur.execute("SELECT id, saved_at FROM content_history ORDER BY id DESC")
            return [{"id": str(i), "saved": t.isoformat()} for i, t in cur.fetchall()]

    def version(self, vid):
        if not vid.isdigit():
            return None
        with self.conn() as c, c.cursor() as cur:
            cur.execute("SELECT data FROM content_history WHERE id = %s", (int(vid),))
            row = cur.fetchone()
            return row[0] if row else None

    def private_get(self, key, default):
        with self.conn() as c, c.cursor() as cur:
            cur.execute("SELECT data FROM private_data WHERE key = %s", (key,))
            row = cur.fetchone()
            return row[0] if row else default

    def private_update(self, key, default, fn):
        """Read-modify-write in one transaction with a row lock, so the website's opt-in form and
        the admin can't overwrite each other's changes."""
        with self.conn() as c, c.cursor() as cur:
            cur.execute("INSERT INTO private_data (key, data) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
                        (key, self.Jsonb(default)))
            cur.execute("SELECT data FROM private_data WHERE key = %s FOR UPDATE", (key,))
            data, result = fn(cur.fetchone()[0])
            cur.execute("UPDATE private_data SET data = %s, updated_at = now() WHERE key = %s", (self.Jsonb(data), key))
            return result

    # login throttling must be shared: serverless runs many copies of the app
    def failures(self, ip):
        with self.conn() as c, c.cursor() as cur:
            cur.execute("SELECT count, first_at FROM login_failures WHERE ip = %s", (ip,))
            row = cur.fetchone()
            return (row[0], row[1]) if row else (0, time.time())

    def set_failures(self, ip, count, first):
        with self.conn() as c, c.cursor() as cur:
            if count == 0:
                cur.execute("DELETE FROM login_failures WHERE ip = %s", (ip,))
            else:
                cur.execute("""INSERT INTO login_failures (ip, count, first_at) VALUES (%s, %s, %s)
                               ON CONFLICT (ip) DO UPDATE SET count = EXCLUDED.count, first_at = EXCLUDED.first_at""",
                            (ip, count, first))


class FileStore:
    """data/content.json plus timestamped backups in data/history/."""

    def __init__(self):
        self._fail = {}

    def load(self):
        if not CONTENT_FILE.exists():
            shutil.copy(DEFAULT_CONTENT, CONTENT_FILE)
        return json.loads(CONTENT_FILE.read_text(encoding="utf-8"))

    def save(self, data):
        if CONTENT_FILE.exists():
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
            shutil.copy(CONTENT_FILE, HISTORY_DIR / f"content-{stamp}.json")
            for f in sorted(HISTORY_DIR.glob("content-*.json"))[:-KEEP_HISTORY]:
                f.unlink()
        tmp = CONTENT_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(CONTENT_FILE)  # atomic: a crash mid-save never corrupts the file

    def history(self):
        out = []
        for f in sorted(HISTORY_DIR.glob("content-*.json"), reverse=True):
            stamp = f.stem.replace("content-", "")
            try:
                saved = datetime.strptime(stamp[:15], "%Y%m%d-%H%M%S").isoformat()
            except ValueError:
                continue
            out.append({"id": stamp, "saved": saved})
        return out

    def version(self, vid):
        f = HISTORY_DIR / f"content-{vid}.json"
        if not vid.replace("-", "").isdigit() or not f.exists():
            return None
        return json.loads(f.read_text(encoding="utf-8"))

    _private_lock = threading.Lock()

    def _pfile(self, key):
        d = DATA_DIR / "private"
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{key}.json"

    def private_get(self, key, default):
        f = self._pfile(key)
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else default

    def private_update(self, key, default, fn):
        with self._private_lock:
            data, result = fn(self.private_get(key, default))
            f = self._pfile(key)
            tmp = f.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(f)
            return result

    def failures(self, ip):
        return self._fail.get(ip, (0, time.time()))

    def set_failures(self, ip, count, first):
        if count == 0:
            self._fail.pop(ip, None)
        else:
            self._fail[ip] = (count, first)


store = DBStore(DATABASE_URL) if USE_DB else FileStore()

REQUIRED_KEYS = {"name", "contact", "hours", "special", "menu", "highlights", "about", "cakes", "gallery"}


def validate(data):
    if not isinstance(data, dict):
        return "Content must be an object."
    missing = REQUIRED_KEYS - data.keys()
    if missing:
        return "Missing sections: " + ", ".join(sorted(missing))
    embed = (data.get("contact") or {}).get("mapEmbed", "")
    if embed and not embed.startswith("https://www.google.com/maps/embed"):
        return "The map embed link must start with https://www.google.com/maps/embed"
    glink = str((data.get("reviews") or {}).get("googleLink") or "").strip()
    if glink and not glink.startswith("https://"):
        return "The Google review link must start with https://"
    if len(json.dumps(data)) > 500_000:
        return "Content is too large."
    return None


# ================================================================= auth
def logged_in():
    return session.get("admin") is True


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not logged_in():
            return jsonify(error="Log in to continue."), 401
        # CSRF guard: browsers can't add this header on cross-site requests
        if request.method != "GET" and request.headers.get("X-Admin") != "1":
            return jsonify(error="Bad request."), 400
        return fn(*a, **kw)
    return wrapper


def client_ip():
    return (request.headers.get("X-Forwarded-For") or request.remote_addr or "").split(",")[0].strip()


@app.post("/api/login")
def login():
    ip = client_ip()
    count, first = store.failures(ip)
    if time.time() - first >= 15 * 60:
        count, first = 0, time.time()
    if count >= 5:
        return jsonify(error="Too many wrong attempts. Try again in 15 minutes."), 429
    if not ADMIN_PASSWORD:
        return jsonify(error="Admin password isn't set on the server (ADMIN_PASSWORD)."), 500
    pw = str((request.get_json(silent=True) or {}).get("password", ""))
    if hmac.compare_digest(pw.encode(), ADMIN_PASSWORD.encode()):
        store.set_failures(ip, 0, 0)
        session.clear()
        session.permanent = True
        session["admin"] = True
        return jsonify(ok=True)
    store.set_failures(ip, count + 1, first)
    return jsonify(error="Wrong password."), 401


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    return jsonify(loggedIn=logged_in(), directUpload=USE_CLOUDINARY)


# ============================================================ admin API
@app.get("/api/content")
@admin_required
def get_content():
    return jsonify(store.load())


@app.put("/api/content")
@admin_required
def put_content():
    data = request.get_json(silent=True)
    err = validate(data)
    if err:
        return jsonify(error=err), 400
    store.save(data)
    refresh_content_cache()
    return jsonify(ok=True)


@app.get("/api/history")
@admin_required
def history():
    return jsonify(store.history())


@app.post("/api/history/<vid>/restore")
@admin_required
def restore(vid):
    data = store.version(vid)
    if data is None:
        abort(404)
    store.save(data)
    refresh_content_cache()
    return jsonify(ok=True)


# ---------------------------------------------------------------- photos
def delivery_url(secure_url):
    # f_auto,q_auto: WebP/AVIF at the right quality per browser; c_limit,w_1800 caps huge originals
    return secure_url.replace("/image/upload/", "/image/upload/f_auto,q_auto,c_limit,w_1800/", 1)


@app.post("/api/upload-signature")
@admin_required
def upload_signature():
    """Signs one direct browser → Cloudinary upload. The API secret never leaves the server."""
    if not USE_CLOUDINARY:
        abort(404)
    cfg = cloudinary.config()
    folder = GALLERY_FOLDER if (request.get_json(silent=True) or {}).get("target") == "gallery" else CLOUDINARY_FOLDER
    params = {
        "timestamp": int(time.time()),
        "public_id": uuid.uuid4().hex[:12],
        "folder": folder,            # accounts using "fixed folders"
        "asset_folder": folder,      # accounts using "dynamic folders" (newer accounts)
        "overwrite": "false",
        "transformation": "c_limit,w_2400,h_2400",  # store at most 2400px; originals from phones are larger
    }
    params["signature"] = cloudinary.utils.api_sign_request(params, cfg.api_secret)
    return jsonify(url=f"https://api.cloudinary.com/v1_1/{cfg.cloud_name}/image/upload",
                   apiKey=cfg.api_key, params=params)


@app.post("/api/uploaded")
@admin_required
def uploaded():
    """Called after a direct upload: turns Cloudinary's URL into the delivery URL the site uses."""
    url = str((request.get_json(silent=True) or {}).get("secureUrl", ""))
    cloud = cloudinary.config().cloud_name if USE_CLOUDINARY else ""
    if not url.startswith(f"https://res.cloudinary.com/{cloud}/image/upload/"):
        return jsonify(error="That isn't a photo from this Cloudinary account."), 400
    _gallery_cache["at"] = 0  # show new gallery photos straight away
    refresh_content_cache()
    return jsonify(src=delivery_url(url))


@app.post("/api/upload")
@admin_required
def upload():
    """Local-storage uploads (used only when Cloudinary isn't configured)."""
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass
    files = request.files.getlist("photo")
    if not files:
        return jsonify(error="Choose a photo to upload."), 400
    saved = []
    for f in files:
        try:
            img = ImageOps.exif_transpose(Image.open(f.stream))  # fix sideways phone photos
        except (UnidentifiedImageError, OSError):
            return jsonify(error=f"{f.filename} isn't a photo we can read. Use JPG, PNG, WEBP or HEIC."), 400
        img.thumbnail((MAX_IMAGE_PX, MAX_IMAGE_PX))
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        name = f"{uuid.uuid4().hex[:12]}.{'png' if has_alpha else 'jpg'}"
        if has_alpha:
            img.save(UPLOAD_DIR / name, "PNG", optimize=True)
        else:
            img.convert("RGB").save(UPLOAD_DIR / name, "JPEG", quality=85, optimize=True, progressive=True)
        saved.append("uploads/" + name)
    return jsonify(files=saved)


@app.errorhandler(413)
def too_big(_):
    return jsonify(error=f"That upload is too large. Keep each batch under {MAX_UPLOAD_MB} MB."), 413


# --------------------------------------------- gallery = Cloudinary folder
GALLERY_CACHE_SECONDS = 300  # photos added in Cloudinary appear within 5 minutes; keeps API usage low
_gallery_cache = {"items": None, "at": 0.0, "error": None, "report": []}


def _fetch_all(call, *args, **opts):
    """Follow Cloudinary's next_cursor so folders with more than 500 photos are fully listed."""
    out, cursor = [], None
    for _ in range(20):  # hard stop at 10,000 photos
        res = call(*args, **opts, **({"next_cursor": cursor} if cursor else {}))
        out.extend(res.get("resources", []))
        cursor = res.get("next_cursor")
        if not cursor:
            break
    return out


def _search(expression):
    def call(**opts):
        q = (cloudinary.Search().expression(expression).with_field("context")
             .max_results(opts.get("max_results", 500)))
        if opts.get("next_cursor"):
            q = q.next_cursor(opts["next_cursor"])
        return q.execute()
    return call


def _listing_methods(folder):
    """Every way Cloudinary can list a folder. Which ones work depends on the account:
    newer accounts ("dynamic folders") use asset_folder; older ones put the folder in the public_id."""
    return [
        ("asset folder", cloudinary.api.resources_by_asset_folder, (folder,), {}),
        ("public ID prefix", cloudinary.api.resources, (),
         {"type": "upload", "resource_type": "image", "prefix": folder + "/"}),
        ("search", _search(f'resource_type:image AND (asset_folder="{folder}" OR folder="{folder}")'), (), {}),
    ]


def _list_folder():
    """Every photo in GALLERY_FOLDER, merged from all listing methods that work on this account.
    Returns (items, report) where report says what each method found or why it failed."""
    opts = dict(max_results=500, context=True)
    found, report = {}, []
    for name, call, args, kw in _listing_methods(GALLERY_FOLDER):
        try:
            rows = _fetch_all(call, *args, **kw, **opts)
            for r in rows:
                found.setdefault(r["public_id"], r)
            report.append({"method": name, "found": len(rows)})
        except Exception as e:  # not supported on this account, or rejected: the others may still work
            report.append({"method": name, "error": f"{type(e).__name__}: {e}"})
    if found == {} and all("error" in r for r in report):
        raise RuntimeError("; ".join(f"{r['method']}: {r['error']}" for r in report))
    items = []
    for r in found.values():
        if r.get("resource_type", "image") != "image":
            continue
        custom = (r.get("context") or {}).get("custom") or r.get("context") or {}
        if not isinstance(custom, dict):
            custom = {}
        items.append({"id": r["public_id"], "src": delivery_url(r["secure_url"]),
                      "caption": custom.get("caption") or custom.get("alt") or "",
                      "created": r.get("created_at", "")})
    items.sort(key=lambda i: i["created"], reverse=True)  # newest first
    return items, report


def cloud_gallery(refresh=False):
    """Cached list of gallery photos. Never raises: on error, serves the last good list."""
    fresh = time.time() - _gallery_cache["at"] < GALLERY_CACHE_SECONDS
    if _gallery_cache["items"] is not None and fresh and not refresh:
        return _gallery_cache["items"]
    try:
        items, report = _list_folder()
        _gallery_cache.update(items=items, at=time.time(), error=None, report=report)
        failed = [r for r in report if "error" in r]
        if failed and not items:
            app.logger.warning("Cloudinary gallery '%s' is empty; failed methods: %s", GALLERY_FOLDER, failed)
    except Exception as e:
        _gallery_cache["error"] = str(e)
        app.logger.error("Couldn't list Cloudinary gallery '%s': %s", GALLERY_FOLDER, e)
        if _gallery_cache["items"] is None:
            return []
    return _gallery_cache["items"]


def _gallery_item(public_id):
    for item in cloud_gallery(refresh=True):
        if item["id"] == public_id:
            return item
    abort(404)  # only photos inside the gallery folder can be changed or deleted


@app.get("/api/gallery")
@admin_required
def gallery_list():
    if not USE_CLOUDINARY:
        return jsonify(source="local", folder=None, items=[])
    items = cloud_gallery(refresh=True)
    refresh_content_cache()
    return jsonify(source="cloudinary", folder=GALLERY_FOLDER, items=items,
                   error=_gallery_cache["error"], report=_gallery_cache["report"])


@app.get("/api/gallery/diagnose")
@admin_required
def gallery_diagnose():
    """Admin-only check: open /api/gallery/diagnose in the browser while logged in to /admin.
    Shows what the server is configured with and what Cloudinary returns. Never shows the secret."""
    if not USE_CLOUDINARY:
        return jsonify(cloudinary="off: CLOUDINARY_URL is not set on the server")
    cfg = cloudinary.config()
    out = {
        "cloud_name": cfg.cloud_name,
        "api_key_ends_with": str(cfg.api_key or "")[-4:],
        "gallery_folder_used": GALLERY_FOLDER,
        "gallery_folder_setting_raw": os.environ.get("CLOUDINARY_GALLERY_FOLDER"),
        "upload_folder_used": CLOUDINARY_FOLDER,
        "methods": [],
    }
    for name, call, args, kw in _listing_methods(GALLERY_FOLDER):
        try:
            res = call(*args, **kw, max_results=10)
            out["methods"].append({"method": name, "found": len(res.get("resources", [])),
                                   "sample_public_ids": [r["public_id"] for r in res.get("resources", [])][:5]})
        except Exception as e:
            out["methods"].append({"method": name, "error": f"{type(e).__name__}: {e}"})
    try:  # the real folder names in this account, to catch spelling differences
        out["folders_in_account"] = [f["path"] for f in cloudinary.api.root_folders().get("folders", [])]
    except Exception as e:
        out["folders_in_account"] = f"couldn't list: {type(e).__name__}: {e}"
    try:  # the newest few images anywhere, with their folders
        res = cloudinary.api.resources(type="upload", resource_type="image", max_results=5, direction="desc")
        out["newest_images"] = [{"public_id": r["public_id"], "asset_folder": r.get("asset_folder"),
                                 "folder": r.get("folder")} for r in res.get("resources", [])]
    except Exception as e:
        out["newest_images"] = f"couldn't list: {type(e).__name__}: {e}"
    return jsonify(out)


@app.put("/api/gallery/caption")
@admin_required
def gallery_caption():
    body = request.get_json(silent=True) or {}
    item = _gallery_item(str(body.get("id", "")))
    caption = str(body.get("caption", ""))[:200].replace("|", " ").replace("=", " ")
    try:
        cloudinary.api.update(item["id"], context={"caption": caption, "alt": caption})
    except Exception as e:
        app.logger.error("Caption update failed: %s", e)
        return jsonify(error="Couldn't save the caption to Cloudinary."), 502
    cloud_gallery(refresh=True)
    refresh_content_cache()
    return jsonify(ok=True)


@app.post("/api/gallery/delete")
@admin_required
def gallery_delete():
    item = _gallery_item(str((request.get_json(silent=True) or {}).get("id", "")))
    try:
        cloudinary.uploader.destroy(item["id"], invalidate=True)
    except Exception as e:
        app.logger.error("Delete failed: %s", e)
        return jsonify(error="Couldn't delete the photo from Cloudinary."), 502
    cloud_gallery(refresh=True)
    refresh_content_cache()
    return jsonify(ok=True)


# ============================================================ public site
# Content changes only when someone saves in the admin, so the server keeps a ready-made copy in
# memory instead of asking the database on every page view. Saving or restoring in the admin
# refreshes it at once; edits made directly in the database show up within CONTENT_CACHE_SECONDS.
CONTENT_CACHE_SECONDS = 300
_content_cache = {"body": None, "etag": None, "data": None, "at": 0.0, "gen": 0}
_content_lock = threading.Lock()


def _build_content_js():
    data = store.load()
    if USE_CLOUDINARY:
        data["gallery"] = [{"src": i["src"], "caption": i["caption"]} for i in cloud_gallery()]
    body = "window.DORYS = " + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + ";\n"
    return body, hashlib.sha1(body.encode()).hexdigest()[:16], data


def cached_content_js(force=False):
    """Returns (body, etag, source). Never fails while a previous copy exists: if the database is
    slow, paused or unreachable, visitors keep getting the last good content."""
    c = _content_cache
    if not force and c["body"] and time.time() - c["at"] < CONTENT_CACHE_SECONDS:
        return c["body"], c["etag"], "memory"
    with _content_lock:  # one rebuild at a time; others wait and reuse it
        if not force and c["body"] and time.time() - c["at"] < CONTENT_CACHE_SECONDS:
            return c["body"], c["etag"], "memory"
        try:
            gen = c["gen"]
            body, etag, data = _build_content_js()
            # If an admin save happened while we were reading, this copy may be outdated:
            # serve it to this one request but keep it marked stale so the next one rebuilds.
            c.update(body=body, etag=etag, data=data, at=time.time() if c["gen"] == gen else 0.0)
            return body, etag, "database"
        except Exception as e:
            app.logger.error("Couldn't load content, serving the last good copy: %s", e)
            if c["body"]:
                c["at"] = time.time() - CONTENT_CACHE_SECONDS + 30  # retry in 30 s
                return c["body"], c["etag"], "stale"
            raise


def refresh_content_cache():
    _content_cache["gen"] += 1
    _content_cache["at"] = 0.0


def _warm_up():
    """Load content and the gallery as soon as the server starts (e.g. after Render wakes it),
    so the first visitor doesn't also wait for the database and Cloudinary."""
    try:
        cached_content_js(force=True)
    except Exception as e:
        app.logger.warning("Warm-up failed (will retry on first visit): %s", e)


threading.Thread(target=_warm_up, daemon=True).start()


@app.get("/content.js")
def content_js():
    t0 = time.perf_counter()
    body, etag, source = cached_content_js()
    ms = (time.perf_counter() - t0) * 1000
    if request.headers.get("If-None-Match") == f'"{etag}"':
        resp = Response(status=304)
    else:
        resp = Response(body, mimetype="application/javascript")
    resp.headers["ETag"] = f'"{etag}"'
    resp.headers["Cache-Control"] = "no-cache"  # browsers recheck each visit; unchanged = tiny 304
    resp.headers["Server-Timing"] = f'content;desc="{source}";dur={ms:.1f}'
    return resp


@app.get("/uploads/<path:name>")
def uploads(name):
    resp = send_from_directory(UPLOAD_DIR, name)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@app.get("/admin")
@app.get("/admin/")
def admin_page():
    return send_from_directory(ADMIN_DIR, "index.html")


@app.get("/admin/<path:name>")
def admin_assets(name):
    return send_from_directory(ADMIN_DIR, name)


# ============================================================ customer reminders
# Customers who agreed to a reminder before a birthday/anniversary. Stored privately (never in
# content.js). Only day and month are kept, never the year.
IST = timezone(timedelta(hours=5, minutes=30))
CUSTOMERS_KEY, CRM_SETTINGS_KEY = "customers", "crm_settings"
MAX_CUSTOMERS = 5000
DEFAULT_TEMPLATE = ("Hi {name}! {person}'s {occasion} is coming up on {date} 🎂 "
                    "Would you like us to bake something special again this year? "
                    "[Add your offer here, e.g. 10% off if you order by {orderBy}]\n\n– Kasturi, Dory's Bakehouse")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]


def _today():
    return datetime.now(IST).date()


def _phone(v):
    d = re.sub(r"\D", "", str(v or ""))
    if len(d) == 11 and d.startswith("0"):
        d = d[1:]
    if len(d) == 10:
        d = "91" + d
    return d if 11 <= len(d) <= 15 else ""


def _clip(v, n):
    return " ".join(str(v or "").split())[:n]


def _clean_occasion(o):
    try:
        m, d = int(o.get("month")), int(o.get("day"))
    except (TypeError, ValueError):
        return None
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return None
    if d > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]:
        return None
    return {"id": str(o.get("id") or uuid.uuid4().hex[:10]), "label": _clip(o.get("label"), 40) or "Birthday",
            "person": _clip(o.get("person"), 60), "month": m, "day": d, "lastSent": _clip(o.get("lastSent"), 10),
            "skipUntil": _clip(o.get("skipUntil"), 10)}


def _clean_customer(c, existing=None):
    phone = _phone(c.get("phone"))
    if not phone:
        return None, "Add a valid phone number (10 digits, or with country code)."
    out = dict(existing or {})
    out.update({
        "id": (existing or {}).get("id") or uuid.uuid4().hex[:12],
        "name": _clip(c.get("name"), 60),
        "phone": phone,
        "notes": str(c.get("notes") or "")[:500],
        "occasions": [x for x in (_clean_occasion(o) for o in (c.get("occasions") or [])[:20]) if x],
    })
    out.setdefault("created", datetime.now(IST).isoformat(timespec="seconds"))
    out.setdefault("source", "admin")
    if c.get("consent") and not out.get("consentAt"):
        out["consentAt"] = datetime.now(IST).isoformat(timespec="seconds")
    if not out.get("consentAt"):
        return None, "Tick that the customer agreed to reminders."
    return out, None


def _next_date(month, day, today):
    from calendar import isleap
    for year in (today.year, today.year + 1):
        d = 28 if (month == 2 and day == 29 and not isleap(year)) else day
        when = today.replace(year=year, month=month, day=d)
        if when >= today:
            return when
    return None


def _upcoming(customers, days):
    today, out = _today(), []
    for c in customers:
        for o in c.get("occasions") or []:
            when = _next_date(o["month"], o["day"], today)
            if when is None or (when - today).days > days or (o.get("skipUntil") or "") >= when.isoformat():
                continue  # skipUntil: this year's date was the order itself, so remind from next year
            out.append({"customerId": c["id"], "occasionId": o["id"], "name": c.get("name", ""), "phone": c["phone"],
                        "label": o["label"], "person": o.get("person", ""), "date": when.isoformat(),
                        "daysAway": (when - today).days, "sent": o.get("lastSent") == when.isoformat()})
    return sorted(out, key=lambda x: (x["daysAway"], x["name"]))


@app.get("/api/customers")
@admin_required
def customers_list():
    settings = store.private_get(CRM_SETTINGS_KEY, {})
    customers = store.private_get(CUSTOMERS_KEY, [])
    return jsonify(customers=customers, template=settings.get("template") or DEFAULT_TEMPLATE,
                   upcoming=_upcoming(customers, int(request.args.get("days", 14))), today=_today().isoformat())


@app.post("/api/customers")
@admin_required
def customers_create():
    new, err = _clean_customer(request.get_json(silent=True) or {})
    if err:
        return jsonify(error=err), 400

    def add(lst):
        if len(lst) >= MAX_CUSTOMERS:
            return lst, (None, "The customer list is full.")
        if any(c["phone"] == new["phone"] for c in lst):
            return lst, (None, "A customer with this phone number is already in the list. Edit them instead.")
        return lst + [new], (new, None)
    c, err = store.private_update(CUSTOMERS_KEY, [], add)
    return (jsonify(error=err), 400) if err else jsonify(customer=c)


@app.put("/api/customers/<cid>")
@admin_required
def customers_update(cid):
    body = request.get_json(silent=True) or {}

    def upd(lst):
        for i, c in enumerate(lst):
            if c["id"] == cid:
                new, err = _clean_customer(body, existing=c)
                if err:
                    return lst, (None, err)
                if any(o["phone"] == new["phone"] and o["id"] != cid for o in lst):
                    return lst, (None, "Another customer already has this phone number.")
                lst = lst[:i] + [new] + lst[i + 1:]
                return lst, (new, None)
        return lst, (None, "Customer not found.")
    c, err = store.private_update(CUSTOMERS_KEY, [], upd)
    return (jsonify(error=err), 400) if err else jsonify(customer=c)


@app.delete("/api/customers/<cid>")
@admin_required
def customers_delete(cid):
    store.private_update(CUSTOMERS_KEY, [], lambda lst: ([c for c in lst if c["id"] != cid], None))
    return jsonify(ok=True)


@app.post("/api/customers/<cid>/occasions/<oid>/sent")
@admin_required
def customers_mark_sent(cid, oid):
    date = _clip((request.get_json(silent=True) or {}).get("date"), 10)  # "" to undo

    def mark(lst):
        for c in lst:
            for o in c.get("occasions") or []:
                if c["id"] == cid and o["id"] == oid:
                    o["lastSent"] = date
        return lst, None
    store.private_update(CUSTOMERS_KEY, [], mark)
    return jsonify(ok=True)


@app.put("/api/customers/template")
@admin_required
def customers_template():
    tpl = str((request.get_json(silent=True) or {}).get("template") or "")[:1500]

    def put(d):
        d = dict(d or {})
        d["template"] = tpl
        return d, None
    store.private_update(CRM_SETTINGS_KEY, {}, put)
    return jsonify(ok=True)


@app.get("/api/customers/export.csv")
@admin_required
def customers_export():
    import csv
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Phone", "Occasion", "Whose", "Day", "Month", "Last reminder sent", "Agreed on", "Added via", "Notes"])
    for c in store.private_get(CUSTOMERS_KEY, []):
        for o in (c.get("occasions") or [{}]):
            w.writerow([c.get("name", ""), c["phone"], o.get("label", ""), o.get("person", ""), o.get("day", ""),
                        MONTHS[o["month"] - 1] if o.get("month") else "", o.get("lastSent", ""),
                        c.get("consentAt", "")[:10], c.get("source", ""), c.get("notes", "")])
    resp = Response(buf.getvalue(), mimetype="text/csv")
    resp.headers["Content-Disposition"] = f"attachment; filename=dorys-customers-{_today().isoformat()}.csv"
    return resp


_remind_hits = {}


@app.post("/api/remind")
def remind_optin():
    """Public: the 'Remind me next year' tick-box on the cake order form."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or body.get("website"):  # honeypot field filled = bot
        return jsonify(ok=True)
    origin = request.headers.get("Origin", "")
    host = origin.split("://", 1)[-1].split("/", 1)[0].split(":")[0].lower()
    if origin and not (host in (SITE_HOST, SITE_HOST.removeprefix("www.")) or host.endswith(".onrender.com")
                       or host in ("localhost", "127.0.0.1")):
        return jsonify(error="Bad request."), 400
    ip, now = client_ip(), time.time()
    hits = [t for t in _remind_hits.get(ip, []) if now - t < 3600]
    if len(hits) >= 5:
        return jsonify(error="Too many requests. Try again later."), 429
    _remind_hits[ip] = hits + [now]
    if not body.get("consent"):
        return jsonify(error="Consent is required."), 400
    try:
        when = datetime.strptime(str(body.get("date", "")), "%Y-%m-%d")
    except ValueError:
        return jsonify(error="Add the date."), 400
    occ = _clean_occasion({"label": body.get("occasion"), "person": body.get("person"),
                           "month": when.month, "day": when.day})
    phone = _phone(body.get("phone"))
    if not occ or not phone:
        return jsonify(error="Add a valid phone number."), 400
    # They're ordering for this year's date, so the first reminder is for next year's
    this_year = _next_date(occ["month"], occ["day"], _today())
    if this_year and (this_year - _today()).days <= 60:
        occ["skipUntil"] = this_year.isoformat()

    def add(lst):
        for c in lst:
            if c["phone"] == phone:
                same = any(o["month"] == occ["month"] and o["day"] == occ["day"] and o["label"] == occ["label"]
                           for o in c.get("occasions") or [])
                if not same and len(c.get("occasions") or []) < 20:
                    c.setdefault("occasions", []).append(occ)
                c.setdefault("consentAt", datetime.now(IST).isoformat(timespec="seconds"))
                return lst, None
        if len(lst) >= MAX_CUSTOMERS:
            return lst, None
        return lst + [{"id": uuid.uuid4().hex[:12], "name": _clip(body.get("name"), 60), "phone": phone, "notes": "",
                       "occasions": [occ], "source": "website",
                       "created": datetime.now(IST).isoformat(timespec="seconds"),
                       "consentAt": datetime.now(IST).isoformat(timespec="seconds")}], None
    store.private_update(CUSTOMERS_KEY, [], add)
    return jsonify(ok=True)


# ============================================================== SEO
# The site's main address. Search engines are told this is the one true URL for each page,
# and visits to the Render address (*.onrender.com) are redirected here.
SITE_URL = os.environ.get("SITE_URL", "https://www.dorysbakes.com").strip().rstrip("/")
SITE_HOST = SITE_URL.split("://", 1)[-1].split("/", 1)[0].lower()
REDIRECT_RENDER_HOST = os.environ.get("REDIRECT_RENDER_HOST", "1") == "1"
PAGES = ["index.html", "menu.html", "cakes.html", "gifting.html", "gallery.html", "about.html", "contact.html", "privacy.html"]
# Google Analytics 4: set GA_MEASUREMENT_ID (e.g. G-ABC123XYZ) in Render's Environment to turn it on
GA_ID = os.environ.get("GA_MEASUREMENT_ID", "").strip().upper()
if not re.fullmatch(r"G-[A-Z0-9]{4,20}", GA_ID):
    GA_ID = ""
DEFAULT_NAME = "Dory's Bakehouse"


def _ph(v):
    return not str(v or "").strip() or bool(re.search(r"\[.*\]", str(v)))


def _site_content():
    """The content dict for SEO tags, from the in-memory copy. Falls back to defaults."""
    try:
        cached_content_js()
        return _content_cache.get("data") or {}
    except Exception:
        return {}


_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _parse_days(text):
    t = str(text).lower()
    if re.search(r"every ?day|daily|all week|7 days|mon(day)?\s*[-–—to]+\s*sun(day)?", t):
        return _DAYS[:]
    found = [i for i, d in enumerate(_DAYS) if re.search(r"\b" + d[:3].lower(), t)]
    if not found:
        return []
    if len(found) == 2 and re.search(r"[-–—]|\bto\b", t):  # a range like "Mon – Fri"
        a, b = found
        return [_DAYS[i % 7] for i in range(a, (b if b >= a else b + 7) + 1)]
    return [_DAYS[i] for i in found]


def _parse_time(text):
    m = re.match(r"\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$", text, re.I)
    if not m:
        return None
    h, mi, ap = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower().replace(".", "")
    if ap == "pm" and h < 12:
        h += 12
    if ap == "am" and h == 12:
        h = 0
    return f"{h:02d}:{mi:02d}" if h < 24 and mi < 60 else None


def _opening_hours(hours):
    out = []
    for row in hours or []:
        if _ph(row.get("days")) or _ph(row.get("time")) or re.search(r"closed", str(row.get("time")), re.I):
            continue
        days = _parse_days(row["days"])
        parts = re.split(r"\s*(?:[-–—]|to)\s*", str(row["time"]).strip(), maxsplit=1)
        if not days or len(parts) != 2:
            continue
        opens, closes = _parse_time(parts[0]), _parse_time(parts[1])
        if opens and closes:
            out.append({"@type": "OpeningHoursSpecification", "dayOfWeek": days, "opens": opens, "closes": closes})
    return out


def _business_jsonld(d):
    c = d.get("contact") or {}
    name = d.get("name") if not _ph(d.get("name")) else DEFAULT_NAME
    j = {"@context": "https://schema.org", "@type": "Bakery", "@id": SITE_URL + "/#bakery",
         "name": name, "url": SITE_URL + "/",
         "logo": SITE_URL + "/assets/images/logo-512.png",
         "image": [SITE_URL + "/assets/images/og-image.jpg", SITE_URL + "/assets/images/logo-512.png"],
         "servesCuisine": ["Bakery", "Cakes", "Desserts"], "priceRange": "₹₹",
         "hasMenu": SITE_URL + "/menu.html"}
    if not _ph(d.get("tagline")):
        j["description"] = d["tagline"]
    if not _ph(c.get("phone")):
        j["telephone"] = re.sub(r"[^\d+]", "", c["phone"])
    if not _ph(c.get("email")):
        j["email"] = c["email"]
    if not _ph(c.get("address")):
        j["address"] = {"@type": "PostalAddress", "streetAddress": " ".join(str(c["address"]).split()), "addressCountry": "IN"}
    if not _ph(c.get("mapLink")):
        j["hasMap"] = c["mapLink"]
    same = []
    if not _ph(c.get("instagram")):
        same.append("https://www.instagram.com/" + str(c["instagram"]).lstrip("@").split("instagram.com/")[-1].strip("/"))
    if same:
        j["sameAs"] = same
    oh = _opening_hours(d.get("hours"))
    if oh:
        j["openingHoursSpecification"] = oh
    return j


def _menu_jsonld(d):
    sections = []
    for s in d.get("menu") or []:
        items = []
        for i in s.get("items") or []:
            if _ph(i.get("name")):
                continue
            item = {"@type": "MenuItem", "name": i["name"]}
            if not _ph(i.get("desc")):
                item["description"] = i["desc"]
            m = re.search(r"\d[\d,]*(?:\.\d+)?", str(i.get("price") or ""))
            if m and not _ph(i.get("price")):
                item["offers"] = {"@type": "Offer", "price": m.group(0).replace(",", ""), "priceCurrency": "INR"}
            items.append(item)
        if items and not _ph(s.get("section")):
            sections.append({"@type": "MenuSection", "name": s["section"], "hasMenuItem": items})
    if not sections:
        return None
    return {"@context": "https://schema.org", "@type": "Menu", "name": "Menu", "url": SITE_URL + "/menu.html",
            "hasMenuSection": sections}


def _ld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace("</", "<\\/") + "</script>"


_page_files = {}


def _page_source(name):
    f = SITE_DIR / name
    mtime = f.stat().st_mtime
    hit = _page_files.get(name)
    if not hit or hit[0] != mtime:
        hit = (mtime, f.read_text(encoding="utf-8"))
        _page_files[name] = hit
    return hit[1]


_asset_ver = {}


def _asset_versions(html):
    """Add ?v=<file version> to the stylesheet, script and logo/icon images, so browsers fetch the
    new copy right after a deploy instead of reusing an old cached one."""
    rels = ["assets/css/style.css", "assets/js/site.js"] + sorted(set(re.findall(r'"(assets/images/[\w.-]+\.(?:png|jpg|webp|svg))"', html)))
    for rel in rels:
        f = SITE_DIR / rel
        try:
            m = f.stat().st_mtime
        except OSError:
            continue
        hit = _asset_ver.get(rel)
        if not hit or hit[0] != m:
            hit = (m, hashlib.sha1(f.read_bytes()).hexdigest()[:10])
            _asset_ver[rel] = hit
        html = html.replace(f'"{rel}"', f'"{rel}?v={hit[1]}"')
    return html


def render_page(name):
    """Serve a page with SEO tags filled in from the current content: the bakery's name in the
    title and link previews, the canonical address, and business details for Google."""
    html = _asset_versions(_page_source(name))
    d = _site_content()
    head, sep, body = html.partition("</head>")
    nm = d.get("name") if not _ph(d.get("name")) else DEFAULT_NAME
    if nm != DEFAULT_NAME:
        head = head.replace(DEFAULT_NAME, str(escape(nm)))
    head = head.replace("https://dorysbakes.com", SITE_URL)
    g = d.get("gifting") or {}
    if name == "gifting.html" and g.get("show") and not _ph(g.get("title")):
        gt = " ".join(str(g["title"]).split())[:70]
        gt = str(escape(gt if "pune" in gt.lower() else gt + " in Pune")) + " | " + str(escape(nm))
        head = re.sub(r"<title>.*?</title>", lambda m: f"<title>{gt}</title>", head, count=1, flags=re.S)
        head = re.sub(r'(<meta property="og:title" content=")[^"]*', lambda m: m.group(1) + gt, head, count=1)
    path = "/" if name == "index.html" else "/" + name
    extra = []
    if request.args.get("preview"):
        extra.append('<meta name="robots" content="noindex">')
    else:
        extra.append(f'<link rel="canonical" href="{SITE_URL}{path}">')
    extra.append('<meta property="og:site_name" content="' + str(escape(nm)) + '">')
    # Search Console / Bing Webmaster "HTML tag" verification: paste just the code into these settings
    for env, meta in (("GOOGLE_SITE_VERIFICATION", "google-site-verification"), ("BING_SITE_VERIFICATION", "msvalidate.01")):
        code = re.sub(r'.*content="([^"]+)".*', r"\1", os.environ.get(env, "").strip())  # accepts the whole tag too
        if code and name == "index.html":
            extra.append(f'<meta name="{meta}" content="{escape(code)}">')
    extra.append('<meta property="og:locale" content="en_IN">')
    if GA_ID and not request.args.get("preview"):
        extra.append(f'<script async src="https://www.googletagmanager.com/gtag/js?id={GA_ID}"></script>'
                     "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}"
                     f"gtag('js',new Date());gtag('config','{GA_ID}');</script>")
    if name in ("index.html", "contact.html", "about.html", "gifting.html"):
        extra.append(_ld(_business_jsonld(d)))
    if name == "menu.html":
        m = _menu_jsonld(d)
        if m:
            extra.append(_ld(m))
    extra.append(_ld({"@context": "https://schema.org", "@type": "WebSite", "name": nm, "url": SITE_URL + "/"})
                 if name == "index.html" else "")
    resp = Response(head + "\n".join(x for x in extra if x) + "\n" + sep + body, mimetype="text/html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.before_request
def redirect_to_main_domain():
    """Visits to the Render address go to the real domain, so Google sees one site, not two."""
    host = (request.host or "").split(":")[0].lower()
    # dorysbakes.com (no www) and the onrender.com address both 301 to https://www.dorysbakes.com
    bare = SITE_HOST[4:] if SITE_HOST.startswith("www.") else None
    if (REDIRECT_RENDER_HOST and (host.endswith(".onrender.com") or (bare and host == bare)) and host != SITE_HOST
            and request.method in ("GET", "HEAD") and not request.path.startswith(("/api/", "/healthz"))):
        qs = request.query_string.decode()
        return redirect(SITE_URL + request.path + ("?" + qs if qs else ""), code=301)


@app.get("/healthz")
def healthz():
    return "ok"


@app.get("/robots.txt")
def robots():
    body = ("User-agent: *\n"
            "Disallow: /admin\n"
            "Disallow: /api/\n"
            "Disallow: /*?preview=\n"
            f"\nSitemap: {SITE_URL}/sitemap.xml\n")
    resp = Response(body, mimetype="text/plain")
    resp.headers["X-Robots-Tag"] = "noindex"  # crawl it, but don't list it in search results
    return resp


@app.get("/sitemap.xml")
def sitemap():
    today = datetime.now(timezone.utc).date().isoformat()
    urls = "".join(
        f"<url><loc>{SITE_URL}{'/' if p == 'index.html' else '/' + p}</loc><lastmod>{today}</lastmod>"
        f"<priority>{'1.0' if p == 'index.html' else '0.2' if p == 'privacy.html' else '0.8'}</priority></url>"
        for p in PAGES)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + "</urlset>")
    resp = Response(xml, mimetype="application/xml")
    resp.headers["X-Robots-Tag"] = "noindex"
    return resp


# Locally Flask serves the site; on Vercel the CDN serves public/ before requests reach Flask.
@app.get("/")
def home():
    return render_page("index.html")


@app.get("/<path:name>")
def site_files(name):
    if not (SITE_DIR / name).is_file() and (SITE_DIR / f"{name}.html").is_file():
        name = f"{name}.html"  # allow /menu as well as /menu.html
    if name.endswith(".html") and (SITE_DIR / name).is_file() and "/" not in name:
        return render_page(name)
    resp = send_from_directory(SITE_DIR, name)
    if name.startswith("assets/images/"):
        resp.headers["Cache-Control"] = "public, max-age=2592000"  # 30 days: logos and icons rarely change
    elif name.startswith("assets/"):
        resp.headers["Cache-Control"] = "public, max-age=3600"  # 1 hour: CSS/JS update soon after a deploy
    return resp


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.path.startswith(("/admin", "/api")):
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Cache-Control"] = "no-store"
    return resp


if __name__ == "__main__":
    if not ADMIN_PASSWORD:
        print("\n  ⚠  ADMIN_PASSWORD is not set, so admin login is disabled. Add it to .env\n")
    port = int(os.environ.get("PORT", 5000))
    print("  Content: " + ("Postgres database" if USE_DB else f"file {CONTENT_FILE}"))
    print("  Photos:  " + (f"Cloudinary (folder '{CLOUDINARY_FOLDER}', gallery '{GALLERY_FOLDER}')"
                           if USE_CLOUDINARY else f"folder {UPLOAD_DIR}  (CLOUDINARY_URL not set)"))
    print(f"  Site:    http://localhost:{port}\n  Admin:   http://localhost:{port}/admin\n")
    app.run(host="127.0.0.1", port=port, debug=False)
