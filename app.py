"""
Dory's Bakehouse: website + admin backend.

Serves the public site, generates /content.js from the saved content, and provides a
password-protected admin panel at /admin for editing text and uploading photos.

Storage
  - Text content: Postgres when DATABASE_URL is set (needed on Vercel), else data/content.json.
  - Photos: Cloudinary when CLOUDINARY_URL is set (needed on Vercel), else data/uploads/.
    With Cloudinary, the browser uploads photos straight to Cloudinary using a signature
    from this server, so large phone photos never pass through the server.

Run locally: put your settings in a .env file (see .env), then
    pip install -r requirements.txt
    python3 app.py
"""
import hmac
import io
import json
import os
import secrets
import shutil
import time
import uuid
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

try:  # local development: read settings from .env
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

from flask import Flask, Response, abort, jsonify, request, send_from_directory, session

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

    def conn(self):
        # prepare_threshold=None: no server-side prepared statements, so this works through
        # Supabase's poolers (the transaction pooler rejects them) as well as Neon or plain Postgres.
        c = self.psycopg.connect(self.url, autocommit=False, connect_timeout=10, prepare_threshold=None)
        if not self.ready:
            with c.cursor() as cur:
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
    return jsonify(ok=True)


# ============================================================ public site
@app.get("/content.js")
def content_js():
    data = store.load()
    if USE_CLOUDINARY:
        data["gallery"] = [{"src": i["src"], "caption": i["caption"]} for i in cloud_gallery()]
    body = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    resp = Response(f"window.DORYS = {body};\n", mimetype="application/javascript")
    # Vercel's CDN keeps it for 60 s and serves the old copy while refreshing, so the database
    # is hit about once a minute instead of on every page view. Browsers always recheck.
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["CDN-Cache-Control"] = "max-age=60, stale-while-revalidate=300"
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


# Locally Flask serves the site; on Vercel the CDN serves public/ before requests reach Flask.
@app.get("/")
def home():
    return send_from_directory(SITE_DIR, "index.html")


@app.get("/<path:name>")
def site_files(name):
    if not (SITE_DIR / name).is_file() and (SITE_DIR / f"{name}.html").is_file():
        name = f"{name}.html"  # allow /menu as well as /menu.html
    return send_from_directory(SITE_DIR, name)


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
    port = int(os.environ.get("PORT", 8000))
    print("  Content: " + ("Postgres database" if USE_DB else f"file {CONTENT_FILE}"))
    print("  Photos:  " + (f"Cloudinary (folder '{CLOUDINARY_FOLDER}', gallery '{GALLERY_FOLDER}')"
                           if USE_CLOUDINARY else f"folder {UPLOAD_DIR}  (CLOUDINARY_URL not set)"))
    print(f"  Site:    http://localhost:{port}\n  Admin:   http://localhost:{port}/admin\n")
    app.run(host="127.0.0.1", port=port, debug=False)
