/* Dory's Bakehouse: admin editor */
(function () {
  "use strict";

  /* ------------------------------------------------------------ schema --- */
  var T = function (key, label, help, extra) { return Object.assign({ key: key, label: label, help: help, type: "text" }, extra || {}); };
  var TA = function (key, label, help) { return T(key, label, help, { type: "textarea" }); };
  var IMG = function (key, label, help) { return T(key, label, help, { type: "image" }); };
  var ROW = function () { return { type: "row", fields: [].slice.call(arguments) }; };

  var SECTIONS = [
    { id: "basics", title: "Basics & contact", desc: "Name, contact details and opening hours. These appear on every page.",
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
        { key: "hours", type: "list", label: "Opening hours", itemTitle: "days", addLabel: "Add hours",
          newItem: function () { return { days: "", time: "" }; },
          fields: [ROW(T("days", "Days", "e.g. Monday – Friday"), T("time", "Time", "e.g. 8:00 am – 9:00 pm"))] }
      ] },

    { id: "special", title: "This week's special", desc: "The yellow card at the top of the home page. Update it every week.",
      fields: [{ key: "special", type: "group", fields: [
        { key: "show", type: "bool", label: "Show the special on the home page" },
        T("title", "Name of the special"),
        TA("description", "Description", "One or two lines."),
        ROW(T("price", "Price", "e.g. ₹180"), T("validTill", "Available until", "e.g. Sunday")),
        IMG("image", "Photo", "Optional.")
      ]}] },

    { id: "menu", title: "Menu", desc: "Sections and items on the Menu page. Use the arrows to reorder.",
      fields: [{ key: "menu", type: "list", itemTitle: "section", addLabel: "Add a menu section",
        newItem: function () { return { section: "New section", note: "", items: [] }; },
        fields: [
          ROW(T("section", "Section name"), T("note", "Note", "Optional, e.g. Out of the oven by 9 am")),
          { key: "items", type: "list", label: "Items", itemTitle: "name", addLabel: "Add an item", nested: true,
            newItem: function () { return { name: "", desc: "", price: "", tags: [] }; },
            fields: [
              ROW(T("name", "Item name"), T("price", "Price", "e.g. ₹120")),
              T("desc", "Short description"),
              { key: "tags", type: "tags", label: "Tags", help: "Comma separated. Styled tags: eggless, vegan, bestseller, new" }
            ] }
        ] }] },

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
        { key: "flavours", type: "strings", label: "Flavours", addLabel: "Add a flavour" },
        { key: "sizes", type: "strings", label: "Sizes", addLabel: "Add a size" },
        { key: "occasions", type: "strings", label: "Occasions", addLabel: "Add an occasion" },
        { key: "notes", type: "strings", label: "Good to know", help: "Short policy notes shown beside the form.", addLabel: "Add a note" }
      ]}] },

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

  function tagsInput(f, obj) {
    var id = nid(), input = h("input", { id: id, type: "text", placeholder: "eggless, bestseller" });
    input.value = (obj[f.key] || []).join(", ");
    input.addEventListener("input", function () {
      obj[f.key] = input.value.split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean); changed();
    });
    return h("div", { class: "field" }, [h("label", { for: id }, [f.label, help(f)]), input]);
  }

  function upload(files, target) {
    var fd = new FormData();
    [].forEach.call(files, function (f) { fd.append("photo", f); });
    return api("POST", "/api/upload" + (target ? "?target=" + target : ""), fd, true).then(function (j) { return j.files; });
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

  function historyEditor(root) {
    var card = h("div", { class: "card history" }, [h("p", { class: "muted", text: "Loading…" })]);
    root.appendChild(card);
    api("GET", "/api/history").then(function (list) {
      card.innerHTML = "";
      if (!list.length) { card.appendChild(h("p", { class: "muted", text: "No earlier versions yet. One is kept each time you save." })); return; }
      var ul = h("ul");
      list.forEach(function (stamp) {
        var m = stamp.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
        var d = m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null;
        var label = d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : stamp;
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
      nav.appendChild(h("a", { href: "#" + s.id, "aria-current": s.id === current ? "true" : false, text: s.title }));
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
    else { var card = h("div", { class: "card" }); renderFields(sec.fields, data, card); ed.appendChild(card); }
    if (sec.id === "basics" || sec.id === "menu") {
      ed.appendChild(h("p", { class: "help", text: "Fields highlighted in yellow still contain [placeholder] text." }));
    }
    window.scrollTo(0, 0);
  }

  function save() {
    if (!dirty) return;
    var btn = $("#save"); btn.disabled = true; btn.textContent = "Saving…";
    api("PUT", "/api/content", data).then(function (j) {
      $("#status").dataset.saved = "Saved at " + j.savedAt; setDirty(false); toast("Saved. The website is updated.");
    }).catch(function (e) { toast(e.message, true); btn.disabled = false; })
      .then(function () { btn.textContent = "Save changes"; });
  }

  function loadData() {
    return api("GET", "/api/content").then(function (j) { data = j; setDirty(false); render(); });
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

  api("GET", "/api/me").then(function (j) { return j.loggedIn ? showApp() : showLogin(); })
    .catch(function () { showLogin(); });
})();
