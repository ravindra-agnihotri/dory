# Dory's Bakehouse: website + admin

The public website, plus an admin panel at `/admin` where you can edit every detail and upload photos without touching code.

```
app.py                 Flask backend (serves the site, the admin, and the API)
site/                  The public website (HTML, CSS, JS)
admin/                 The admin panel
default_content.json   Starting content, used only the first time the app runs
data/                  Created automatically: saved content, version history (and photos, if Cloudinary isn't set)
```

## Photos: Cloudinary

When `CLOUDINARY_URL` is set, uploaded photos go to Cloudinary; otherwise they're saved in `data/uploads/`.

1. Create a free account at cloudinary.com.
2. Dashboard → **API Keys** → copy the **API environment variable**. It looks like
   `cloudinary://123456789012345:AbCdEfGhIj...@your-cloud-name`
3. Start the app with it:
   ```bash
   ADMIN_PASSWORD='...' CLOUDINARY_URL='cloudinary://...' python app.py
   ```
   The startup message says `Photos: Cloudinary` when it's working.

Photos are rotated, resized to 1800px and compressed before upload, so they stay well under the free plan's limits.
They're stored in the `dorys-bakehouse` folder in your Media Library (change it with `CLOUDINARY_FOLDER`),
and served with `f_auto,q_auto`, so each browser gets WebP/AVIF at a sensible quality automatically.
iPhone HEIC photos work too.

### Gallery = a Cloudinary folder
With Cloudinary on, the Gallery page shows **every photo in `dorys-bakehouse/gallery`**, newest first.
- Add photos from the admin's Gallery section, **or** upload straight into that folder from the Cloudinary website or mobile app.
- Photos added directly in Cloudinary appear on the site within 5 minutes (the list is cached to stay inside the free API limits). Press "Refresh from Cloudinary" in the admin to see them at once.
- Captions: type them in the admin, or set a `caption` field on the photo in Cloudinary (Media Library → photo → Metadata → Contextual).
- Deleting in the admin deletes the photo from Cloudinary permanently. It can't be restored from "Previous versions".
- Order is always newest first; you can't reorder by hand.
- Only the `gallery` folder is listed. Photos for the special, highlights and About page live in the parent folder and never show up in the gallery.

Keep the API secret private: never put it in the site's HTML/JS or commit it to git.
Removing a photo in the admin doesn't delete it from Cloudinary (so older versions can still be restored).
Clean up unused ones in the Cloudinary Media Library if you ever need space.

**Note:** Cloudinary only holds the photos. The text content (`data/content.json`) still lives on the server's disk,
so you still need a host with a persistent disk (see below), or a small database for the content.

## Run it on your Mac

```bash
cd dorys-bakehouse
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ADMIN_PASSWORD='pick-a-strong-password' python app.py
```

- Site: http://localhost:5000
- Admin: http://localhost:5000/admin (sign in with the password you set)

Don't open the HTML files directly or run anything with Node. The site now reads its content from the backend, so it has to be opened through `python app.py`.

## Using the admin

- **Basics & contact:** phone, WhatsApp number (cake orders go here), address, map, hours
- **This week's special:** the yellow card on the home page
- **Menu:** sections and items, with prices and tags (eggless, vegan, bestseller, new)
- **Home highlights**, **About**, **Custom cakes** (flavours, sizes, notes)
- **Gallery:** drag photos in, add captions, reorder
- **Previous versions:** every save keeps a copy (the last 30), so you can restore one if something breaks

Photos are resized to 1800px and compressed automatically, so you can upload straight from a phone.
Fields highlighted in yellow still contain `[placeholder]` text.
Changes go live when you press **Save changes** (or Cmd/Ctrl + S).

## Putting it online

**This now needs a Python host with a persistent disk.** Netlify and GitHub Pages can't run it any more.
Also avoid hosts whose disk is wiped on every restart or deploy (for example Render's free tier). If you use one of those, uploaded photos will disappear.

Good options:

| Host | Cost | Notes |
|---|---|---|
| **PythonAnywhere** | Free on `*.pythonanywhere.com`; about $5/month for your own domain | Easiest. Persistent disk, Flask-friendly |
| **Railway** + a volume | About $5/month | Mount the volume and set `DATA_DIR` to its path |
| Any VPS (Hostinger, DigitalOcean) | About ₹400–500/month | Most control; you manage updates |

### PythonAnywhere steps
1. Upload the project folder (Files tab), or `git clone` it in a Bash console.
2. In a console: `pip install --user -r requirements.txt`
3. Web tab → Add a new web app → Manual configuration → Python 3.x.
4. Edit the WSGI file so it contains:
   ```python
   import os, sys
   sys.path.insert(0, "/home/YOURUSERNAME/dorys-bakehouse")
   os.environ["ADMIN_PASSWORD"] = "your-strong-password"
   os.environ["HTTPS"] = "1"
   from app import app as application
   ```
5. Press **Reload**. Then connect your domain from the Web tab (paid plan) and turn on **Force HTTPS**.

### Any other server
```bash
ADMIN_PASSWORD='...' HTTPS=1 waitress-serve --port=8000 app:app
```
Run it behind HTTPS. The admin password is sent at login, so never run the admin over plain http on the internet.

## Environment variables

| Name | Required | What it does |
|---|---|---|
| `ADMIN_PASSWORD` | Yes | Admin login password. Use 12+ characters |
| `HTTPS` | On the live site | Set to `1` so the login cookie is only sent over HTTPS |
| `CLOUDINARY_URL` | Recommended | Send photos to Cloudinary (see above) |
| `CLOUDINARY_FOLDER` | No | Cloudinary folder name (default `dorys-bakehouse`) |
| `DATA_DIR` | No | Where content and photos are stored (default `./data`) |
| `SECRET_KEY` | No | Session key; one is generated and kept in `data/` if not set |
| `PORT` | No | Port for `python app.py` (default 5000) |

## Backups

All text content lives in **`data/`** (and photos too, if Cloudinary isn't set). Download that folder regularly. With Cloudinary, the photos are already stored safely there.
