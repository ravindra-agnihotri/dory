/* Dory's Bakehouse: renders content.js into the pages. No edits needed here. */
(function () {
  var D = window.DORYS || {};
  var C = D.contact || {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Escape text, and highlight anything still in [square brackets]
  function t(s) { return esc(s).replace(/\[([^\]]*)\]/g, '<span class="ph">$1</span>'); }
  function isPh(s) { return !s || /\[.*\]/.test(String(s)); }
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function set(sel, html) { $all(sel).forEach(function (el) { el.innerHTML = html; }); }

  function waNumber() { return String(C.whatsapp || "").replace(/\D/g, ""); }
  function waLink(msg) {
    var n = waNumber();
    return "https://wa.me/" + n + (msg ? "?text=" + encodeURIComponent(msg) : "");
  }
  function telLink() { return "tel:" + String(C.phone || "").replace(/[^\d+]/g, ""); }

  /* ---------- Nav ---------- */
  var toggle = $(".menu-toggle"), nav = $(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "Close" : "Menu";
    });
  }

  /* ---------- Shared bits (footer, contact) ---------- */
  set("[data-name]", esc(D.name));
  // Browser-tab title follows the bakery name set in the admin
  if (D.name && D.name !== "Dory's Bakehouse") document.title = document.title.split("Dory's Bakehouse").join(D.name);
  set("[data-tagline]", t(D.tagline));
  set("[data-address]", t(C.address));
  set("[data-phone]", isPh(C.phone) ? t(C.phone) : '<a href="' + telLink() + '">' + esc(C.phone) + "</a>");
  set("[data-email]", isPh(C.email) ? t(C.email) : '<a href="mailto:' + esc(C.email) + '">' + esc(C.email) + "</a>");
  set("[data-instagram]", isPh(C.instagram) ? t(C.instagram) :
    '<a href="https://instagram.com/' + esc(C.instagram) + '" target="_blank" rel="noopener">@' + esc(C.instagram) + "</a>");
  set("[data-hours]", (D.hours || []).map(function (h) {
    return "<li>" + t(h.days) + "<br><strong>" + t(h.time) + "</strong></li>";
  }).join(""));
  set("[data-hours-table]", (D.hours || []).map(function (h) {
    return "<tr><td>" + t(h.days) + "</td><td>" + t(h.time) + "</td></tr>";
  }).join(""));
  $all("[data-maplink]").forEach(function (a) { if (!isPh(C.mapLink)) a.href = C.mapLink; else a.removeAttribute("href"); });
  $all("[data-wa]").forEach(function (a) {
    a.href = waLink("Hi Dory's! ");
    a.target = "_blank"; a.rel = "noopener";
  });
  set("[data-year]", new Date().getFullYear());

  /* ---------- Home: special ---------- */
  var sp = D.special || {}, spEl = $("#special");
  if (spEl) {
    if (!sp.show) { spEl.remove(); }
    else {
      spEl.innerHTML =
        (sp.image ? '<img src="' + esc(sp.image) + '" alt="' + esc(sp.title) + '">' : "") +
        '<div class="kicker">This week\'s special</div>' +
        "<h2>" + t(sp.title) + "</h2>" +
        "<p>" + t(sp.description) + "</p>" +
        '<div class="foot"><span class="price">' + t(sp.price) + "</span>" +
        "<span>Until " + t(sp.validTill) + "</span></div>";
    }
  }

  /* ---------- Home: highlights ---------- */
  set("#highlights", (D.highlights || []).map(function (h) {
    return '<article class="highlight"><div class="img">' +
      (h.image ? '<img src="' + esc(h.image) + '" alt="' + esc(h.title) + '" loading="lazy">' : "Photo") +
      "</div><h3>" + t(h.title) + "</h3><p class=\"muted\">" + t(h.desc) + "</p></article>";
  }).join(""));

  /* ---------- Menu ---------- */
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  var menu = D.menu || [];
  set("#menu-tabs", menu.map(function (s) {
    return '<a href="#' + slug(s.section) + '">' + esc(s.section) + "</a>";
  }).join(""));
  set("#menu", menu.map(function (s) {
    return '<section class="menu-section" id="' + slug(s.section) + '"><header><h2>' + t(s.section) + "</h2>" +
      (s.note ? '<span class="muted">' + t(s.note) + "</span>" : "") + '</header><ul class="menu-list">' +
      (s.items || []).map(function (i) {
        var tags = (i.tags || []).map(function (g) { return '<span class="tag ' + esc(g) + '">' + esc(g) + "</span>"; }).join("");
        return '<li class="menu-item"><span class="name">' + t(i.name) + tags + '</span><span class="price">' + t(i.price) + "</span>" +
          (i.desc ? '<p class="desc">' + t(i.desc) + "</p>" : "") + "</li>";
      }).join("") + "</ul></section>";
  }).join(""));

  /* ---------- About ---------- */
  var A = D.about || {};
  set("#about-heading", t(A.heading));
  set("#about-story", (A.story || []).map(function (p) { return "<p>" + t(p) + "</p>"; }).join(""));
  set("#about-portrait", A.image ? '<img src="' + esc(A.image) + '" alt="Dory at the bakehouse">' : "Photo of Dory");
  set("#values", (A.values || []).map(function (v) {
    return "<div><h3>" + t(v.title) + "</h3><p class=\"muted\">" + t(v.desc) + "</p></div>";
  }).join(""));

  /* ---------- Gallery ---------- */
  var gal = $("#gallery");
  if (gal) {
    var g = D.gallery || [];
    gal.innerHTML = g.length
      ? '<div class="gallery">' + g.map(function (p) {
          return '<figure><img src="' + esc(p.src) + '" alt="' + esc(p.caption || "") + '" loading="lazy">' +
            (p.caption ? "<figcaption>" + esc(p.caption) + "</figcaption>" : "") + "</figure>";
        }).join("") + "</div>"
      : '<div class="empty"><h2>Photos coming soon</h2><p class="muted">Until then, our latest bakes are on Instagram.</p>' +
        '<a class="btn" data-ig href="#">See our Instagram</a></div>';
    var ig = gal.querySelector("[data-ig]");
    if (ig) { if (isPh(C.instagram)) ig.removeAttribute("href"); else { ig.href = "https://instagram.com/" + C.instagram; ig.target = "_blank"; ig.rel = "noopener"; } }
  }

  /* ---------- Contact map ---------- */
  var map = $("#map");
  if (map) {
    map.innerHTML = C.mapEmbed
      ? '<iframe src="' + esc(C.mapEmbed) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map to Dory\'s Bakehouse"></iframe>'
      : '<div><p><strong>Map goes here.</strong></p><p class="muted">Add the Google Maps embed link in content.js (contact → mapEmbed).</p></div>';
  }

  /* ---------- Cake order form → WhatsApp ---------- */
  var K = D.cakes || {};
  set("[data-leadtime]", t(K.leadTime));
  set("[data-startprice]", t(K.startingPrice));
  set("#cake-notes", (K.notes || []).map(function (n) { return "<li>" + t(n) + "</li>"; }).join(""));
  function chips(name, list, type) {
    return list.map(function (v, i) {
      var clean = String(v).replace(/[\[\]]/g, "");
      return '<label><input type="' + type + '" name="' + name + '" value="' + esc(clean) + '"' + (i === 0 && type === "radio" ? "" : "") + "><span>" + esc(clean) + "</span></label>";
    }).join("");
  }
  set("#occasion-chips", chips("occasion", K.occasions || [], "radio"));
  set("#size-chips", chips("size", K.sizes || [], "radio"));
  var fl = $("#flavour");
  if (fl) fl.innerHTML = '<option value="">Choose a flavour</option>' + (K.flavours || []).map(function (f) {
    var c = String(f).replace(/[\[\]]/g, ""); return '<option>' + esc(c) + "</option>";
  }).join("");

  var form = $("#cake-form");
  if (form) {
    var d = form.querySelector("#date");
    if (d) { var min = new Date(); min.setDate(min.getDate() + 2); d.min = min.toISOString().slice(0, 10); }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(form), err = form.querySelector(".form-error");
      var need = [["name", "your name"], ["phone", "your phone number"], ["date", "the date you need it"], ["occasion", "the occasion"], ["size", "a size"], ["flavour", "a flavour"]];
      for (var i = 0; i < need.length; i++) {
        if (!String(f.get(need[i][0]) || "").trim()) { err.textContent = "Add " + need[i][1] + " to send the order."; return; }
      }
      if (!waNumber() || isPh(C.whatsapp)) { err.textContent = "Orders can't be sent yet: the bakery's WhatsApp number isn't set up."; return; }
      err.textContent = "";
      var dt = new Date(f.get("date") + "T00:00");
      var lines = [
        "Hi Dory's! I'd like to order a custom cake.",
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
      window.open(waLink(lines.join("\n")), "_blank", "noopener");
    });
  }
})();
