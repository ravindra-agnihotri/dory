"""
Dory's Bakehouse: website + admin backend.

Serves the public site, generates /content.js from the saved content, and
provides a password-protected admin panel at /admin for editing text and
uploading photos.

Run locally:
    pip install -r requirements.txt
    ADMIN_PASSWORD=choose-a-password python app.py
    open http://localhost:5000        (site)
    open http://localhost:5000/admin  (admin)
"""
import hmac
import io
import json
import os
import secrets
import shutil
import time
import uuid
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_from_directory, session
from PIL import Image, ImageOps, UnidentifiedImageError

BASE = Path(__file__).resolve().parent
SITE_DIR = BASE / "site"
ADMIN_DIR = BASE / "admin"
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
HISTORY_DIR = DATA_DIR / "history"
CONTENT_FILE = DATA_DIR / "content.json"
DEFAULT_CONTENT = BASE / "default_content.json"

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
MAX_UPLOAD_MB = 12
MAX_IMAGE_PX = 1800
KEEP_HISTORY = 30

for d in (UPLOAD_DIR, HISTORY_DIR):
    d.mkdir(parents=True, exist_ok=True)

# iPhone HEIC photos: supported when pillow-heif is installed
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

# Cloudinary: used for photos when CLOUDINARY_URL is set, otherwise photos go to data/uploads/
#   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>   (Cloudinary dashboard → API Keys)
USE_CLOUDINARY = bool(os.environ.get("CLOUDINARY_URL"))
CLOUDINARY_FOLDER = os.environ.get("CLOUDINARY_FOLDER", "dory-gallery")
if USE_CLOUDINARY:
    import cloudinary
    import cloudinary.api
    import cloudinary.uploader
    cloudinary.config(secure=True)  # reads CLOUDINARY_URL from the environment


def _secret_key():
    """Stable secret key: env var, else one generated once and kept in data/."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    key_file = DATA_DIR / ".secret_key"
    if not key_file.exists():
        key_file.write_text(secrets.token_hex(32))
    return key_file.read_text().strip()


app = Flask(__name__, static_folder=None)
app.config.update(
    SECRET_KEY=_secret_key(),
    MAX_CONTENT_LENGTH=MAX_UPLOAD_MB * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_SECURE=os.environ.get("HTTPS", "0") == "1",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 14,  # stay logged in 14 days
)


# ---------------------------------------------------------------- content I/O
def load_content():
    if not CONTENT_FILE.exists():
        shutil.copy(DEFAULT_CONTENT, CONTENT_FILE)
    return json.loads(CONTENT_FILE.read_text(encoding="utf-8"))


def save_content(data):
    if CONTENT_FILE.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy(CONTENT_FILE, HISTORY_DIR / f"content-{stamp}.json")
        old = sorted(HISTORY_DIR.glob("content-*.json"))
        for f in old[:-KEEP_HISTORY]:
            f.unlink()
    tmp = CONTENT_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(CONTENT_FILE)  # atomic: a crash mid-save never corrupts the file


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
    return None


# --------------------------------------------------------------------- auth
_failures = {}  # ip -> [count, first_failure_time]


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


@app.post("/api/login")
def login():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    count, first = _failures.get(ip, (0, time.time()))
    if count >= 5 and time.time() - first < 15 * 60:
        return jsonify(error="Too many wrong attempts. Try again in 15 minutes."), 429
    if not ADMIN_PASSWORD:
        return jsonify(error="Admin password isn't set on the server (ADMIN_PASSWORD)."), 500
    pw = (request.get_json(silent=True) or {}).get("password", "")
    if hmac.compare_digest(pw.encode(), ADMIN_PASSWORD.encode()):
        _failures.pop(ip, None)
        session.clear()
        session.permanent = True
        session["admin"] = True
        return jsonify(ok=True)
    if time.time() - first >= 15 * 60:
        count, first = 0, time.time()
    _failures[ip] = (count + 1, first)
    return jsonify(error="Wrong password."), 401


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    return jsonify(loggedIn=logged_in())


# ----------------------------------------------------------------- admin API
@app.get("/api/content")
@admin_required
def get_content():
    return jsonify(load_content())


@app.put("/api/content")
@admin_required
def put_content():
    data = request.get_json(silent=True)
    err = validate(data)
    if err:
        return jsonify(error=err), 400
    save_content(data)
    return jsonify(ok=True, savedAt=datetime.now().strftime("%I:%M %p").lstrip("0"))


@app.get("/api/history")
@admin_required
def history():
    files = sorted(HISTORY_DIR.glob("content-*.json"), reverse=True)
    return jsonify([f.stem.replace("content-", "") for f in files])


@app.post("/api/history/<stamp>/restore")
@admin_required
def restore(stamp):
    f = HISTORY_DIR / f"content-{stamp}.json"
    if not stamp.replace("-", "").isdigit() or not f.exists():
        abort(404)
    save_content(json.loads(f.read_text(encoding="utf-8")))
    return jsonify(ok=True)


@app.post("/api/upload")
@admin_required
def upload():
    files = request.files.getlist("photo")
    if not files:
        return jsonify(error="Choose a photo to upload."), 400
    to_gallery = request.args.get("target") == "gallery"
    saved = []
    for f in files:
        try:
            img = Image.open(f.stream)
            img = ImageOps.exif_transpose(img)  # fix sideways phone photos
        except (UnidentifiedImageError, OSError):
            return jsonify(error=f"{f.filename} isn't a photo we can read. Use JPG, PNG, WEBP or HEIC."), 400
        img.thumbnail((MAX_IMAGE_PX, MAX_IMAGE_PX))
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        buf, ext = io.BytesIO(), "png" if has_alpha else "jpg"
        if has_alpha:
            img.save(buf, "PNG", optimize=True)
        else:
            img.convert("RGB").save(buf, "JPEG", quality=85, optimize=True, progressive=True)
        buf.seek(0)
        name = f"{uuid.uuid4().hex[:12]}"

        if USE_CLOUDINARY:
            folder = GALLERY_FOLDER if to_gallery else CLOUDINARY_FOLDER
            try:
                res = cloudinary.uploader.upload(
                    buf, public_id=name, resource_type="image", overwrite=False,
                    folder=folder,        # accounts using "fixed folders"
                    asset_folder=folder,  # accounts using "dynamic folders" (newer accounts)
                )
            except Exception as e:  # network error, bad credentials, quota exceeded
                app.logger.error("Cloudinary upload failed: %s", e)
                return jsonify(error="Couldn't upload to Cloudinary. Check the server's internet connection "
                                     "and the CLOUDINARY_URL setting. Details are in the server log."), 502
            # f_auto,q_auto: Cloudinary serves WebP/AVIF at the right quality per browser
            saved.append(delivery_url(res["secure_url"]))
        else:
            (UPLOAD_DIR / f"{name}.{ext}").write_bytes(buf.getvalue())
            saved.append(f"uploads/{name}.{ext}")
    if to_gallery:
        cloud_gallery(refresh=True)
    return jsonify(files=saved)


# ------------------------------------------------ gallery from Cloudinary folder
# With Cloudinary on, the Gallery page shows everything in <CLOUDINARY_FOLDER>/gallery,
# including photos added directly in Cloudinary's Media Library or app.
# Captions come from each photo's "caption" metadata (Media Library → photo → Metadata).
GALLERY_FOLDER = f"{CLOUDINARY_FOLDER}/gallery"
GALLERY_CACHE_SECONDS = 300  # new photos appear within 5 minutes; also keeps API usage low
_gallery_cache = {"items": None, "at": 0.0}


def delivery_url(secure_url):
    # f_auto,q_auto: WebP/AVIF at the right quality per browser; c_limit,w_1800 caps huge originals
    return secure_url.replace("/image/upload/", "/image/upload/f_auto,q_auto,c_limit,w_1800/", 1)


def _list_folder():
    opts = dict(max_results=500, context=True, direction="desc")
    try:
        res = cloudinary.api.resources_by_asset_folder(GALLERY_FOLDER, **opts)
    except Exception:
        # older "fixed folder" accounts: folder is part of the public_id
        res = cloudinary.api.resources(type="upload", prefix=GALLERY_FOLDER + "/", **opts)
    items = []
    for r in res.get("resources", []):
        custom = (r.get("context") or {}).get("custom") or {}
        items.append({
            "id": r["public_id"],
            "src": delivery_url(r["secure_url"]),
            "caption": custom.get("caption") or custom.get("alt") or "",
            "created": r.get("created_at", ""),
        })
    items.sort(key=lambda i: i["created"], reverse=True)  # newest first
    return items


def cloud_gallery(refresh=False):
    """Cached list of gallery photos. Never raises: on error, serves the last good list."""
    fresh = time.time() - _gallery_cache["at"] < GALLERY_CACHE_SECONDS
    if _gallery_cache["items"] is not None and fresh and not refresh:
        return _gallery_cache["items"]
    try:
        _gallery_cache["items"] = _list_folder()
        _gallery_cache["at"] = time.time()
    except Exception as e:
        app.logger.error("Couldn't list Cloudinary gallery: %s", e)
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
    return jsonify(source="cloudinary", folder=GALLERY_FOLDER, items=cloud_gallery(refresh=True))


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


@app.errorhandler(413)
def too_big(_):
    return jsonify(error=f"That upload is too large. Keep each batch under {MAX_UPLOAD_MB} MB."), 413


# ------------------------------------------------------------- public site
@app.get("/content.js")
def content_js():
    data = load_content()
    if USE_CLOUDINARY:
        data["gallery"] = [{"src": i["src"], "caption": i["caption"]} for i in cloud_gallery()]
    body = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    resp = Response(f"window.DORYS = {body};\n", mimetype="application/javascript")
    resp.headers["Cache-Control"] = "no-cache"
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
        print("\n  ⚠  ADMIN_PASSWORD is not set, so admin login is disabled.")
        print("     Start with:  ADMIN_PASSWORD=your-password python app.py\n")
    port = int(os.environ.get("PORT", 8000))
    print("  Photos: " + (f"Cloudinary (folder '{CLOUDINARY_FOLDER}')" if USE_CLOUDINARY else f"local folder {UPLOAD_DIR}"))
    print(f"  Site:  http://localhost:{port}\n  Admin: http://localhost:{port}/admin\n")
    app.run(host="0.0.0.0", port=port, debug=False)
