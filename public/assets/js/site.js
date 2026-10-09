/* Dory's Bakehouse: renders content.js into the pages. No edits needed here.

   Anything still containing [square-bracket] placeholder text is HIDDEN from visitors.
   To see those unfinished items highlighted in yellow, open any page with ?preview=1
   (the admin's "Preview site" button does this). */
(function () {
  var D = window.DORYS || {};
  var C = D.contact || {};
  var PREVIEW = /[?&]preview=1\b/.test(location.search);
  var NAME = D.name && !isPh(D.name) ? D.name : "Dory's Bakehouse";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isPh(s) { return /\[.*\]/.test(String(s || "")); }
  // Is this value finished enough to show? In preview mode, unfinished values show (highlighted).
  function ok(s) { s = String(s == null ? "" : s).trim(); return !!s && (PREVIEW || !isPh(s)); }
  // Escape text; in preview, highlight [placeholders]
  function t(s) { return esc(s).replace(/\[([^\]]*)\]/g, '<span class="ph">$1</span>'); }
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function hide(el) { if (el) { el.hidden = true; el.setAttribute("aria-hidden", "true"); } }
  // The block an element lives in, which disappears when there's nothing to show
  function box(el) { return el.closest("li, tr, p") || el; }
  // Fill every [sel] with html when the value is finished; otherwise hide its line
  function put(sel, value, html) {
    $all(sel).forEach(function (el) {
      if (ok(value)) { el.innerHTML = html === undefined ? t(value) : html; }
      else hide(box(el));
    });
  }

  // 120 → ₹120; 1500 → ₹1,500. Anything else (₹120, "from 450", "Ask us") is left as written.
  function price(p) {
    var s = String(p == null ? "" : p).trim();
    return /^\d+(\.\d{1,2})?$/.test(s) ? "₹" + Number(s).toLocaleString("en-IN") : s;
  }

  // Cloudinary photos at the size the screen needs instead of one large size for everyone
  function isCld(src) { return /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(String(src || "")); }
  // Watermark for gallery photos, drawn by Cloudinary when the photo is delivered: the original stays clean
  var WM = D.watermark || {};
  var WM_ON = WM.show !== false, WM_TEXT = String(WM.text || "").trim() && !isPh(WM.text) ? String(WM.text).trim() : NAME;
  var WM_DIAGONAL = WM.style === "diagonal";
  function wmLayer(w) {
    var txt = encodeURIComponent(WM_TEXT.slice(0, 40)).replace(/'/g, "%27").replace(/[!()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); });
    if (WM_DIAGONAL) {  // large, faint, across the middle: harder to crop out, but it covers the cake
      var big = Math.max(24, Math.round(w * 0.8 / Math.max(8, WM_TEXT.length * 0.58)));
      return "/l_text:Georgia_" + big + "_bold:" + txt + ",co_rgb:FFFFFF,o_35,a_-30/e_shadow:30,co_rgb:000000,x_2,y_2/fl_layer_apply,g_center";
    }
    var fs = Math.max(14, Math.round(w * 0.034)), pad = Math.max(10, Math.round(w * 0.025));
    return "/l_text:Georgia_" + fs + "_bold:" + txt + ",co_rgb:FFFFFF,o_85/e_shadow:40,co_rgb:000000,x_1,y_1/fl_layer_apply,g_south_east,x_" + pad + ",y_" + pad;
  }
  function cld(src, w, wm) {
    if (!isCld(src)) return src;
    return src.replace(/\/image\/upload\/(?:f_auto,q_auto(?:,c_limit,w_\d+)?\/)?/, "/image/upload/f_auto,q_auto,c_limit,w_" + w + (wm ? wmLayer(w) : "") + "/");
  }
  function img(src, alt, widths, sizes, extra, wm) {
    src = String(src || "");
    var local = /^https?:\/\//.test(src) ? src : "/" + src.replace(/^\//, "");
    if (!isCld(src)) return '<img src="' + esc(local) + '" alt="' + esc(alt) + '"' + (extra || "") + ">";
    var set = widths.map(function (w) { return esc(cld(src, w, wm)) + " " + w + "w"; }).join(", ");
    return '<img src="' + esc(cld(src, widths[Math.min(1, widths.length - 1)], wm)) + '" srcset="' + set +
      '" sizes="' + sizes + '" alt="' + esc(alt) + '"' + (extra || "") + ">";
  }

  function track(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, Object.assign({ page: location.pathname }, params || {})); } catch (e) {}
  }

  function waNumber() { return String(C.whatsapp || "").replace(/\D/g, ""); }
  function hasWa() { return waNumber().length >= 10 && !isPh(C.whatsapp); }
  function waLink(msg) { return "https://wa.me/" + waNumber() + (msg ? "?text=" + encodeURIComponent(msg) : ""); }
  function telLink() { return "tel:" + String(C.phone || "").replace(/[^\d+]/g, ""); }
  function igHandle() { return String(C.instagram || "").replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, ""); }

  /* ---------- Preview mode ---------- */
  if (PREVIEW) {
    $all('a[href$=".html"], a[href="/"]').forEach(function (a) {
      if (a.getAttribute("href").indexOf("?") < 0) a.setAttribute("href", a.getAttribute("href") + "?preview=1");
    });
    var bar = document.createElement("div");
    bar.className = "preview-bar";
    bar.innerHTML = "Preview: items highlighted in yellow are unfinished and are <strong>hidden from visitors</strong>. " +
      '<a href="' + location.pathname + '">See what visitors see</a>';
    document.body.appendChild(bar);
  }

  /* ---------- Nav ---------- */
  var toggle = $(".menu-toggle"), nav = $(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "Close" : "Menu";
    });
  }

  /* ---------- Shared bits (header, footer, contact) ---------- */
  $all("[data-name]").forEach(function (el) { el.textContent = NAME; });
  if (NAME !== "Dory's Bakehouse") document.title = document.title.split("Dory's Bakehouse").join(NAME);
  put("[data-tagline]", D.tagline);
  put("[data-address]", C.address, t(C.address).replace(/\n/g, "<br>"));
  put("[data-phone]", C.phone, '<a href="' + telLink() + '">' + esc(C.phone) + "</a>");
  put("[data-email]", C.email, '<a href="mailto:' + esc(C.email) + '">' + esc(C.email) + "</a>");
  put("[data-instagram]", C.instagram, '<a href="https://instagram.com/' + esc(igHandle()) + '" target="_blank" rel="noopener">@' + esc(igHandle()) + "</a>");

  var hours = (D.hours || []).filter(function (h) { return ok(h.days) && ok(h.time); });
  $all("[data-hours]").forEach(function (el) {
    if (!hours.length) return hide(el.parentElement);
    el.innerHTML = hours.map(function (h) { return "<li>" + t(h.days) + "<br><strong>" + t(h.time) + "</strong></li>"; }).join("");
  });
  $all("[data-hours-table]").forEach(function (el) {
    var table = el.closest("table");
    if (!hours.length) { hide(table); if (table && table.previousElementSibling) hide(table.previousElementSibling); return; }
    el.innerHTML = hours.map(function (h) { return "<tr><td>" + t(h.days) + "</td><td>" + t(h.time) + "</td></tr>"; }).join("");
  });

  $all("[data-maplink]").forEach(function (a) {
    if (ok(C.mapLink) && !isPh(C.mapLink)) a.href = C.mapLink;
    else hide(a.closest("p") || a);
  });
  $all("[data-wa]").forEach(function (a) {
    if (!hasWa()) return hide(a.classList.contains("wa-float") ? a : (a.closest("p") || a));
    a.href = waLink("Hi " + NAME + "! ");
    a.target = "_blank"; a.rel = "noopener";
  });
  $all("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  // An address/hours/phone column with nothing left in it disappears too
  $all(".visit .inner > div, .foot-grid > div").forEach(function (col) {
    if (col.querySelector("[data-name]")) return;  // the bakery-name column always stays
    var visible = Array.prototype.some.call(col.querySelectorAll("p, li, a.btn"), function (n) { return !n.closest("[hidden]"); });
    if (!visible) hide(col);
  });

  /* ---------- Home: special ---------- */
  var sp = D.special || {}, spEl = $("#special");
  if (spEl) {
    if (!sp.show || !ok(sp.title)) {
      spEl.remove();
      var hg = $(".hero-grid"); if (hg) hg.classList.add("solo");
    } else {
      spEl.innerHTML =
        (sp.image ? img(sp.image, sp.title, [480, 960], "(max-width: 900px) 92vw, 480px") : "") +
        '<div class="kicker">This week\'s special</div>' +
        "<h2>" + t(sp.title) + "</h2>" +
        (ok(sp.description) ? "<p>" + t(sp.description) + "</p>" : "") +
        ((ok(sp.price) || ok(sp.validTill)) ? '<div class="foot"><span class="price">' + (ok(sp.price) ? t(price(sp.price)) : "") + "</span>" +
          (ok(sp.validTill) ? "<span>Until " + t(sp.validTill) + "</span>" : "") + "</div>" : "");
    }
  }

  /* ---------- Home: highlights ---------- */
  var hl = (D.highlights || []).filter(function (h) { return ok(h.title); });
  var hlEl = $("#highlights");
  if (hlEl) {
    if (!hl.length) hide(hlEl.closest("section"));
    else hlEl.innerHTML = hl.map(function (h) {
      return '<article class="highlight"><div class="img">' +
        (h.image ? img(h.image, h.title, [240, 480], "240px", ' loading="lazy"') : '<span aria-hidden="true">' + esc(NAME.charAt(0)) + "</span>") +
        "</div><h3>" + t(h.title) + "</h3>" + (ok(h.desc) ? '<p class="muted">' + t(h.desc) + "</p>" : "") + "</article>";
    }).join("");
  }

  /* ---------- Menu ---------- */
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  var menu = (D.menu || []).map(function (s) {
    return { section: s.section, note: s.note, items: (s.items || []).filter(function (i) { return ok(i.name); }) };
  }).filter(function (s) { return ok(s.section) && s.items.length; });
  var menuEl = $("#menu");
  if (menuEl) {
    if (!menu.length) {
      hide($("#menu-tabs"));
      menuEl.innerHTML = '<div class="empty"><h2>Our menu is being updated</h2><p class="muted">Ask us what\'s fresh today.</p>' +
        (hasWa() ? '<a class="btn" href="' + esc(waLink("Hi " + NAME + "! What's fresh today?")) + '" target="_blank" rel="noopener">Ask on WhatsApp</a>' : "") + "</div>";
    } else {
      $("#menu-tabs").innerHTML = menu.map(function (s) { return '<a href="#' + slug(s.section) + '">' + esc(s.section) + "</a>"; }).join("");
      menuEl.innerHTML = menu.map(function (s) {
        return '<section class="menu-section" id="' + slug(s.section) + '"><header><h2>' + t(s.section) + "</h2>" +
          (ok(s.note) ? '<span class="muted">' + t(s.note) + "</span>" : "") + '</header><ul class="menu-list">' +
          s.items.map(function (i) {
            var tags = (i.tags || []).map(function (g) { return '<span class="tag ' + esc(slug(g)) + '">' + esc(g) + "</span>"; }).join("");
            var pic = i.image ? '<span class="thumb">' + img(i.image, i.name, [96, 192], "96px", ' loading="lazy" decoding="async"') + "</span>" : "";
            return '<li class="menu-item' + (pic ? " has-thumb" : "") + '">' + pic +
              '<span class="name">' + t(i.name) + tags + "</span>" +
              '<span class="price">' + (ok(i.price) ? t(price(i.price)) : "") + "</span>" +
              (ok(i.desc) ? '<p class="desc">' + t(i.desc) + "</p>" : "") + "</li>";
          }).join("") + "</ul></section>";
      }).join("");
    }
  }

  /* ---------- About ---------- */
  var A = D.about || {};
  var story = (A.story || []).filter(ok);
  var values = (A.values || []).filter(function (v) { return ok(v.title); });
  if ($("#about-heading")) {
    if (ok(A.heading)) $("#about-heading").innerHTML = t(A.heading);
    else $("#about-heading").textContent = "Our story";
    $("#about-story").innerHTML = story.length ? story.map(function (p) { return "<p>" + t(p) + "</p>"; }).join("")
      : "<p>Fresh bakes and celebration cakes, made by hand. Our full story is coming soon.</p>";
    var portrait = $("#about-portrait");
    if (A.image) portrait.innerHTML = img(A.image, "Inside " + NAME, [500, 1000], "(max-width: 900px) 92vw, 440px");
    else { hide(portrait); var ag = portrait.closest(".about-grid"); if (ag) ag.classList.add("solo"); }
  }
  var valEl = $("#values");
  if (valEl) {
    if (!values.length) hide(valEl.closest("section"));
    else valEl.innerHTML = values.map(function (v) {
      return "<div><h3>" + t(v.title) + "</h3>" + (ok(v.desc) ? '<p class="muted">' + t(v.desc) + "</p>" : "") + "</div>";
    }).join("");
  }

  /* ---------- Gallery ---------- */
  var gal = $("#gallery");
  if (gal) {
    var g = D.gallery || [];
    if (g.length) {
      gal.innerHTML = '<div class="gallery">' + g.map(function (p, i) {
        var alt = p.caption || (NAME + " bake, photo " + (i + 1));
        return '<figure data-i="' + i + '" tabindex="0" role="button" aria-label="' + esc("View " + alt) + '">' + img(p.src, alt, [400, 800, 1200], "(max-width: 640px) 92vw, (max-width: 1000px) 45vw, 360px",
          ' loading="' + (i < 3 ? "eager" : "lazy") + '" decoding="async"', WM_ON) +
          (p.caption ? "<figcaption>" + esc(p.caption) + "</figcaption>" : "") + "</figure>";
      }).join("") + "</div>";
      lightbox(g);
    } else {
      var ig = ok(C.instagram) && !isPh(C.instagram);
      gal.innerHTML = '<div class="empty"><h2>Photos coming soon</h2>' +
        (ig ? '<p class="muted">Until then, our latest bakes are on Instagram.</p><a class="btn" target="_blank" rel="noopener" href="https://instagram.com/' + esc(igHandle()) + '">See our Instagram</a>'
            : hasWa() ? '<p class="muted">Ask us for photos of recent cakes.</p><a class="btn" target="_blank" rel="noopener" href="' + esc(waLink("Hi " + NAME + "! Could you share some cake photos?")) + '">Ask on WhatsApp</a>' : "") +
        "</div>";
    }
  }

  /* ---------- Gallery: tap a photo to see it large and enquire on WhatsApp ---------- */
  // A WhatsApp link can only carry text, so the message includes a link to the photo; WhatsApp
  // shows it as a preview in the chat.
  function photoLink(src) {
    if (!isCld(src)) return location.origin + "/" + String(src).replace(/^\//, "");
    return src.replace(/\/image\/upload\/(?:f_auto,q_auto(?:,c_limit,w_\d+)?\/)?/, "/image/upload/f_jpg,q_auto,c_limit,w_1000/");
  }
  function lightbox(items) {
    var box = document.createElement("div");
    box.className = "lightbox"; box.hidden = true;
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Photo");
    box.innerHTML = '<button class="lb-close" type="button" aria-label="Close">×</button>' +
      '<button class="lb-prev" type="button" aria-label="Previous photo">‹</button>' +
      '<figure class="lb-fig"><div class="lb-img"></div><figcaption></figcaption>' +
      '<div class="lb-actions"><a class="btn" target="_blank" rel="noopener">Enquire about this cake</a>' +
      '<a class="btn ghost lb-form" href="cakes.html">Use the order form</a></div></figure>' +
      '<button class="lb-next" type="button" aria-label="Next photo">›</button>';
    document.body.appendChild(box);
    var cur = 0, lastFocus = null, enquire = box.querySelector(".lb-actions .btn");
    if (!hasWa()) hide(enquire);
    function show(i) {
      cur = (i + items.length) % items.length;
      var p = items[cur], alt = p.caption || (NAME + " bake, photo " + (cur + 1));
      box.querySelector(".lb-img").innerHTML = img(p.src, alt, [800, 1200, 1800], "(max-width: 900px) 94vw, 900px", "", WM_ON);
      box.querySelector("figcaption").textContent = p.caption || "";
      var clean = String(p.caption || "").trim();
      var msg = ["Hi " + NAME + "! I'd like a cake like this one from your gallery" + (clean ? ": " + clean : "") + ".",
        photoLink(p.src), "", "Date needed: ", "Size / servings: ", "Flavour: ", "Eggless: "].join("\n");
      enquire.href = waLink(msg);
      enquire.onclick = function () { track("whatsapp_order", { form: "gallery_photo", photo: clean || "photo " + (cur + 1) }); };
      box.querySelector(".lb-form").href = "cakes.html?photo=" + encodeURIComponent(clean || "Gallery photo " + (cur + 1));
    }
    function open(i) { lastFocus = document.activeElement; show(i); box.hidden = false; document.body.classList.add("lb-open"); box.querySelector(".lb-close").focus(); }
    function close() { box.hidden = true; document.body.classList.remove("lb-open"); if (lastFocus) lastFocus.focus(); }
    $all("#gallery figure[data-i]").forEach(function (f) {
      f.addEventListener("click", function () { open(+f.getAttribute("data-i")); });
      f.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(+f.getAttribute("data-i")); } });
    });
    box.querySelector(".lb-close").addEventListener("click", close);
    box.querySelector(".lb-prev").addEventListener("click", function () { show(cur - 1); });
    box.querySelector(".lb-next").addEventListener("click", function () { show(cur + 1); });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(cur - 1);
      else if (e.key === "ArrowRight") show(cur + 1);
    });
    var x0 = null;  // swipe left/right on phones
    box.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", function (e) {
      if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1));
    });
    if (items.length < 2) { hide(box.querySelector(".lb-prev")); hide(box.querySelector(".lb-next")); }
  }

  /* ---------- Contact map ---------- */
  var map = $("#map");
  if (map) {
    var embed = String(C.mapEmbed || "");
    if (/^https:\/\/www\.google\.com\/maps\/embed/.test(embed)) {
      map.innerHTML = '<iframe src="' + esc(embed) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map to ' + esc(NAME) + '"></iframe>';
    } else if (ok(C.mapLink) && !isPh(C.mapLink)) {
      map.classList.add("map-card");
      map.innerHTML = '<div><h2>Find us</h2>' + (ok(C.address) ? "<p>" + t(C.address).replace(/\n/g, "<br>") + "</p>" : "") +
        '<a class="btn" href="' + esc(C.mapLink) + '" target="_blank" rel="noopener">Open in Google Maps</a></div>';
    } else {
      hide(map); var cg = map.closest(".contact-grid"); if (cg) cg.classList.add("solo");
    }
  }

  /* ---------- Cake order form → WhatsApp ---------- */
  var K = D.cakes || {};
  put("[data-leadtime]", K.leadTime);
  put("[data-startprice]", K.startingPrice, t(price(K.startingPrice)));
  var cakeNotes = (K.notes || []).filter(ok);
  var notesEl = $("#cake-notes");
  if (notesEl) {
    if (cakeNotes.length) notesEl.innerHTML = cakeNotes.map(function (n) { return "<li>" + t(n) + "</li>"; }).join("");
    else hide(notesEl);
  }
  // "Good to know" heading goes when everything under it is hidden
  var gtk = $all("h3").filter(function (h) { return /good to know/i.test(h.textContent); })[0];
  if (gtk) {
    var anyFact = $all(".facts li").some(function (li) { return !li.closest("[hidden]"); });
    if (!anyFact) hide(gtk);
  }

  function clean(list) { return (list || []).filter(ok).map(function (v) { return PREVIEW ? String(v).replace(/[\[\]]/g, "") : String(v); }); }
  function chips(name, list, type) {
    return list.map(function (v) {
      return '<label><input type="' + type + '" name="' + name + '" value="' + esc(v) + '"><span>' + esc(v) + "</span></label>";
    }).join("");
  }
  // Flavours: the admin's Flavours list (with descriptions) if it has any finished entries, else the plain names
  var FL = (D.flavours || []).filter(function (x) { return ok(x.name); });
  var flavourNames = FL.length ? FL.map(function (x) { return PREVIEW ? String(x.name).replace(/[\[\]]/g, "") : String(x.name); }) : null;
  var occasions = clean(K.occasions), sizes = clean(K.sizes), flavours = flavourNames || clean(K.flavours);
  var oc = $("#occasion-chips"); if (oc) oc.innerHTML = chips("occasion", occasions, "radio");
  var sc = $("#size-chips"); if (sc) sc.innerHTML = chips("size", sizes, "radio");
  var fl = $("#flavour");
  if (fl) {
    if (!flavours.some(function (f) { return /something else|other|custom/i.test(f); })) flavours.push("Something else (tell us)");
    fl.innerHTML = '<option value="">Choose a flavour</option>' + flavours.map(function (f) { return "<option>" + esc(f) + "</option>"; }).join("");
  }

  var form = $("#cake-form");
  if (form) {
    var d = form.querySelector("#date");
    if (d) { var min = new Date(); min.setDate(min.getDate() + 2); d.min = min.toISOString().slice(0, 10); }
    if (!hasWa()) {
      var submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      form.querySelector(".form-error").textContent = "Online cake orders are opening soon." + (ok(C.phone) && !isPh(C.phone) ? " Call us on " + C.phone + " to order." : "");
    }
    var fromPhoto = (location.search.match(/[?&]photo=([^&]*)/) || [])[1];
    if (fromPhoto) { var nt = form.querySelector("#notes"); if (nt && !nt.value) nt.value = "Like the gallery photo: " + decodeURIComponent(fromPhoto.replace(/\+/g, " ")).slice(0, 120); }
    var rm = form.querySelector("#remind"), rp = form.querySelector("#remind-person");
    if (rm && rp) rm.addEventListener("change", function () { rp.hidden = !rm.checked; if (rm.checked) rp.focus(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(form), err = form.querySelector(".form-error");
      var need = [["name", "your name"], ["phone", "your phone number"], ["date", "the date you need it"], ["occasion", "the occasion"], ["size", "a size"], ["flavour", "a flavour"]];
      for (var i = 0; i < need.length; i++) {
        if (!String(f.get(need[i][0]) || "").trim()) { err.textContent = "Add " + need[i][1] + " to send the order."; return; }
      }
      if (!hasWa()) { err.textContent = "Online cake orders are opening soon."; return; }
      err.textContent = "";
      var dt = new Date(f.get("date") + "T00:00");
      var lines = [
        "Hi " + NAME + "! I'd like to order a custom cake.",
        "",
        "Name: " + f.get("name"),
        "Phone: " + f.get("phone"),
        "Occasion: " + f.get("occasion"),
        "Date needed: " + dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
        "Size: " + f.get("size"),
        "Flavour: " + f.get("flavour"),
        "Eggless: " + (f.get("eggless") ? "Yes" : "No"),
        "Delivery: " + (f.get("delivery") || "Pickup")
      ];
      if (String(f.get("message") || "").trim()) lines.push("Message on cake: " + f.get("message"));
      if (String(f.get("notes") || "").trim()) lines.push("Design notes: " + f.get("notes"));
      if (f.get("remind")) {
        lines.push("Remind me next year: Yes" + (String(f.get("person") || "").trim() ? " (" + f.get("person") + ")" : ""));
        try {  // saved with consent; don't wait for it, so WhatsApp still opens straight away
          fetch("/api/remind", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: f.get("name"), phone: f.get("phone"), occasion: f.get("occasion"), person: f.get("person") || "",
              date: f.get("date"), consent: true, website: f.get("website") || "" }) }).catch(function () {});
        } catch (x) {}
        track("reminder_optin", { occasion: String(f.get("occasion") || "") });
      }
      track("whatsapp_order", { form: "custom_cake", occasion: String(f.get("occasion") || ""), size: String(f.get("size") || "") });
      window.open(waLink(lines.join("\n")), "_blank", "noopener");
    });
  }
  /* ---------- Gifting (gifting.html + home banner) ---------- */
  var G = D.gifting || {};
  var boxes = (G.boxes || []).filter(function (b) { return ok(b.name); });
  var giftOn = !!G.show && ok(G.title) && boxes.length > 0;
  $all("[data-gift-link]").forEach(function (a) {
    if (!giftOn && !PREVIEW && a.getAttribute("aria-current") !== "page") hide(a);
  });
  var band = $("#gift-band");
  if (band && giftOn) {
    if (ok(G.kicker)) $("#gift-band-kicker").innerHTML = t(G.kicker); else hide($("#gift-band-kicker"));
    $("#gift-band-title").innerHTML = t(G.title);
    var bt = ok(G.deadline) ? G.deadline : G.intro;
    if (ok(bt)) $("#gift-band-text").innerHTML = t(bt); else hide($("#gift-band-text"));
    band.hidden = false; band.removeAttribute("aria-hidden");
  }
  var giftEl = $("#gift-boxes");
  if (giftEl) {
    var showBoxes = (giftOn || PREVIEW) && boxes.length > 0;
    if (showBoxes) {
      if (ok(G.title)) $("#gift-title").innerHTML = t(G.title);
      if (ok(G.intro)) $("#gift-intro").innerHTML = t(G.intro);
      if (ok(G.kicker)) { $("#gift-kicker").innerHTML = t(G.kicker); $("#gift-kicker").hidden = false; }
      if (ok(G.deadline)) { $("#gift-deadline").innerHTML = t(G.deadline); $("#gift-deadline").hidden = false; }
      if (PREVIEW && !G.show) {
        var note = document.createElement("p"); note.className = "gift-deadline";
        note.innerHTML = "<span class=\"ph\">Gifting is switched off. Visitors see only the bulk-order box below. Turn on “Show gift boxes” in the admin to publish.</span>";
        giftEl.parentNode.insertBefore(note, giftEl);
      }
      var qty = '<option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option><option>8</option><option>10</option><option value="10+">10+</option>';
      giftEl.innerHTML = boxes.map(function (b, i) {
        var items = String(b.contents || "").split(/\n+/).filter(function (l) { return ok(l); });
        return '<article class="gift-card">' +
          (b.image ? '<div class="gift-img">' + img(b.image, b.name, [480, 960], "(max-width: 700px) 92vw, 360px", ' loading="lazy" decoding="async"') + "</div>" : "") +
          '<div class="gift-body"><header><h2>' + t(b.name) + "</h2>" + (ok(b.price) ? '<span class="price">' + t(price(b.price)) + "</span>" : "") + "</header>" +
          (items.length ? '<ul class="gift-items">' + items.map(function (l) { return "<li>" + t(l.replace(/^[-•*]\s*/, "")) + "</li>"; }).join("") + "</ul>" : "") +
          (hasWa() ? '<div class="gift-order"><label>Boxes <select data-qty="' + i + '">' + qty + '</select></label>' +
            '<button class="btn" type="button" data-gift="' + i + '">Order on WhatsApp</button></div>' : "") +
          "</div></article>";
      }).join("");
      $all("[data-gift]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var b = boxes[+btn.getAttribute("data-gift")], q = $('[data-qty="' + btn.getAttribute("data-gift") + '"]').value;
          var clean = function (v) { return String(v || "").replace(/[\[\]]/g, ""); };
          var msg = ["Hi " + NAME + "! I'd like to order gift boxes.", "", "Box: " + clean(b.name) + (ok(b.price) ? " (" + clean(price(b.price)) + ")" : ""),
            "Quantity: " + q, "Delivery or pickup date: ", "Area: "].join("\n");
          track("whatsapp_order", { form: "gift_box", box: clean(b.name), quantity: q });
          window.open(waLink(msg), "_blank", "noopener");
        });
      });
    } else hide(giftEl);
    if (ok(G.bulkText)) $("#gift-bulk-text").innerHTML = t(G.bulkText);
    var bulkBtn = $("#gift-bulk-btn");
    if (hasWa()) bulkBtn.href = waLink("Hi " + NAME + "! I'd like to ask about a bulk gift order.\n\nNumber of boxes: \nDate needed: \nBudget per box: ");
    else hide(bulkBtn);
  }

  /* ---------- Flavours (Custom cakes page) ---------- */
  var flEl = $("#flavours");
  if (flEl && FL.length) {
    flEl.innerHTML = FL.map(function (x, i) {
      var tags = (x.tags || []).filter(Boolean).map(function (g) { return '<span class="tag ' + esc(slug(g)) + '">' + esc(g) + "</span>"; }).join("");
      return '<article class="flavour">' +
        (x.image ? '<div class="flavour-img">' + img(x.image, x.name, [320, 640], "(max-width: 640px) 92vw, 320px", ' loading="lazy" decoding="async"') + "</div>" : "") +
        '<div class="flavour-body"><header><h3>' + t(x.name) + "</h3>" + (ok(x.price) ? '<span class="price">' + t(price(x.price)) + "</span>" : "") + "</header>" +
        (ok(x.desc) ? "<p>" + t(x.desc) + "</p>" : "") +
        (ok(x.ingredients) ? '<p class="ingredients"><strong>Made with</strong> ' + t(x.ingredients) + "</p>" : "") +
        (tags ? '<p class="flavour-tags">' + tags + "</p>" : "") +
        '<button class="btn ghost" type="button" data-flavour="' + i + '">Order this flavour</button></div></article>';
    }).join("");
    $("#flavours-section").hidden = false;
    $all("[data-flavour]").forEach(function (b) {
      b.addEventListener("click", function () {
        var name = flavourNames[+b.getAttribute("data-flavour")], sel = $("#flavour");
        if (sel) { sel.value = name; sel.dispatchEvent(new Event("change")); }
        var form = $("#cake-form"); if (form) { form.scrollIntoView({ behavior: "smooth", block: "start" }); }
        track("flavour_click", { flavour: name });
      });
    });
  }

  /* ---------- FAQ (Custom cakes page) ---------- */
  var faqEl = $("#faq");
  if (faqEl) {
    var faq = (D.faq || []).filter(function (x) { return ok(x.q) && ok(x.a); });
    if (!faq.length) hide(faqEl.closest("section"));
    else faqEl.innerHTML = faq.map(function (x) {
      return "<details><summary>" + t(x.q) + "</summary><p>" + t(x.a).replace(/\n/g, "<br>") + "</p></details>";
    }).join("");
  }

  /* ---------- Privacy page ---------- */
  if (typeof window.gtag === "function") $all("[data-analytics-note]").forEach(function (el) { el.hidden = false; });
  var pc = $("[data-privacy-contact]");
  if (pc) {
    if (hasWa()) pc.innerHTML = ' on <a href="' + esc(waLink("Hi " + NAME + "! I have a question about my data.")) + '" target="_blank" rel="noopener">WhatsApp</a>';
    else if (ok(C.email) && !isPh(C.email)) pc.innerHTML = ' at <a href="mailto:' + esc(C.email) + '">' + esc(C.email) + "</a>";
  }

  /* ---------- Reviews (home page) ---------- */
  var R = D.reviews || {};
  var revEl = $("#reviews");
  if (revEl) {
    var revs = (R.items || []).filter(function (r) { return ok(r.quote) && ok(r.name); });
    var gLink = String(R.googleLink || "").trim();
    var hasLink = /^https:\/\//.test(gLink) && !isPh(gLink);
    if (revs.length) {
      revEl.innerHTML = revs.map(function (r) {
        var src = ok(r.source) ? '<span class="src">' + t(r.source) + "</span>" : "";
        return '<figure class="review"><blockquote>' + t(r.quote).replace(/\n/g, "<br>") + "</blockquote>" +
          "<figcaption><strong>" + t(r.name) + "</strong>" + (ok(r.detail) ? " · " + t(r.detail) : "") + src + "</figcaption></figure>";
      }).join("");
    } else {
      hide(revEl);
      $("#reviews-title").textContent = "Ordered from us?";
      $("#reviews-section").classList.add("reviews-empty");
    }
    if (hasLink) { $("#review-btn").href = gLink; $("#review-btn").hidden = false; $("#review-thanks-btn").href = gLink; }
    var rf = $("#review-form"), wr = $("#write-review");
    wr.addEventListener("click", function () {
      rf.hidden = !rf.hidden; wr.setAttribute("aria-expanded", rf.hidden ? "false" : "true");
      if (!rf.hidden) rf.querySelector("input").focus();
    });
    rf.addEventListener("input", function () { rf.querySelector(".form-error").textContent = ""; });
    rf.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(rf), err = rf.querySelector(".form-error"), btn = rf.querySelector('button[type="submit"]');
      if (!String(f.get("name") || "").trim()) { err.textContent = "Add your first name."; return; }
      if (String(f.get("quote") || "").trim().length < 10) { err.textContent = "Write a few words about your order."; return; }
      if (!f.get("consent")) { err.textContent = "Tick the box so we can show your review."; return; }
      err.textContent = ""; btn.disabled = true; btn.textContent = "Sending…";
      fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: f.get("name"), detail: f.get("detail"), quote: f.get("quote"), phone: f.get("phone"), consent: true, website: f.get("website") || "" }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Couldn't send. Try again."); }); })
        .then(function () {
          track("review_submit", {});
          rf.hidden = true; wr.hidden = true; $("#review-thanks").hidden = false;
          if (hasLink) { $("#review-thanks-google").hidden = false; $("#review-thanks-btn").hidden = false; }
        })
        .catch(function (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = "Send review"; });
    });
  }

  /* ---------- Click tracking (only when Google Analytics is switched on) ---------- */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    var where = a.classList.contains("wa-float") ? "floating_button" : (a.closest("header, footer, section, aside") || {}).id || (a.closest("footer") ? "footer" : "page");
    if (/^https:\/\/wa\.me\//.test(href)) track("whatsapp_click", { location: where });
    else if (/^tel:/.test(href)) track("phone_click", { location: where });
    else if (/instagram\.com/.test(href)) track("instagram_click", { location: where });
    else if (a.id === "review-btn" || a.id === "review-thanks-btn") track("review_click", { location: a.id });
  });
})();
