"""Server-side rendering for the parts of each page that search engines, link previews and slow
phones should see without waiting for JavaScript.

The browser still loads content.js and assets/js/site.js and fills the page itself. This module
writes the same HTML for finished content into the page up front, so the first paint already shows
the menu, prices, hours, address, phone and reviews, and a crawler that doesn't run scripts reads
them too.

Rules it follows, matching site.js:
  - Anything still in [square brackets] is skipped, exactly as site.js hides it.
  - Empty states, preview mode (?preview=1), forms, the gallery and the special stay in site.js.
  - If a block has nothing finished to show, it is left empty for site.js to deal with.

Keep this file in step with assets/js/site.js: same filtering, same markup.
"""
import html as _html
import math
import re
from urllib.parse import quote

DEFAULT_NAME = "Dory's Bakehouse"


# ------------------------------------------------------------------ helpers
def _s(v):
    return "" if v is None else str(v)


def _ph(v):
    """Still a [placeholder]?"""
    return bool(re.search(r"\[.*\]", _s(v)))


def _ok(v):
    """Finished enough to show visitors?"""
    s = _s(v).strip()
    return bool(s) and not _ph(s)


def _esc(v):
    return _html.escape(_s(v), quote=True)


def _br(h):
    return h.replace("\n", "<br>")


def _slug(v):
    return re.sub(r"[^a-z0-9]+", "-", _s(v).lower()).strip("-")


def _price(p):
    """120 -> ₹120, 1500 -> ₹1,500 (Indian digit grouping). Anything else is left as written."""
    s = _s(p).strip()
    if not re.fullmatch(r"\d+(\.\d{1,2})?", s):
        return s
    whole, _, frac = s.partition(".")
    whole = str(int(whole))
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        whole = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head) + "," + tail
    frac = frac.rstrip("0")
    return "₹" + whole + ("." + frac if frac else "")


def _enc(v):
    """JavaScript's encodeURIComponent."""
    return quote(_s(v), safe="-_.!~*'()")


def _round(x):
    """JavaScript's Math.round (halves go up), unlike Python's round()."""
    return int(math.floor(x + 0.5))


# Cloudinary photos at the size the screen needs
_CLD = re.compile(r"^https://res\.cloudinary\.com/[^/]+/image/upload/")
_CLD_SWAP = re.compile(r"/image/upload/(?:f_auto,q_auto(?:,c_limit,w_\d+)?/)?")


def _wm_layer(w, text, diagonal):
    """The watermark Cloudinary draws on gallery photos. Same as wmLayer() in site.js."""
    txt = quote(text[:40], safe="-_.~")
    if diagonal:
        big = max(24, _round(w * 0.8 / max(8, len(text) * 0.58)))
        return (f"/l_text:Georgia_{big}_bold:{txt},co_rgb:FFFFFF,o_35,a_-30"
                "/e_shadow:30,co_rgb:000000,x_2,y_2/fl_layer_apply,g_center")
    fs, pad = max(14, _round(w * 0.034)), max(10, _round(w * 0.025))
    return (f"/l_text:Georgia_{fs}_bold:{txt},co_rgb:FFFFFF,o_85"
            f"/e_shadow:40,co_rgb:000000,x_1,y_1/fl_layer_apply,g_south_east,x_{pad},y_{pad}")


def _cld(src, w, wm=None):
    """`wm` is (text, diagonal) to draw the watermark, or None."""
    if not _CLD.match(src):
        return src
    layer = _wm_layer(w, wm[0], wm[1]) if wm else ""
    return _CLD_SWAP.sub(lambda m: f"/image/upload/f_auto,q_auto,c_limit,w_{w}{layer}/", src, count=1)


def _img(src, alt, widths, sizes, extra="", wm=None):
    src = _s(src)
    if not _CLD.match(src):
        local = src if re.match(r"https?://", src) else "/" + src.lstrip("/")
        return f'<img src="{_esc(local)}" alt="{_esc(alt)}"{extra}>'
    srcset = ", ".join(f"{_esc(_cld(src, w, wm))} {w}w" for w in widths)
    first = _cld(src, widths[min(1, len(widths) - 1)], wm)
    return f'<img src="{_esc(first)}" srcset="{srcset}" sizes="{sizes}" alt="{_esc(alt)}"{extra}>'


# ------------------------------------------------------------------ block renderers
def _menu(d):
    """(tabs_html, menu_html), or (None, None) when no section has a finished item."""
    sections = []
    for s in d.get("menu") or []:
        items = [i for i in (s.get("items") or []) if _ok(i.get("name"))]
        if _ok(s.get("section")) and items:
            sections.append((s, items))
    if not sections:
        return None, None
    tabs = "".join(f'<a href="#{_slug(s["section"])}">{_esc(s["section"])}</a>' for s, _ in sections)
    out = []
    for s, items in sections:
        rows = []
        for i in items:
            tags = "".join(f'<span class="tag {_esc(_slug(g))}">{_esc(g)}</span>' for g in (i.get("tags") or []))
            pic = ""
            if i.get("image"):
                pic = '<span class="thumb">' + _img(i["image"], i["name"], [96, 192], "96px", ' loading="lazy" decoding="async"') + "</span>"
            rows.append(
                f'<li class="menu-item{" has-thumb" if pic else ""}">{pic}'
                f'<span class="name">{_esc(i["name"])}{tags}</span>'
                f'<span class="price">{_esc(_price(i.get("price"))) if _ok(i.get("price")) else ""}</span>'
                + (f'<p class="desc">{_esc(i["desc"])}</p>' if _ok(i.get("desc")) else "")
                + "</li>")
        note = f'<span class="muted">{_esc(s["note"])}</span>' if _ok(s.get("note")) else ""
        out.append(f'<section class="menu-section" id="{_slug(s["section"])}"><header><h2>{_esc(s["section"])}</h2>{note}'
                   f'</header><ul class="menu-list">{"".join(rows)}</ul></section>')
    return tabs, "".join(out)


def _highlights(d, name):
    hl = [h for h in (d.get("highlights") or []) if _ok(h.get("title"))]
    if not hl:
        return None
    out = []
    for h in hl:
        pic = (_img(h["image"], h["title"], [240, 480], "240px", ' loading="lazy"') if h.get("image")
               else f'<span aria-hidden="true">{_esc(name[:1])}</span>')
        out.append(f'<article class="highlight"><div class="img">{pic}</div><h3>{_esc(h["title"])}</h3>'
                   + (f'<p class="muted">{_esc(h["desc"])}</p>' if _ok(h.get("desc")) else "") + "</article>")
    return "".join(out)


def _reviews(d):
    revs = [r for r in ((d.get("reviews") or {}).get("items") or []) if _ok(r.get("quote")) and _ok(r.get("name"))]
    if not revs:
        return None
    out = []
    for r in revs:
        src = f'<span class="src">{_esc(r["source"])}</span>' if _ok(r.get("source")) else ""
        detail = " · " + _esc(r["detail"]) if _ok(r.get("detail")) else ""
        out.append(f'<figure class="review"><blockquote>{_br(_esc(r["quote"]))}</blockquote>'
                   f'<figcaption><strong>{_esc(r["name"])}</strong>{detail}{src}</figcaption></figure>')
    return "".join(out)


def _faq(d):
    faq = [x for x in (d.get("faq") or []) if _ok(x.get("q")) and _ok(x.get("a"))]
    if not faq:
        return None
    return "".join(f'<details><summary>{_esc(x["q"])}</summary><p>{_br(_esc(x["a"]))}</p></details>' for x in faq)


def _about(d):
    a = d.get("about") or {}
    heading = _esc(a["heading"]) if _ok(a.get("heading")) else "Our story"
    story = [p for p in (a.get("story") or []) if _ok(p)]
    story_html = ("".join(f"<p>{_esc(p)}</p>" for p in story) if story
                  else "<p>Fresh bakes and celebration cakes, made by hand. Our full story is coming soon.</p>")
    values = [v for v in (a.get("values") or []) if _ok(v.get("title"))]
    values_html = "".join(
        f'<div><h3>{_esc(v["title"])}</h3>' + (f'<p class="muted">{_esc(v["desc"])}</p>' if _ok(v.get("desc")) else "") + "</div>"
        for v in values) or None
    return heading, story_html, values_html


def _wa(digits, msg):
    return "https://wa.me/" + digits + "?text=" + _enc(msg)


def _featured(d, name, digits):
    """Featured cake cards on the home page (up to 6). `digits` is the WhatsApp number, or "" if none."""
    items = [c for c in (d.get("featured") or []) if _ok(c.get("name"))][:6]
    if not items:
        return None
    out = []
    for c in items:
        pic = ""
        if c.get("image"):
            pic = ('<div class="cake-img">' + _img(c["image"], c["name"], [320, 640], "(max-width: 640px) 92vw, 320px",
                                                  ' loading="lazy" decoding="async"') + "</div>")
        facts = []
        if _ok(c.get("sizes")):
            facts.append("Sizes: " + _esc(c["sizes"]))
        if _ok(c.get("price")):
            p = _price(c["price"])
            facts.append(("From " if p.startswith("₹") else "") + _esc(p))
        if _ok(c.get("notice")):
            facts.append("Notice: " + _esc(c["notice"]))
        msg = "\n".join([f"Hi {name}! I'd like a cake like this one: {_s(c['name'])}", "",
                         "Date needed: ", "Size / servings: ", "Flavour: ", "Eggless: "])
        btn = (f'<a class="btn ghost" target="_blank" rel="noopener" href="{_esc(_wa(digits, msg))}">Enquire on WhatsApp</a>'
               if digits else "")
        out.append(
            '<article class="cake-card">' + pic + '<div class="cake-body">'
            + (f'<p class="cake-cat">{_esc(c["category"])}</p>' if _ok(c.get("category")) else "")
            + f'<h3>{_esc(c["name"])}</h3>'
            + (f'<p class="muted">{_esc(c["flavour"])}</p>' if _ok(c.get("flavour")) else "")
            + ('<ul class="cake-meta">' + "".join(f"<li>{x}</li>" for x in facts) + "</ul>" if facts else "")
            + btn + "</div></article>")
    return "".join(out)


def _gallery(d, name):
    """Gallery photos, so Google can see them. Same watermark settings as site.js."""
    g = d.get("gallery") or []
    if not g:
        return None
    w = d.get("watermark") or {}
    text = _s(w.get("text")).strip()
    text = text if text and not _ph(w.get("text")) else name
    wm = (text, w.get("style") == "diagonal") if w.get("show") is not False else None
    figs = []
    for i, p in enumerate(g):
        cap = p.get("caption")
        alt = cap or f"{name} cake, photo {i + 1}"
        figs.append(
            f'<figure data-i="{i}" tabindex="0" role="button" aria-label="{_esc("View " + _s(alt))}">'
            + _img(p.get("src"), alt, [400, 800, 1200], "(max-width: 640px) 92vw, (max-width: 1000px) 45vw, 360px",
                   f' loading="{"eager" if i < 3 else "lazy"}" decoding="async"', wm)
            + (f"<figcaption>{_esc(cap)}</figcaption>" if cap else "") + "</figure>")
    return '<div class="gallery">' + "".join(figs) + "</div>"


def _hero(d, name):
    """(has_special, hero_photo_html_or_None) for the home page."""
    sp = d.get("special") or {}
    has_special = bool(sp.get("show")) and _ok(sp.get("title"))
    h = d.get("hero") or {}
    photo = None
    if h.get("image"):
        alt = _s(h.get("alt")).strip() or f"{name} custom cake"
        photo = _img(h["image"], alt, [480, 960], "(max-width: 900px) 92vw, 480px", ' fetchpriority="high"')
    return has_special, photo


def _hours(d):
    rows = [h for h in (d.get("hours") or []) if _ok(h.get("days")) and _ok(h.get("time"))]
    li = "".join(f'<li>{_esc(h["days"])}<br><strong>{_esc(h["time"])}</strong></li>' for h in rows)
    tr = "".join(f'<tr><td>{_esc(h["days"])}</td><td>{_esc(h["time"])}</td></tr>' for h in rows)
    return li or None, tr or None


def _insta_handle(v):
    v = re.sub(r"^@", "", _s(v))
    v = re.sub(r"^https?://(www\.)?instagram\.com/", "", v)
    return re.sub(r"/.*$", "", v)


# ------------------------------------------------------------------ page surgery
def _fill_attr(page, attr, inner):
    """Put `inner` into every empty element carrying the data-<attr> marker, e.g. <p data-address></p>."""
    if not inner:
        return page
    pat = re.compile(r"(<(\w+)\b[^>]*?\sdata-" + re.escape(attr) + r"(?=[\s>=/])[^>]*>)(</\2>)")
    return pat.sub(lambda m: m.group(1) + inner + m.group(3), page)


def _fill_id(page, ident, inner):
    """Put `inner` into the empty element with this id."""
    if not inner:
        return page
    pat = re.compile(r'(<(\w+)\b[^>]*?\sid="' + re.escape(ident) + r'"[^>]*>)(</\2>)')
    return pat.sub(lambda m: m.group(1) + inner + m.group(3), page, count=1)


def _remove_el(page, tag, ident):
    """Delete the element <tag id="ident">…</tag> (these have no nested tag of the same name)."""
    pat = re.compile(r"<" + tag + r'\b[^>]*?\sid="' + re.escape(ident) + r'"[^>]*>.*?</' + tag + ">", re.S)
    return pat.sub("", page, count=1)


def _unhide(page, ident):
    """Drop the hidden attribute from the element with this id."""
    pat = re.compile(r'(<\w+\b[^>]*?\sid="' + re.escape(ident) + r'"[^>]*?)\shidden(?=[\s>])')
    return pat.sub(lambda m: m.group(1), page, count=1)


def _add_class(page, existing, new):
    pat = re.compile(r'class="([^"]*\b' + re.escape(existing) + r'\b[^"]*)"')
    return pat.sub(lambda m: m.group(0) if new in m.group(1).split() else f'class="{m.group(1)} {new}"', page, count=1)


def _link_whatsapp(page, href):
    tag = re.compile(r"<a\b[^>]*?\sdata-wa(?=[\s>=/])[^>]*>")
    return tag.sub(lambda m: m.group(0).replace('href="#"', f'href="{_esc(href)}" target="_blank" rel="noopener"', 1), page)


def _link_map(page, href):
    tag = re.compile(r"<a\b[^>]*?\sdata-maplink(?=[\s>=/])[^>]*>")
    return tag.sub(lambda m: m.group(0) if " href=" in m.group(0) else m.group(0)[:2] + f' href="{_esc(href)}"' + m.group(0)[2:], page)


def _rename(page, name):
    pat = re.compile(r"(<(\w+)\b[^>]*?\sdata-name(?=[\s>=/])[^>]*>)[^<]*(</\2>)")
    return pat.sub(lambda m: m.group(1) + _esc(name) + m.group(3), page)


def render(body, d):
    """`body` is the page HTML after </head>; `d` is the content dict. Returns the page with the
    finished content already in place. Never raises for odd content: callers also guard it."""
    if not isinstance(d, dict) or not d:
        return body
    c = d.get("contact") or {}
    k = d.get("cakes") or {}
    name = _s(d.get("name")).strip() if _ok(d.get("name")) else DEFAULT_NAME

    if name != DEFAULT_NAME:
        body = _rename(body, name)

    # Name, address, phone: what Google and customers look for first
    if _ok(d.get("tagline")):
        body = _fill_attr(body, "tagline", _esc(d["tagline"]))
    if _ok(c.get("address")):
        body = _fill_attr(body, "address", _br(_esc(c["address"])))
    if _ok(c.get("phone")):
        tel = "tel:" + re.sub(r"[^\d+]", "", _s(c["phone"]))
        body = _fill_attr(body, "phone", f'<a href="{_esc(tel)}">{_esc(c["phone"])}</a>')
    if _ok(c.get("email")):
        body = _fill_attr(body, "email", f'<a href="mailto:{_esc(c["email"])}">{_esc(c["email"])}</a>')
    if _ok(c.get("instagram")):
        h = _insta_handle(c["instagram"])
        body = _fill_attr(body, "instagram", f'<a href="https://instagram.com/{_esc(h)}" target="_blank" rel="noopener">@{_esc(h)}</a>')
    if _ok(c.get("fssai")):
        body = _fill_attr(body, "fssai", "FSSAI Lic. No. " + _esc(c["fssai"]))
    if _ok(c.get("areas")):
        body = _fill_attr(body, "areas", "We bake for " + _esc(c["areas"]))
    if _ok(k.get("leadTime")):
        body = _fill_attr(body, "leadtime", _esc(k["leadTime"]))
    if _ok(k.get("startingPrice")):
        body = _fill_attr(body, "startprice", _esc(_price(k["startingPrice"])))

    li, tr = _hours(d)
    body = _fill_attr(body, "hours", li)
    body = _fill_attr(body, "hours-table", tr)

    # Links that work before any script runs
    digits = re.sub(r"\D", "", _s(c.get("whatsapp")))
    if len(digits) < 10 or _ph(c.get("whatsapp")):
        digits = ""
    if digits:
        body = _link_whatsapp(body, _wa(digits, f"Hi {name}! "))
    ml = _s(c.get("mapLink")).strip()
    if _ok(ml) and re.match(r"https?://", ml):
        body = _link_map(body, ml)

    # Home hero: the photo, and no empty yellow card or empty column when there is nothing to put in them
    if 'id="hero-side"' in body:
        has_special, photo = _hero(d, name)
        if not has_special and not photo:
            body = _remove_el(body, "div", "hero-side")
            body = _add_class(body, "hero-grid", "solo")
        else:
            if not has_special:
                body = _remove_el(body, "aside", "special")
            if photo:
                body = _fill_id(body, "hero-photo", photo)
            else:
                body = _remove_el(body, "figure", "hero-photo")
    cards = _featured(d, name, digits)
    if cards:
        body = _fill_id(body, "featured", cards)
        body = _unhide(body, "featured-section")
    body = _fill_id(body, "gallery", _gallery(d, name))

    # Page content
    tabs, menu = _menu(d)
    body = _fill_id(body, "menu-tabs", tabs)
    body = _fill_id(body, "menu", menu)
    body = _fill_id(body, "highlights", _highlights(d, name))
    body = _fill_id(body, "reviews", _reviews(d))
    body = _fill_id(body, "faq", _faq(d))
    heading, story, values = _about(d)
    if 'id="about-heading"' in body:
        body = _fill_id(body, "about-heading", heading)
        body = _fill_id(body, "about-story", story)
        body = _fill_id(body, "values", values)
    return body
