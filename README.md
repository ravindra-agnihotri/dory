# Dory's Bakehouse: website + admin

The public website, plus an admin panel at `/admin` where you can edit every detail and upload photos without touching code.

```
app.py                 Flask backend (admin, API, and /content.js which the pages read)
public/                The public website. On Vercel it's served from the CDN
admin/                 The admin panel
default_content.json   Starting content, used only the very first time
.env.example           Settings template for running locally
```

Where things are stored:

| What | Live | Local, if not configured |
|---|---|---|
| Text content (menu, hours, story…) + version history | Postgres database (Neon) via `DATABASE_URL` | `data/content.json` |
| Photos | Cloudinary via `CLOUDINARY_URL` | `data/uploads/` |

With both set, the app keeps nothing on its own disk, so it runs on Vercel, Render, Railway, PythonAnywhere or anywhere else that runs Python.

> **Vercel's free (Hobby) plan is for non-commercial use only.** Vercel counts a site that advertises
> products or services for sale as commercial, and a bakery site does that. The compliant Vercel option is the Pro plan.
> See "Other hosts" below for alternatives.

---

## Deploy to Vercel

You need accounts on **GitHub**, **Vercel**, **Neon** (created from inside Vercel) and **Cloudinary**.

### 1. Put the code on GitHub
Create a **private** repo and push this folder. `.gitignore` already keeps out `.env` and `data/`.
```bash
cd dorys-bakehouse
git init && git add . && git commit -m "Dory's Bakehouse site"
git branch -M main
git remote add origin https://github.com/YOU/dorys-bakehouse.git
git push -u origin main
```

### 2. Create the Vercel project
Vercel → **Add New… → Project** → import the repo → **Deploy**.
The first deploy fails with a message asking for settings. That's expected; the next steps provide them.

### 3. Add the database
In the project: **Storage → Create Database → Neon (Postgres)** → free plan → **Connect** it to this project.
This adds `DATABASE_URL` to the project automatically. Tables are created on first use.

### 4. Add the other settings
**Settings → Environment Variables**, for Production and Preview:

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | A strong password (12+ characters) |
| `SECRET_KEY` | Random text. Generate with `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `CLOUDINARY_URL` | Cloudinary → Dashboard → API Keys → API environment variable |

Then **Deployments → ⋯ → Redeploy**.

### 5. Check it
Open `https://your-project.vercel.app/admin`, sign in, and fill in the real content.

### 6. Connect your GoDaddy domain
1. Vercel → **Settings → Domains** → add `yourdomain.com` and `www.yourdomain.com`.
   Vercel shows the exact DNS records to create for each.
2. GoDaddy → **My Products → your domain → DNS**:
   - **A** record, name `@` → the IP Vercel shows. Replace any existing `@` A records, including GoDaddy's "Parked" one.
   - **CNAME** record, name `www` → the value Vercel shows. Edit the existing `www` record rather than adding a second.
3. Wait until Vercel shows both domains as **Valid**. HTTPS certificates are automatic.

---

## Other hosts

Set the same four variables (`ADMIN_PASSWORD`, `SECRET_KEY`, `CLOUDINARY_URL`, `DATABASE_URL`). Get a free Neon
database directly at neon.tech if you're not using Vercel.

- **Render:** New → Web Service → connect the repo.
  Build: `pip install -r requirements.txt` · Start: `gunicorn app:app` · add the variables.
  No disk needed. The free instance sleeps after 15 minutes idle, so the first visitor after that waits about a minute.
- **PythonAnywhere:** set the variables in the WSGI file; on free accounts also set
  `CLOUDINARY_API_PROXY=http://proxy.server:3128`. Custom domains need a paid plan.

---

## Run it on your Mac

```bash
cd dorys-bakehouse
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then open .env and fill it in
python3 app.py
```
Site: http://localhost:5000, admin: http://localhost:5000/admin

Leave `DATABASE_URL` empty in `.env` to keep local test content in `data/content.json`, separate from the live site.
If you paste the live Neon URL into `.env`, local edits change the **live** website.

---

## Using the admin
- **Basics & contact, This week's special, Menu, Home highlights, About, Custom cakes**: edit, then **Save changes** (Cmd/Ctrl + S). The live site updates within about a minute.
- **Gallery**: shows everything in the Cloudinary folder `dorys-bakehouse/gallery`, newest first. Add photos in the admin or straight into that folder in Cloudinary (they appear within about 5 minutes). Captions save instantly. **Delete is permanent.**
- **Previous versions**: every save keeps a copy (last 30). Restore one if something goes wrong.

Photos upload straight from the browser to Cloudinary, so large phone photos (up to 10 MB, including iPhone HEIC) are fine. Cloudinary resizes and optimises them.

## Keep secrets secret
`CLOUDINARY_URL`, `SECRET_KEY`, `ADMIN_PASSWORD` and `DATABASE_URL` belong only in your host's settings and your local `.env`.
Never put them in code, commit them, or paste them in chats or screenshots. If one leaks, change it in the provider's dashboard,
update it on your host, and redeploy.

## Free-plan limits worth knowing
- **Neon** pauses the database when idle; the first request after a quiet spell takes about a second longer. The site's content is cached at the edge on Vercel, so visitors rarely notice.
- **Cloudinary free** has monthly credits (storage + bandwidth). A bakery site uses a small fraction of them.

## Unfinished content, preview and SEO

- **Anything still in `[square brackets]` is hidden from visitors.** A menu item without a real name, hours without real times,
  an empty special, etc. simply don't appear. Open **Preview site** in the admin (or add `?preview=1` to any page) to see them
  highlighted in yellow. Preview pages are hidden from Google.
- **Prices:** type just the number (`120`) and it shows as `₹120`. Text like `from 450` is shown as written.
- **Search engines:** the server adds a canonical address, link-preview tags and Google business details (name, phone, address,
  opening hours, Instagram, menu with prices) to each page from the admin content, plus `/robots.txt` and `/sitemap.xml`.
  Visits to the `*.onrender.com` address redirect to the main domain.

| Setting | Default | What it does |
|---|---|---|
| `SITE_URL` | `https://www.dorysbakes.com` | The main address used in canonical tags, the sitemap and the redirect |
| `REDIRECT_RENDER_HOST` | `1` | Set to `0` to stop redirecting the onrender.com address |

After deploying: add the site in **Google Search Console** (search.google.com/search-console), submit
`https://www.dorysbakes.com/sitemap.xml`, and check the business details with Google's **Rich Results Test**.
