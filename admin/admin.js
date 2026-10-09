/* Dory's Bakehouse: admin editor */
(function () {
  "use strict";

  /* ------------------------------------------------------------ schema --- */
  var T = function (key, label, help, extra) { return Object.assign({ key: key, label: label, help: help, type: "text" }, extra || {}); };
  var TA = function (key, label, help) { return T(key, label, help, { type: "textarea" }); };
  var IMG = function (key, label, help) { return T(key, label, help, { type: "image" }); };
  var ROW = function () { return { type: "row", fields: [].slice.call(arguments) }; };

  var SECTIONS = [
    { id: "basics", title: "Basics & contact", desc: "Name, contact details and opening hours. These appear on every page. Anything still in [square brackets] is hidden from visitors until you replace it.",
      fields: [
        ROW(T("name", "Bakery name"), T("tagline", "Tagline", "Shown in the footer.")),
        { key: "contact", type: "group", label: "Contact", fields: [
          ROW(T("phone", "Phone", "As customers should see it, e.g. +91 98765 43210"),
              T("whatsapp", "WhatsApp number", "Digits only with country code, e.g. 919876543210. Cake orders are sent here.")),
          ROW(T("email", "Email"), T("instagram", "Instagram handle", "Without the @")),
          TA("address", "Address"),
          T("mapLink", "Google Maps link", "Google Maps → Share → Copy link. Used for “Get directions”."),
          T("mapEmbed", "Google Maps embed link", "Google Maps → Share → Embed a map → copy only the link inside src=\"…\"")
        ]},
        { key: "watermark", type: "group", label: "Gallery watermark", fields: [
          { key: "show", type: "bool", label: "Show a watermark on gallery photos" },
          { key: "style", type: "select", label: "Where", options: [["corner", "Small, bottom-right corner (keeps the cake clear)"], ["diagonal", "Large and faint, diagonally across the middle (harder to crop out)"]] },
          T("text", "Watermark text", "Leave empty to use the bakery name. Your original photos in Cloudinary are never changed.")
        ]},
        { key: "hours", type: "list", label: "Opening hours", itemTitle: "days", addLabel: "Add hours",
          newItem: function () { return { days: "", time: "" }; },
          fields: [ROW(T("days", "Days", "e.g. Monday – Friday"), T("time", "Time", "e.g. 8:00 am – 9:00 pm"))] }
      ] },

    { id: "customers", title: "Reminders", desc: "Customers who agreed to a reminder before a birthday or anniversary. Upcoming dates show here 2 weeks ahead: tap “Send on WhatsApp”, check the message, and press send in WhatsApp. This list is private and never appears on the website.", custom: "customers" },

    { id: "special", title: "This week's special", desc: "The yellow card at the top of the home page. Update it every week.",
      fields: [{ key: "special", type: "group", fields: [
        { key: "show", type: "bool", label: "Show the special on the home page" },
        T("title", "Name of the special"),
        TA("description", "Description", "One or two lines."),
        ROW(T("price", "Price", "Just the number, e.g. 180 (shown as ₹180)"), T("validTill", "Available until", "e.g. Sunday")),
        IMG("image", "Photo", "Optional.")
      ]}] },

    { id: "menu", title: "Menu", desc: "Sections and items on the Menu page. Use the arrows to reorder.",
      fields: [{ key: "menu", type: "list", itemTitle: "section", addLabel: "Add a menu section",
        newItem: function () { return { section: "New section", note: "", items: [] }; },
        fields: [
          ROW(T("section", "Section name"), T("note", "Note", "Optional, e.g. Out of the oven by 9 am")),
          { key: "items", type: "list", label: "Items", itemTitle: "name", addLabel: "Add an item", nested: true,
            newItem: function () { return { name: "", desc: "", price: "", tags: [], image: "" }; },
            fields: [
              ROW(T("name", "Item name"), T("price", "Price", "Just the number, e.g. 120 (shown as ₹120). Or text like “from 450”.")),
              T("desc", "Short description"),
              { key: "tags", type: "tags", label: "Tags", help: "Comma separated. Styled tags: eggless, vegan, bestseller, new" },
              IMG("image", "Photo", "Optional. Shown as a small round photo next to the item.")
            ] }
        ] }] },

    { id: "gifting", title: "Gifting", desc: "Gift boxes on the Gifting page, plus a banner on the home page while it's switched on. Fill in the boxes, check them with Preview site → Gifting, then switch it on. Switch it off after the festival; the page then shows only the bulk-order box.",
      fields: [{ key: "gifting", type: "group", fields: [
        { key: "show", type: "bool", label: "Show gift boxes (and the home page banner)" },
        ROW(T("kicker", "Small label above the title", "e.g. Diwali 2026"), T("title", "Title", "e.g. Diwali gift boxes. Also used in the Google title.")),
        TA("intro", "Intro", "One or two lines: what's in the boxes and who they're for."),
        T("deadline", "Order deadline", "e.g. Order by 3 November · delivery 4–7 November"),
        { key: "boxes", type: "list", label: "Boxes", itemTitle: "name", addLabel: "Add a box",
          newItem: function () { return { name: "", price: "", contents: "", image: "" }; },
          fields: [
            ROW(T("name", "Box name"), T("price", "Price per box", "Just the number, e.g. 650 (shown as ₹650)")),
            TA("contents", "What's inside", "One item per line, e.g. 6 almond nankhatai"),
            IMG("image", "Photo", "A real photo of the box. Landscape works best.")
          ] },
        TA("bulkText", "Bulk / corporate note", "Optional. Replaces the default text in the bulk-order box.")
      ]}] },

    { id: "reviews", title: "Reviews", extra: "reviewQueue", desc: "Reviews shown on the home page. Ones customers send on the website wait under “Waiting for approval” until you approve them. Approve every genuine review, including critical ones; delete only spam, abuse or reviews that aren't about an order. You can also add reviews from Google or WhatsApp yourself (ask before using a WhatsApp message). First names only.",
      fields: [{ key: "reviews", type: "group", fields: [
        T("googleLink", "Google review link", "Google Business Profile → Ask for reviews → copy the link (starts with https://g.page/r/…). Leave empty to hide the button."),
        { key: "items", type: "list", label: "Reviews", itemTitle: "name", addLabel: "Add a review",
          newItem: function () { return { quote: "", name: "", detail: "", source: "Google review" }; },
          fields: [
            TA("quote", "What they wrote", "Copy it word for word. You can shorten it, but don't change the wording."),
            ROW(T("name", "First name", "e.g. Priya"), T("detail", "Order and area", "Optional, e.g. Birthday cake, Baner")),
            T("source", "Where it's from", "e.g. Google review, or WhatsApp (shared with permission)")
          ] }
      ]}] },

    { id: "highlights", title: "Home highlights", desc: "The three signature items under “What people come back for”.",
      fields: [{ key: "highlights", type: "list", itemTitle: "title", addLabel: "Add a highlight",
        newItem: function () { return { title: "", desc: "", image: "" }; },
        fields: [T("title", "Item"), T("desc", "Why people love it"), IMG("image", "Photo", "Square photos look best.")] }] },

    { id: "about", title: "About", desc: "The story on the About page.",
      fields: [{ key: "about", type: "group", fields: [
        T("heading", "Heading"),
        { key: "story", type: "strings", label: "Story", help: "Each box is one paragraph. The first is shown larger.", multiline: true, addLabel: "Add a paragraph" },
        IMG("image", "Photo of Dory or the shop", "Portrait (tall) photos look best."),
        { key: "values", type: "list", label: "What you won't compromise on", itemTitle: "title", addLabel: "Add a value",
          newItem: function () { return { title: "", desc: "" }; },
          fields: [ROW(T("title", "Title"), T("desc", "One line"))] }
      ]}] },

    { id: "cakes", title: "Custom cakes", desc: "Options in the cake order form and the notes beside it.",
      fields: [{ key: "cakes", type: "group", fields: [
        ROW(T("leadTime", "Minimum notice", "e.g. 48 hours"), T("startingPrice", "Starting price", "e.g. ₹900 per kg")),
        { key: "sizes", type: "strings", label: "Sizes", addLabel: "Add a size" },
        { key: "occasions", type: "strings", label: "Occasions", addLabel: "Add an occasion" },
        { key: "notes", type: "strings", label: "Good to know", help: "Short policy notes shown beside the form.", addLabel: "Add a note" }
      ]}] },

    { id: "flavours", title: "Flavours", desc: "Flavours shown on the Custom cakes page, also used as the choices in the order form. Only list allergens a flavour actually contains, and keep it accurate: customers with allergies rely on it.",
      fields: [{ key: "flavours", type: "list", itemTitle: "name", addLabel: "Add a flavour",
        newItem: function () { return { name: "", desc: "", ingredients: "", tags: [], price: "", image: "" }; },
        fields: [
          ROW(T("name", "Flavour name"), T("price", "Price", "Optional. e.g. from 900 per kg")),
          TA("desc", "Description", "One or two lines: what it tastes like."),
          TA("ingredients", "Main ingredients", "e.g. Belgian dark chocolate, cream, cocoa sponge"),
          { key: "tags", type: "tags", label: "Tags", help: "Comma separated. Use: eggless available, contains nuts, contains gluten, contains dairy, contains egg, bestseller. “contains …” tags show in a warning colour." },
          IMG("image", "Photo", "Optional. A slice or close-up works best.")
        ] }] },

    { id: "faq", title: "FAQ", desc: "Questions and answers at the bottom of the Custom cakes page. A question shows only once its answer has no [brackets] left.",
      fields: [{ key: "faq", type: "list", itemTitle: "q", addLabel: "Add a question",
        newItem: function () { return { q: "", a: "" }; },
        fields: [T("q", "Question"), TA("a", "Answer")] }] },

    { id: "gallery", title: "Gallery", desc: "Photos on the Gallery page. Drag photos in or choose them from your phone.", custom: "gallery" },
    { id: "history", title: "Previous versions", desc: "Every save keeps a copy. Restore one if something went wrong.", custom: "history" }
  ];

  /* ------------------------------------------------------------ state ---- */
  var data = null, dirty = false, current = "basics";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") el.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  var uid = 0; function nid() { return "f" + (++uid); }
  // Cloudinary photos are full https URLs; local ones are paths like uploads/abc.jpg
  function imgUrl(src) { src = String(src || "").replace(/'/g, "%27"); return /^https?:\/\//.test(src) ? src : "/" + src; }
  var isPh = function (s) { return /\[.*\]/.test(String(s || "")); };

  /* ------------------------------------------------------------ api ------ */
  function api(method, url, body, isForm) {
    var opts = { method: method, credentials: "same-origin", headers: { "X-Admin": "1" } };
    if (body !== undefined) {
      if (isForm) opts.body = body;
      else { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && url !== "/api/login") { showLogin(); }
        if (!r.ok) throw new Error(j.error || "Something went wrong (" + r.status + ").");
        return j;
      });
    });
  }

  function toast(msg, err) {
    var t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, err ? 6000 : 2600);
  }

  function setDirty(v) {
    dirty = v;
    $("#save").disabled = !v;
    var s = $("#status");
    s.textContent = v ? "Unsaved changes" : (s.dataset.saved || "");
    s.className = "status" + (v ? " dirty" : "");
  }
  function changed() { if (!dirty) setDirty(true); }

  /* ------------------------------------------------------------ fields --- */
  function help(f) { return f.help ? h("span", { class: "help", text: f.help }) : null; }

  function textInput(f, obj) {
    var id = nid(), multi = f.type === "textarea";
    var input = h(multi ? "textarea" : "input", multi ? { id: id } : { id: id, type: "text" });
    input.value = obj[f.key] == null ? "" : obj[f.key];
    var mark = function () { input.classList.toggle("ph-warn", isPh(input.value)); };
    mark();
    input.addEventListener("input", function () { obj[f.key] = input.value; mark(); changed(); });
    return h("div", { class: "field" }, [h("label", { for: id }, [f.label, help(f)]), input]);
  }

  function boolInput(f, obj) {
    var cb = h("input", { type: "checkbox" }); cb.checked = !!obj[f.key];
    cb.addEventListener("change", function () { obj[f.key] = cb.checked; changed(); });
    return h("div", { class: "field" }, [h("label", { class: "toggle" }, [cb, f.label])]);
  }

  function selectInput(f, obj) {
    var id = nid(), sel = h("select", { id: id });
    f.options.forEach(function (o) { var op = h("option", { value: o[0], text: o[1] }); if ((obj[f.key] || f.options[0][0]) === o[0]) op.selected = true; sel.appendChild(op); });
    sel.addEventListener("change", function () { obj[f.key] = sel.value; changed(); });
    return h("div", { class: "field" }, [h("label", { for: id }, [f.label, help(f)]), sel]);
  }

  function tagsInput(f, obj) {
    var id = nid(), input = h("input", { id: id, type: "text", placeholder: "eggless, bestseller" });
    input.value = (obj[f.key] || []).join(", ");
    input.addEventListener("input", function () {
      obj[f.key] = input.value.split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean); changed();
    });
    return h("div", { class: "field" }, [h("label", { for: id }, [f.label, help(f)]), input]);
  }

  var directUpload = false;  // true when the server uses Cloudinary

  // With Cloudinary: each photo goes straight from the browser to Cloudinary (the server only signs
  // the request), so big phone photos never hit the server's upload size limit.
  function uploadOneDirect(file, target) {
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error(file.name + " is over 10 MB. Choose a smaller photo."));
    return api("POST", "/api/upload-signature", { target: target || "" }).then(function (sig) {
      var fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", sig.apiKey);
      Object.keys(sig.params).forEach(function (k) { fd.append(k, sig.params[k]); });
      return fetch(sig.url, { method: "POST", body: fd }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error("Cloudinary: " + ((j.error && j.error.message) || "upload failed"));
          return api("POST", "/api/uploaded", { secureUrl: j.secure_url });
        });
      }).then(function (j) { return j.src; });
    });
  }

  function upload(files, target) {
    if (directUpload) {
      var list = [].slice.call(files), out = [];
      return list.reduce(function (p, f) {  // one at a time: gentler on slow phone connections
        return p.then(function () { return uploadOneDirect(f, target).then(function (src) { out.push(src); }); });
      }, Promise.resolve()).then(function () { return out; });
    }
    var fd = new FormData();
    [].forEach.call(files, function (f) { fd.append("photo", f); });
    return api("POST", "/api/upload", fd, true).then(function (j) { return j.files; });
  }

  function imageInput(f, obj) {
    var wrap = h("div", { class: "field" });
    function draw() {
      wrap.innerHTML = "";
      var src = obj[f.key];
      var thumb = h("div", { class: "thumb", text: src ? "" : "No photo" });
      if (src) thumb.style.backgroundImage = "url('" + imgUrl(src) + "')";
      var file = h("input", { type: "file", accept: "image/*", "aria-label": "Upload " + f.label });
      file.addEventListener("change", function () {
        if (!file.files.length) return;
        wrap.classList.add("uploading"); toast("Uploading…");
        upload(file.files).then(function (paths) { obj[f.key] = paths[0]; changed(); draw(); toast("Photo uploaded. Save to publish it."); })
          .catch(function (e) { toast(e.message, true); })
          .then(function () { wrap.classList.remove("uploading"); });
      });
      var btns = h("div", { class: "btns" }, [
        h("span", { class: "btn soft file-btn" }, [src ? "Replace photo" : "Upload photo", file]),
        src ? h("button", { class: "link danger", type: "button", onclick: function () { obj[f.key] = ""; changed(); draw(); } }, ["Remove"]) : null
      ]);
      wrap.appendChild(h("span", { class: "label" }, [f.label, help(f)]));
      wrap.appendChild(h("div", { class: "image-field" }, [thumb, btns]));
    }
    draw();
    return wrap;
  }

  function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return false; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true; }
  function tools(arr, i, redraw, what) {
    return h("div", { class: "item-tools" }, [
      h("button", { class: "link", type: "button", "aria-label": "Move up", title: "Move up", disabled: i === 0,
        onclick: function () { if (move(arr, i, -1)) { changed(); redraw(); } } }, ["↑"]),
      h("button", { class: "link", type: "button", "aria-label": "Move down", title: "Move down", disabled: i === arr.length - 1,
        onclick: function () { if (move(arr, i, 1)) { changed(); redraw(); } } }, ["↓"]),
      h("button", { class: "link danger", type: "button",
        onclick: function () { if (confirm("Remove this " + what + "?")) { arr.splice(i, 1); changed(); redraw(); } } }, ["Remove"])
    ]);
  }

  function listInput(f, obj) {
    if (!Array.isArray(obj[f.key])) obj[f.key] = [];
    var arr = obj[f.key], wrap = h("div", { class: "field" });
    var what = (f.addLabel || "Add item").replace(/^Add (a |an )?/, "");
    function draw() {
      wrap.innerHTML = "";
      if (f.label) wrap.appendChild(h("span", { class: "label" }, [f.label, help(f)]));
      if (!arr.length) wrap.appendChild(h("p", { class: "list-empty", text: "Nothing here yet." }));
      arr.forEach(function (item, i) {
        var title = (item[f.itemTitle] || "").replace(/[\[\]]/g, "") || "Untitled";
        var box = h("div", { class: "list-item" + (f.nested ? " nested" : "") }, [
          h("div", { class: "item-head" }, [h("strong", { text: title }), tools(arr, i, draw, what)])
        ]);
        renderFields(f.fields, item, box);
        wrap.appendChild(box);
      });
      wrap.appendChild(h("button", { class: "btn soft", type: "button",
        onclick: function () { arr.push(f.newItem()); changed(); draw();
          var boxes = wrap.querySelectorAll(":scope > .list-item"); var last = boxes[boxes.length - 1];
          if (last) { var inp = last.querySelector("input, textarea"); if (inp) inp.focus(); } } }, ["+ " + (f.addLabel || "Add")]));
    }
    draw();
    return wrap;
  }

  function stringsInput(f, obj) {
    if (!Array.isArray(obj[f.key])) obj[f.key] = [];
    var arr = obj[f.key], wrap = h("div", { class: "field" });
    function draw() {
      wrap.innerHTML = "";
      wrap.appendChild(h("span", { class: "label" }, [f.label, help(f)]));
      arr.forEach(function (val, i) {
        var input = h(f.multiline ? "textarea" : "input", f.multiline ? { "aria-label": f.label + " " + (i + 1) } : { type: "text", "aria-label": f.label + " " + (i + 1) });
        input.value = val;
        input.classList.toggle("ph-warn", isPh(val));
        input.addEventListener("input", function () { arr[i] = input.value; input.classList.toggle("ph-warn", isPh(input.value)); changed(); });
        wrap.appendChild(h("div", { class: "string-row" }, [input, tools(arr, i, draw, "line")]));
      });
      wrap.appendChild(h("button", { class: "btn soft", type: "button",
        onclick: function () { arr.push(""); changed(); draw(); var all = wrap.querySelectorAll("input, textarea"); all[all.length - 1].focus(); } },
        ["+ " + (f.addLabel || "Add")]));
    }
    draw();
    return wrap;
  }

  function renderFields(fields, obj, parent) {
    fields.forEach(function (f) {
      var el;
      if (f.type === "row") { el = h("div", { class: "grid2" }); renderFields(f.fields, obj, el); }
      else if (f.type === "group") {
        if (!obj[f.key] || typeof obj[f.key] !== "object") obj[f.key] = {};
        el = h("div", { class: "group" });
        if (f.label) el.appendChild(h("h3", { text: f.label, style: "margin-top:8px" }));
        renderFields(f.fields, obj[f.key], el);
      }
      else if (f.type === "list") el = listInput(f, obj);
      else if (f.type === "strings") el = stringsInput(f, obj);
      else if (f.type === "image") el = imageInput(f, obj);
      else if (f.type === "bool") el = boolInput(f, obj);
      else if (f.type === "select") el = selectInput(f, obj);
      else if (f.type === "tags") el = tagsInput(f, obj);
      else el = textInput(f, obj);
      parent.appendChild(el);
    });
  }

  /* ------------------------------------------------------------ gallery -- */
  function galleryEditor(root) {
    var holder = h("div", {}, [h("div", { class: "card" }, [h("p", { class: "muted", text: "Loading gallery…" })])]);
    root.appendChild(holder);
    api("GET", "/api/gallery").then(function (j) {
      holder.innerHTML = "";
      if (j.source === "cloudinary") cloudGalleryEditor(holder, j);
      else localGalleryEditor(holder);
    }).catch(function (e) { holder.innerHTML = ""; holder.appendChild(h("p", { class: "error", text: e.message })); });
  }

  function dropzone(onFiles, note) {
    var file = h("input", { type: "file", accept: "image/*", multiple: true, "aria-label": "Add photos" });
    file.addEventListener("change", function () { onFiles(file.files, zone); file.value = ""; });
    var zone = h("div", { class: "dropzone" }, [
      h("p", { style: "margin:0 0 12px", text: "Drop photos here, or" }),
      h("span", { class: "btn file-btn" }, ["Choose photos", file]),
      h("p", { class: "help", style: "margin-top:12px", text: note })
    ]);
    ["dragenter", "dragover"].forEach(function (e) { zone.addEventListener(e, function (ev) { ev.preventDefault(); zone.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (e) { zone.addEventListener(e, function (ev) { ev.preventDefault(); zone.classList.remove("over"); }); });
    zone.addEventListener("drop", function (ev) { onFiles(ev.dataTransfer.files, zone); });
    return zone;
  }

  /* Gallery = the Cloudinary folder. Changes here apply immediately (no Save needed). */
  function cloudGalleryEditor(root, j) {
    var grid = h("div", { class: "gallery-grid" });
    var count = h("p", { class: "muted", style: "margin:0 0 14px" });
    function draw(items) {
      grid.innerHTML = "";
      count.textContent = items.length + " photo" + (items.length === 1 ? "" : "s") + ", newest first. Changes here go live immediately.";
      items.forEach(function (p) {
        var thumb = h("div", { class: "thumb" }); thumb.style.backgroundImage = "url('" + imgUrl(p.src) + "')";
        var cap = h("input", { type: "text", placeholder: "Caption (optional)", "aria-label": "Caption" });
        cap.value = p.caption || "";
        var last = cap.value;
        cap.addEventListener("change", function () {
          if (cap.value === last) return;
          api("PUT", "/api/gallery/caption", { id: p.id, caption: cap.value })
            .then(function () { last = cap.value; toast("Caption saved."); })
            .catch(function (e) { toast(e.message, true); });
        });
        var del = h("button", { class: "link danger", type: "button", onclick: function () {
          if (!confirm("Delete this photo from Cloudinary? This can't be undone.")) return;
          card.classList.add("uploading");
          api("POST", "/api/gallery/delete", { id: p.id }).then(function () { toast("Photo deleted."); return refresh(); })
            .catch(function (e) { card.classList.remove("uploading"); toast(e.message, true); });
        } }, ["Delete"]);
        var card = h("div", { class: "g-item" }, [thumb, h("div", { class: "body" }, [cap, h("div", { class: "item-tools" }, [del])])]);
        grid.appendChild(card);
      });
    }
    function refresh() { return api("GET", "/api/gallery").then(function (r) { draw(r.items); }); }
    var zone = dropzone(function (files, z) {
      if (!files.length) return;
      z.classList.add("uploading"); toast("Uploading " + files.length + " photo" + (files.length > 1 ? "s" : "") + "…");
      upload(files, "gallery").then(function () { toast("Added to the gallery."); return refresh(); })
        .catch(function (e) { toast(e.message, true); })
        .then(function () { z.classList.remove("uploading"); });
    }, "Photos go to the Cloudinary folder " + j.folder + ". You can also add photos straight to that folder in Cloudinary; they appear on the site within 5 minutes.");
    draw(j.items);
    root.appendChild(h("div", { class: "card" }, [count, grid, zone,
      h("p", { style: "margin:14px 0 0" }, [h("button", { class: "btn soft", type: "button", onclick: function () { refresh().then(function () { toast("Gallery refreshed."); }); } }, ["Refresh from Cloudinary"])])]));
  }

  function localGalleryEditor(root) {
    if (!Array.isArray(data.gallery)) data.gallery = [];
    var arr = data.gallery;
    var grid = h("div", { class: "gallery-grid" });
    function draw() {
      grid.innerHTML = "";
      arr.forEach(function (p, i) {
        var thumb = h("div", { class: "thumb" }); thumb.style.backgroundImage = "url('" + imgUrl(p.src) + "')";
        var cap = h("input", { type: "text", placeholder: "Caption (optional)", "aria-label": "Caption for photo " + (i + 1) });
        cap.value = p.caption || "";
        cap.addEventListener("input", function () { p.caption = cap.value; changed(); });
        var t = h("div", { class: "item-tools" }, [
          h("button", { class: "link", type: "button", disabled: i === 0, "aria-label": "Move earlier", onclick: function () { if (move(arr, i, -1)) { changed(); draw(); } } }, ["←"]),
          h("button", { class: "link danger", type: "button", onclick: function () { if (confirm("Remove this photo from the gallery?")) { arr.splice(i, 1); changed(); draw(); } } }, ["Remove"]),
          h("button", { class: "link", type: "button", disabled: i === arr.length - 1, "aria-label": "Move later", onclick: function () { if (move(arr, i, 1)) { changed(); draw(); } } }, ["→"])
        ]);
        grid.appendChild(h("div", { class: "g-item" }, [thumb, h("div", { class: "body" }, [cap, t])]));
      });
    }
    function add(files) {
      if (!files.length) return;
      zone.classList.add("uploading"); toast("Uploading " + files.length + " photo" + (files.length > 1 ? "s" : "") + "…");
      upload(files).then(function (paths) {
        paths.forEach(function (s) { arr.push({ src: s, caption: "" }); });
        changed(); draw(); toast("Added. Save to publish them.");
      }).catch(function (e) { toast(e.message, true); }).then(function () { zone.classList.remove("uploading"); });
    }
    var file = h("input", { type: "file", accept: "image/*", multiple: true, "aria-label": "Add photos" });
    file.addEventListener("change", function () { add(file.files); file.value = ""; });
    var zone = h("div", { class: "dropzone" }, [
      h("p", { style: "margin:0 0 12px", text: "Drop photos here, or" }),
      h("span", { class: "btn file-btn" }, ["Choose photos", file]),
      h("p", { class: "help", style: "margin-top:12px", text: "Photos are resized and compressed automatically." })
    ]);
    ["dragenter", "dragover"].forEach(function (e) { zone.addEventListener(e, function (ev) { ev.preventDefault(); zone.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (e) { zone.addEventListener(e, function (ev) { ev.preventDefault(); zone.classList.remove("over"); }); });
    zone.addEventListener("drop", function (ev) { add(ev.dataTransfer.files); });
    draw();
    root.appendChild(h("div", { class: "card" }, [grid, zone]));
  }

  /* ------------------------------------------------------------ customers */
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var crm = { upcomingCount: 0 };

  function fmtDate(iso) {
    var d = new Date(iso + "T00:00");
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  }
  function fillTemplate(tpl, u) {
    var d = new Date(u.date + "T00:00"), by = new Date(d); by.setDate(by.getDate() - 3);
    var dm = function (x) { return x.toLocaleDateString("en-IN", { day: "numeric", month: "long" }); };
    var first = String(u.name || "").split(" ")[0] || "there";
    var out = String(tpl);
    if (!u.person) out = out.replace(/\{person\}'s/g, "Your").replace(/\{person\}/g, "you");
    return out.replace(/\{name\}/g, first).replace(/\{person\}/g, u.person).replace(/\{occasion\}/g, String(u.label).toLowerCase())
      .replace(/\{date\}/g, dm(d)).replace(/\{orderBy\}/g, dm(by));
  }
  function refreshBadge() {
    api("GET", "/api/customers?days=10").then(function (j) {
      crm.upcomingCount = j.upcoming.filter(function (u) { return !u.sent; }).length; renderNav();
    }).catch(function () {});
  }

  function customersEditor(root) {
    var holder = h("div", {}, [h("div", { class: "card" }, [h("p", { class: "muted", text: "Loading…" })])]);
    root.appendChild(holder);
    var state = null, query = "";
    function load() {
      return api("GET", "/api/customers?days=14").then(function (j) {
        state = j; crm.upcomingCount = j.upcoming.filter(function (u) { return u.daysAway <= 10 && !u.sent; }).length;
        renderNav(); draw();
      }).catch(function (e) { holder.innerHTML = ""; holder.appendChild(h("p", { class: "error", text: e.message })); });
    }

    function upcomingCard() {
      var card = h("div", { class: "card" }, [h("h3", { text: "Coming up in the next 2 weeks", style: "margin-top:0" })]);
      if (!state.upcoming.length) { card.appendChild(h("p", { class: "muted", text: "Nothing in the next 2 weeks." })); return card; }
      state.upcoming.forEach(function (u) {
        var who = (u.person ? u.person + "'s " : "") + u.label.toLowerCase();
        var when = fmtDate(u.date) + " · " + (u.daysAway === 0 ? "today" : u.daysAway === 1 ? "tomorrow" : "in " + u.daysAway + " days");
        var sendBtn = h("button", { class: "btn", type: "button", onclick: function () {
          var msg = fillTemplate(state.template, u);
          if (/\[.*\]/.test(msg) && !confirm("The message still has [bracketed] text, such as the offer. Send anyway?")) return;
          window.open("https://wa.me/" + u.phone + "?text=" + encodeURIComponent(msg), "_blank", "noopener");
          api("POST", "/api/customers/" + u.customerId + "/occasions/" + u.occasionId + "/sent", { date: u.date })
            .then(function () { toast("Marked as sent. Use Undo if you didn't send it."); return load(); });
        } }, ["Send on WhatsApp"]);
        var undo = h("button", { class: "link", type: "button", onclick: function () {
          api("POST", "/api/customers/" + u.customerId + "/occasions/" + u.occasionId + "/sent", { date: "" }).then(load);
        } }, ["Undo"]);
        card.appendChild(h("div", { class: "crm-row" + (u.sent ? " done" : "") + (u.daysAway <= 10 && !u.sent ? " due" : "") }, [
          h("div", {}, [h("strong", { text: (u.name || "No name") + " — " + who }), h("div", { class: "help", text: when + " · +" + u.phone })]),
          u.sent ? h("div", { class: "btns" }, [h("span", { class: "sent-tag", text: "Sent ✓" }), undo]) : sendBtn
        ]));
      });
      return card;
    }

    function templateCard() {
      var ta = h("textarea", { "aria-label": "Message", rows: "5" }); ta.value = state.template;
      ta.classList.toggle("ph-warn", isPh(ta.value));
      ta.addEventListener("input", function () { ta.classList.toggle("ph-warn", isPh(ta.value)); });
      return h("div", { class: "card" }, [
        h("h3", { text: "Message", style: "margin-top:0" }),
        h("p", { class: "help", text: "Filled in automatically: {name} customer's first name · {person} whose occasion · {occasion} birthday / anniversary · {date} the day · {orderBy} 3 days before. Replace the [bracketed] offer with yours. You can still edit each message in WhatsApp before sending." }),
        ta,
        h("p", { style: "margin:12px 0 0" }, [h("button", { class: "btn soft", type: "button", onclick: function () {
          api("PUT", "/api/customers/template", { template: ta.value }).then(function () { state.template = ta.value; toast("Message saved."); })
            .catch(function (e) { toast(e.message, true); });
        } }, ["Save message"])])
      ]);
    }

    function occasionRow(o, list, redraw) {
      var label = h("select", { "aria-label": "Occasion" });
      ["Birthday", "Anniversary", "Other"].forEach(function (v) { var op = h("option", { text: v }); if (o.label === v) op.selected = true; label.appendChild(op); });
      if (["Birthday", "Anniversary"].indexOf(o.label) < 0 && o.label) { var op2 = h("option", { text: o.label }); op2.selected = true; label.appendChild(op2); }
      label.addEventListener("change", function () { o.label = label.value; });
      var person = h("input", { type: "text", placeholder: "Whose? e.g. Aarav (optional)", "aria-label": "Whose occasion" }); person.value = o.person || "";
      person.addEventListener("input", function () { o.person = person.value; });
      var day = h("select", { "aria-label": "Day" }), month = h("select", { "aria-label": "Month" });
      for (var d = 1; d <= 31; d++) { var od = h("option", { value: d, text: d }); if (+o.day === d) od.selected = true; day.appendChild(od); }
      MONTHS.forEach(function (m, i) { var om = h("option", { value: i + 1, text: m }); if (+o.month === i + 1) om.selected = true; month.appendChild(om); });
      day.addEventListener("change", function () { o.day = +day.value; }); month.addEventListener("change", function () { o.month = +month.value; });
      if (!o.day) o.day = 1; if (!o.month) o.month = 1;
      return h("div", { class: "occ-row" }, [label, person, day, month,
        h("button", { class: "link danger", type: "button", onclick: function () { list.splice(list.indexOf(o), 1); redraw(); } }, ["Remove"])]);
    }

    function customerForm(c, onDone) {
      var draft = JSON.parse(JSON.stringify(c || { name: "", phone: "", notes: "", occasions: [{ label: "Birthday", person: "", day: 1, month: 1 }] }));
      var box = h("div", { class: "list-item" });
      function draw() {
        box.innerHTML = "";
        var name = h("input", { type: "text", "aria-label": "Name" }); name.value = draft.name || "";
        name.addEventListener("input", function () { draft.name = name.value; });
        var phone = h("input", { type: "tel", "aria-label": "Phone" }); phone.value = draft.phone || "";
        phone.addEventListener("input", function () { draft.phone = phone.value; });
        var notes = h("input", { type: "text", "aria-label": "Notes", placeholder: "e.g. likes chocolate truffle, eggless" }); notes.value = draft.notes || "";
        notes.addEventListener("input", function () { draft.notes = notes.value; });
        var consent = h("input", { type: "checkbox" }); consent.checked = !!draft.consentAt;
        consent.disabled = !!draft.consentAt;
        consent.addEventListener("change", function () { draft.consent = consent.checked; });
        var occWrap = h("div", {});
        draft.occasions.forEach(function (o) { occWrap.appendChild(occasionRow(o, draft.occasions, draw)); });
        box.appendChild(h("div", { class: "grid2" }, [
          h("div", { class: "field" }, [h("label", {}, ["Name"]), name]),
          h("div", { class: "field" }, [h("label", {}, ["WhatsApp number", h("span", { class: "help", text: "10 digits, or with country code" })]), phone])]));
        box.appendChild(h("div", { class: "field" }, [h("span", { class: "label" }, ["Dates", h("span", { class: "help", text: "Day and month only. The year isn't needed or kept." })]), occWrap,
          h("button", { class: "btn soft", type: "button", onclick: function () { draft.occasions.push({ label: "Birthday", person: "", day: 1, month: 1 }); draw(); } }, ["+ Add a date"])]));
        box.appendChild(h("div", { class: "field" }, [h("label", {}, ["Notes"]), notes]));
        box.appendChild(h("div", { class: "field" }, [h("label", { class: "toggle" }, [consent,
          draft.consentAt ? "Agreed to reminders on " + String(draft.consentAt).slice(0, 10) + (draft.source === "website" ? " (on the website)" : "") : "They agreed to get a reminder on WhatsApp"])]));
        box.appendChild(h("div", { class: "btns" }, [
          h("button", { class: "btn", type: "button", onclick: function () {
            var req = c ? api("PUT", "/api/customers/" + c.id, draft) : api("POST", "/api/customers", draft);
            req.then(function () { toast(c ? "Saved." : "Customer added."); onDone(true); }).catch(function (e) { toast(e.message, true); });
          } }, [c ? "Save" : "Add customer"]),
          h("button", { class: "link", type: "button", onclick: function () { onDone(false); } }, ["Cancel"])
        ]));
      }
      draw();
      return box;
    }

    function listCard() {
      var card = h("div", { class: "card" });
      var search = h("input", { type: "search", placeholder: "Search name or number", "aria-label": "Search customers" }); search.value = query;
      var listEl = h("div", {});
      var addSlot = h("div", {});
      function drawList() {
        listEl.innerHTML = "";
        var q = query.toLowerCase().replace(/\s/g, "");
        var rows = state.customers.filter(function (c) { return !q || (c.name || "").toLowerCase().replace(/\s/g, "").indexOf(q) >= 0 || c.phone.indexOf(q.replace(/\D/g, "") || "~") >= 0; })
          .sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
        if (!rows.length) listEl.appendChild(h("p", { class: "list-empty", text: state.customers.length ? "No match." : "No customers yet. Add one, or they'll appear here when someone ticks “Remind me next year” on the cake form." }));
        rows.forEach(function (c) {
          var dates = (c.occasions || []).map(function (o) { return (o.person ? o.person + "'s " : "") + o.label.toLowerCase() + " " + o.day + " " + MONTHS[o.month - 1].slice(0, 3); }).join(" · ") || "No dates";
          var row = h("div", { class: "crm-row" }, [
            h("div", {}, [h("strong", { text: c.name || "No name" }), c.source === "website" ? h("span", { class: "src-tag", text: "website" }) : null,
              h("div", { class: "help", text: "+" + c.phone + " · " + dates + (c.notes ? " · " + c.notes : "") })]),
            h("div", { class: "btns" }, [
              h("button", { class: "link", type: "button", onclick: function () { row.replaceWith(customerForm(c, function (saved) { if (saved) load(); else drawList(); })); } }, ["Edit"]),
              h("button", { class: "link danger", type: "button", onclick: function () {
                if (!confirm("Delete " + (c.name || "this customer") + " and their dates? This can't be undone.")) return;
                api("DELETE", "/api/customers/" + c.id).then(function () { toast("Deleted."); load(); }).catch(function (e) { toast(e.message, true); });
              } }, ["Delete"])])
          ]);
          listEl.appendChild(row);
        });
      }
      search.addEventListener("input", function () { query = search.value; drawList(); });
      card.appendChild(h("div", { class: "crm-head" }, [h("h3", { text: "Customers (" + state.customers.length + ")", style: "margin:0" }),
        h("div", { class: "btns" }, [
          h("button", { class: "btn soft", type: "button", onclick: function () {
            addSlot.innerHTML = ""; addSlot.appendChild(customerForm(null, function (saved) { addSlot.innerHTML = ""; if (saved) load(); }));
          } }, ["+ Add customer"]),
          h("a", { class: "link", href: "/api/customers/export.csv", text: "Download as spreadsheet (CSV)" })])]));
      card.appendChild(addSlot);
      card.appendChild(search);
      card.appendChild(listEl);
      drawList();
      return card;
    }

    function draw() { holder.innerHTML = ""; holder.appendChild(upcomingCard()); holder.appendChild(templateCard()); holder.appendChild(listCard()); }
    load();
  }

  /* ------------------------------------------------------------ review queue */
  var pendingReviews = 0;
  function refreshReviewBadge() {
    api("GET", "/api/reviews/pending").then(function (j) { pendingReviews = j.items.length; renderNav(); }).catch(function () {});
  }
  function reviewQueue(root) {
    var card = h("div", { class: "card" }, [h("h3", { text: "Waiting for approval", style: "margin-top:0" }), h("p", { class: "muted", text: "Loading…" })]);
    root.insertBefore(card, root.children[1] || null);
    function load() {
      api("GET", "/api/reviews/pending").then(function (j) {
        pendingReviews = j.items.length; renderNav();
        card.innerHTML = ""; card.appendChild(h("h3", { text: "Waiting for approval (" + j.items.length + ")", style: "margin-top:0" }));
        if (!j.items.length) { card.appendChild(h("p", { class: "muted", text: "No new reviews. Reviews customers send from the home page appear here." })); return; }
        j.items.forEach(function (r) {
          var when = new Date(r.submitted).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
          card.appendChild(h("div", { class: "crm-row review-pending" }, [
            h("div", {}, [h("p", { class: "quote", text: "“" + r.quote + "”" }),
              h("div", { class: "help", text: r.name + (r.detail ? " · " + r.detail : "") + " · sent " + when + (r.phone ? " · +" + r.phone + " (private)" : "") })]),
            h("div", { class: "btns" }, [
              h("button", { class: "btn", type: "button", onclick: function () {
                if (dirty) { toast("Save your other changes first, then approve.", true); return; }
                api("POST", "/api/reviews/" + r.id + "/approve", {}).then(function () { toast("Approved. It's on the home page now."); return loadData(); })
                  .catch(function (e) { toast(e.message, true); });
              } }, ["Approve"]),
              h("button", { class: "link danger", type: "button", onclick: function () {
                if (!confirm("Delete this review? Only delete spam, abuse or reviews that aren't about an order.")) return;
                api("DELETE", "/api/reviews/" + r.id).then(function () { toast("Deleted."); load(); }).catch(function (e) { toast(e.message, true); });
              } }, ["Delete"])])
          ]));
        });
      }).catch(function (e) { card.innerHTML = ""; card.appendChild(h("p", { class: "error", text: e.message })); });
    }
    load();
  }

  function historyEditor(root) {
    var card = h("div", { class: "card history" }, [h("p", { class: "muted", text: "Loading…" })]);
    root.appendChild(card);
    api("GET", "/api/history").then(function (list) {
      card.innerHTML = "";
      if (!list.length) { card.appendChild(h("p", { class: "muted", text: "No earlier versions yet. One is kept each time you save." })); return; }
      var ul = h("ul");
      list.forEach(function (v) {
        var d = new Date(v.saved), stamp = v.id;
        var label = isNaN(d) ? v.saved : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
        ul.appendChild(h("li", {}, [h("span", { text: "Before save on " + label }),
          h("button", { class: "btn soft", type: "button", onclick: function () {
            if (dirty && !confirm("You have unsaved changes. Restoring will discard them. Continue?")) return;
            if (!confirm("Restore the website to this version?")) return;
            api("POST", "/api/history/" + stamp + "/restore", {}).then(function () { toast("Restored."); return loadData(); })
              .catch(function (e) { toast(e.message, true); });
          } }, ["Restore"])]));
      });
      card.appendChild(ul);
    }).catch(function (e) { card.innerHTML = ""; card.appendChild(h("p", { class: "error", text: e.message })); });
  }

  /* ------------------------------------------------------------ views ---- */
  function renderNav() {
    var nav = $("#sidebar"); nav.innerHTML = "";
    SECTIONS.forEach(function (s) {
      var a = h("a", { href: "#" + s.id, "aria-current": s.id === current ? "true" : false, text: s.title });
      if (s.id === "customers" && crm.upcomingCount) a.appendChild(h("span", { class: "badge", text: String(crm.upcomingCount), title: "Reminders to send in the next 10 days" }));
      if (s.id === "reviews" && pendingReviews) a.appendChild(h("span", { class: "badge", text: String(pendingReviews), title: "New reviews waiting for approval" }));
      nav.appendChild(a);
    });
    nav.appendChild(h("div", { class: "foot" }, [h("button", { class: "link", type: "button", onclick: logout }, ["Sign out"])]));
  }

  function render() {
    var sec = SECTIONS.filter(function (s) { return s.id === current; })[0] || SECTIONS[0];
    current = sec.id; renderNav();
    var ed = $("#editor"); ed.innerHTML = "";
    ed.appendChild(h("header", {}, [h("h1", { text: sec.title }), h("p", { text: sec.desc })]));
    if (sec.custom === "gallery") galleryEditor(ed);
    else if (sec.custom === "history") historyEditor(ed);
    else if (sec.custom === "customers") customersEditor(ed);
    else { var card = h("div", { class: "card" }); renderFields(sec.fields, data, card); ed.appendChild(card); }
    if (sec.extra === "reviewQueue") reviewQueue(ed);
    if (sec.id === "basics" || sec.id === "menu" || sec.id === "gifting" || sec.id === "faq") {
      ed.appendChild(h("p", { class: "help", text: "Fields highlighted in yellow still contain [placeholder] text." }));
    }
    window.scrollTo(0, 0);
  }

  function save() {
    if (!dirty) return;
    var btn = $("#save"); btn.disabled = true; btn.textContent = "Saving…";
    api("PUT", "/api/content", data).then(function (j) {
      $("#status").dataset.saved = "Saved at " + new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); setDirty(false); toast("Saved. The website updates within a minute.");
    }).catch(function (e) { toast(e.message, true); btn.disabled = false; })
      .then(function () { btn.textContent = "Save changes"; });
  }

  // Sections added after the site launched: start them with suggestions. Nothing is published
  // until it's saved, and [bracketed] answers stay hidden from visitors.
  function addNewSections(d) {
    if (!d.gifting) d.gifting = { show: false, kicker: "Diwali 2026", title: "Diwali gift boxes",
      intro: "[One line: what's in the boxes and who they're for]",
      deadline: "[Order by 3 November · delivery 4–7 November]",
      boxes: [
        { name: "[Box name, e.g. Festive cookie box]", price: "[000]", contents: "[One item per line]", image: "" },
        { name: "[Box name]", price: "[000]", contents: "[One item per line]", image: "" },
        { name: "[Box name]", price: "[000]", contents: "[One item per line]", image: "" }
      ], bulkText: "" };
    if (!d.reviews) d.reviews = { googleLink: "", items: [] };
    if (!d.watermark) d.watermark = { show: true, text: "", style: "corner" };
    if (!d.flavours) d.flavours = ((d.cakes || {}).flavours || []).filter(function (n) { return n && !/something else|other|custom/i.test(n); })
      .map(function (n) { return { name: n, desc: "[One or two lines: what it tastes like]", ingredients: "[Main ingredients]", tags: [], price: "", image: "" }; });
    if (!d.faq) d.faq = [
      { q: "How much notice do you need?", a: "[e.g. 2 days for most cakes, 3 days for tiered or photo cakes]" },
      { q: "Can you make it eggless?", a: "Yes, most of our cakes can be made eggless. Just mention it when you order." },
      { q: "Can you make a cake from a photo I send?", a: "Yes. Send reference photos in the WhatsApp chat and we'll confirm what's possible and the final price." },
      { q: "Do you deliver? Which areas?", a: "[e.g. Pickup in Baner, or delivery in Baner, Pashan and Aundh for a small fee]" },
      { q: "How do I pay and confirm my order?", a: "[e.g. A 50% advance by UPI confirms the order; the rest on pickup or delivery]" },
      { q: "Can I change or cancel my order?", a: "[e.g. Changes up to 24 hours before; the advance isn't refundable once baking starts]" },
      { q: "How should I store the cake?", a: "[e.g. Keep it refrigerated and take it out 30 minutes before serving; best eaten within 2 days]" }
    ];
    return d;
  }

  function loadData() {
    return api("GET", "/api/content").then(function (j) { data = addNewSections(j); setDirty(false); render(); refreshBadge(); refreshReviewBadge(); });
  }

  function showLogin() {
    $("#app").hidden = true; $("#login").hidden = false; $("#password").focus();
  }
  function showApp() {
    $("#login").hidden = true; $("#app").hidden = false;
    current = (location.hash || "#basics").slice(1);
    return loadData();
  }
  function logout() {
    if (dirty && !confirm("You have unsaved changes. Sign out anyway?")) return;
    api("POST", "/api/logout", {}).then(function () { setDirty(false); showLogin(); });
  }

  /* ------------------------------------------------------------ wiring --- */
  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("#login-error"); err.textContent = "";
    api("POST", "/api/login", { password: $("#password").value })
      .then(function () { $("#password").value = ""; return showApp(); })
      .catch(function (e2) { err.textContent = e2.message; });
  });
  $("#save").addEventListener("click", save);
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !$("#app").hidden) { e.preventDefault(); save(); }
  });
  window.addEventListener("hashchange", function () {
    current = location.hash.slice(1); $("#sidebar").classList.remove("open"); $("#menu-btn").setAttribute("aria-expanded", "false");
    if (data) render();
  });
  $("#menu-btn").addEventListener("click", function () {
    var open = $("#sidebar").classList.toggle("open"); this.setAttribute("aria-expanded", open ? "true" : "false");
  });
  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  api("GET", "/api/me").then(function (j) { directUpload = !!j.directUpload; return j.loggedIn ? showApp() : showLogin(); })
    .catch(function () { showLogin(); });
})();
