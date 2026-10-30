/* ============================================================
   The Wanderer Outdoors — Control Room (private editor)
   ------------------------------------------------------------
   The dedicated editor at /admin/.
   Features:
     - View Manager (create, toggle, reorder, show/hide in nav)
     - Per-Trip section visibility controls (itinerary, inclusions, etc.)
     - Cover image & gallery upload to Supabase Storage bucket 'site-images'
     - Real Google Reviews integration settings
     - Blog articles manager
     - FAQ manager
     - Bookings inbox with instant receipt inspection
   ============================================================ */
(function () {
  "use strict";

  var LS_KEY = "wandererOutdoors.v2";
  var state = null;
  var dirty = false;
  var currentPanel = "overview";
  var authed = false;
  var localMode = false;

  /* ---------------- tiny DOM helpers ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function deepClone(o) { return JSON.parse(JSON.stringify(o || {})); }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else if (k.indexOf("on") === 0 && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
    });
    if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function toast(msg, ok) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.style.background = ok === false ? "#7f1d1d" : "#1f4d36";
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function markDirty() { dirty = true; var b = $("#saveBtn"); if (b) b.textContent = "Save to site •"; }
  function cleanDirty() { dirty = false; var b = $("#saveBtn"); if (b) b.textContent = "Save to site"; }

  /* ---------------- merge helpers ---------------- */
  function mergeState(remote) {
    var d = deepClone(window.WO_DEFAULTS);
    if (!remote || typeof remote !== "object") return d;
    d.buttonLinks = d.buttonLinks || {};
    ["site", "seo", "brand", "hero", "contact", "booking", "footer", "highlights", "googleReviews", "customTrip", "buttonLinks"].forEach(function (k) {
      if (remote[k] && typeof remote[k] === "object") {
        d[k] = d[k] || {};
        Object.assign(d[k], remote[k]);
      }
    });
    // Ensure all buttonLinks defaults exist if remote did not specify them
    var defBtn = (window.WO_DEFAULTS && window.WO_DEFAULTS.buttonLinks) || {};
    Object.keys(defBtn).forEach(function (bk) {
      if (d.buttonLinks[bk] === undefined || d.buttonLinks[bk] === null || d.buttonLinks[bk] === "") {
        d.buttonLinks[bk] = defBtn[bk];
      }
    });
    if (remote.views && Array.isArray(remote.views) && remote.views.length) d.views = remote.views;
    if (remote.theme && typeof remote.theme === "object") {
      Object.assign(d.theme, remote.theme);
      if (remote.theme.heading) Object.assign(d.theme.heading, remote.theme.heading);
      if (remote.theme.body) Object.assign(d.theme.body, remote.theme.body);
      if (remote.theme.sections) d.theme.sections = remote.theme.sections;
    }
    if (Array.isArray(remote.sections)) {
      d.sections = remote.sections.map(function(s){
        var defSec = (window.WO_DEFAULTS && window.WO_DEFAULTS.sections ? window.WO_DEFAULTS.sections : []).find(function(ds){ return ds.key === s.key || ds.id === s.id; });
        if (s.subsections === undefined && defSec && Array.isArray(defSec.subsections)) {
          s.subsections = defSec.subsections.slice();
        } else if (!Array.isArray(s.subsections)) {
          s.subsections = [];
        }

        // NOTE: Default items are NOT auto-inserted here to preserve user deletions.
        var PURGED_IDS = ['w_kedarkantha','w_brahmatal','w_deoriatal','w_kuari',
          'w_kids_manali','w_wildlife_ranthambore','w_intl_vietnam'];
        s.items = (s.items || [])
          .filter(function(it){ return PURGED_IDS.indexOf(it.id) === -1; })
          .map(function(it){ return window.WO_normalizeItem ? window.WO_normalizeItem(it) : it; });
        return s;
      });
    }
    if (Array.isArray(remote.extraSections)) {
      d.extraSections = remote.extraSections.map(function(s){
        s.items = (s.items || []).map(function(it){ return window.WO_normalizeItem ? window.WO_normalizeItem(it) : it; });
        return s;
      });
    }
    if (Array.isArray(remote.blogs)) d.blogs = remote.blogs;
    if (Array.isArray(remote.faqs))  d.faqs = remote.faqs;
    if (Array.isArray(remote.reviews)) d.reviews = remote.reviews;
    if (remote.positions) d.positions = remote.positions;
    return d;
  }

  function card(title, kids) {
    return el("div", { class: "card" }, [
      title ? el("h3", {}, [title]) : null,
      el("div", {}, kids)
    ]);
  }

  function makeRepeater(arr, renderRow, createItem) {
    var wrap = el("div", { class: "repeater" });
    function refresh() {
      wrap.innerHTML = "";
      arr.forEach(function (item, i) {
        var cb = {
          up: function () { if (i > 0) { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); markDirty(); refresh(); } },
          down: function () { if (i < arr.length - 1) { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); markDirty(); refresh(); } },
          remove: function () { if (confirm("Remove this item?")) { arr.splice(i, 1); markDirty(); refresh(); } },
          rerender: function () { markDirty(); refresh(); }
        };
        wrap.appendChild(renderRow(item, i, cb));
      });
      var addBtn = el("button", { class: "btn btn-ghost mini", style: { marginTop: "8px" }, onclick: function () {
        arr.push(createItem()); markDirty(); refresh();
      } }, ["+ Add item"]);
      wrap.appendChild(addBtn);
    }
    refresh();
    return wrap;
  }

  function getSectionArrayAndIndex(key) {
    var arr = state.sections;
    var i = arr.map(function (s) { return s.key; }).indexOf(key);
    if (i === -1) { arr = state.extraSections; i = arr.map(function (s) { return s.key; }).indexOf(key); }
    if (i === -1) return null;
    return { arr: arr, i: i, sec: arr[i] };
  }

  /* ---------------- field builders ---------------- */
  function field(label, control) {
    return el("div", { class: "field" }, [el("label", {}, [label]), control]);
  }
  function text(label, value, onInput, opts) {
    opts = opts || {};
    var t = opts.textarea
      ? el("textarea", { rows: opts.rows || 3 }, [])
      : el("input", { type: opts.type || "text" }, []);
    if (opts.placeholder) t.setAttribute("placeholder", opts.placeholder);
    if (opts.dataField) t.setAttribute("data-field", opts.dataField);
    t.value = value == null ? "" : value;
    t.addEventListener("input", function () { onInput(t.value); markDirty(); });
    return field(label, t);
  }
  function numberField(label, value, onInput) {
    var t = el("input", { type: "number" }, []);
    t.value = value == null ? "" : value;
    t.addEventListener("input", function () { onInput(t.value); markDirty(); });
    return field(label, t);
  }
  function colorField(label, value, onChange) {
    var c = el("input", { type: "color" }, []);
    c.value = /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#ffffff";
    var wrap = el("div", { class: "inline" }, [c, el("input", { type: "text", value: value || "", placeholder: "#RRGGBB" }, [])]);
    var txt = wrap.querySelector('input[type="text"]');
    c.addEventListener("input", function () { txt.value = c.value; onChange(c.value); markDirty(); });
    txt.addEventListener("input", function () {
      if (/^#[0-9a-fA-F]{6}$/.test(txt.value)) { c.value = txt.value; onChange(txt.value); markDirty(); }
    });
    return field(label, wrap);
  }
  function selectField(label, value, options, onChange) {
    var s = el("select", {}, options.map(function (o) {
      return el("option", { value: o.value, selected: o.value === value ? true : false }, [o.label]);
    }));
    s.value = value;
    s.addEventListener("change", function () { onChange(s.value); markDirty(); });
    return field(label, s);
  }
  function imageField(label, url, onChange) {
    var preview = el("img", { class: "thumb", src: url || "", style: { display: url ? "" : "none" } });
    var urlInput = el("input", { type: "text", placeholder: "Image URL (https://…)", value: url || "" });
    var fileInput = el("input", { type: "file", accept: "image/*", style: { display: "none" } });
    var uploadBtn = el("button", { class: "btn btn-ghost mini", onclick: function () { fileInput.click(); } }, ["Upload"]);
    var removeBtn = el("button", { class: "btn btn-danger mini", onclick: function () {
      onChange(""); urlInput.value = ""; preview.src = ""; preview.style.display = "none";
    } }, ["Remove"]);
    urlInput.addEventListener("input", function () {
      var v = urlInput.value.trim(); onChange(v);
      preview.src = v; preview.style.display = v ? "" : "none";
    });
    fileInput.addEventListener("change", async function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      uploadBtn.textContent = "Uploading…";
      var r = await window.Backend.uploadImage(f);
      uploadBtn.textContent = "Upload";
      if (r && r.ok) { onChange(r.url); urlInput.value = r.url; preview.src = r.url; preview.style.display = ""; toast("Image uploaded to site-images storage"); }
      else toast("Upload failed — " + ((r && r.error) || "check storage bucket") + ". You can paste a URL.", false);
    });
    var ctrl = el("div", { class: "controls" }, [urlInput, el("div", { class: "inline" }, [uploadBtn, removeBtn, fileInput])]);
    return field(label, el("div", { class: "imgfield" }, [preview, ctrl]));
  }

  /* ---------------- save & sync ---------------- */
  async function save() {
    if (!state) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
    if (localMode || !window.Backend.configured()) {
      toast("Saved to local browser.");
      cleanDirty(); return;
    }
    var b = $("#saveBtn"); b.disabled = true; b.textContent = "Saving…";
    var r = await window.Backend.saveContent(state);
    b.disabled = false; cleanDirty();
    if (r && r.ok) toast("Saved to site database ✓ — Live website updated.");
    else if (r && r.auth) toast("Save refused: Not signed in as an authorized editor.", false);
    else toast("Save failed: " + ((r && r.error) || "unknown error"), false);
  }

  /* ---------------- Navigation & Panels ---------------- */
  var PANELS = {
    overview: renderOverview,
    views: renderViewsManager,
    buttons: renderButtons,
    brand: renderBrand,
    theme: renderTheme,
    customTrip: renderCustomTrip,
    seo: renderSEO,
    sections: renderSections,
    blog: renderBlog,
    faq: renderFaq,
    highlights: renderHighlights,
    reviews: renderReviews,
    contact: renderContact,
    bookings: renderBookings,
    enquiries: renderEnquiries,
    account: renderAccount
  };

  function showPanel(name) {
    currentPanel = name;
    Array.from(document.querySelectorAll(".sidebar .nav[data-panel]")).forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-panel") === name);
    });
    var titles = {
      overview: "Overview",
      views: "View Manager",
      buttons: "Button Destinations & Actions",
      brand: "Brand & Hero Background",
      theme: "Design & Theme",
      customTrip: "Custom Trip CTA",
      seo: "SEO & Social Metadata",
      sections: "Sections & Individual Trips",
      blog: "Blog Articles",
      faq: "Frequently Asked Questions",
      highlights: "Highlights & Video Gallery",
      reviews: "Reviews & Google Reviews",
      contact: "Contact & Booking",
      bookings: "Booking Enquiries Inbox",
      enquiries: "General Enquiries Inbox",
      account: "Account & Editors"
    };
    $("#panelTitle").textContent = titles[name] || name;
    var p = $("#panel"); p.innerHTML = "";
    (PANELS[name] || renderOverview)(p);
  }

  /* ============================================================
     Panel: Overview
     ============================================================ */
  function renderOverview(p) {
    var conn = (localMode || !window.Backend.configured())
      ? "Not connected to Supabase — edits save to this browser only."
      : "Connected to Supabase — edits publish to live site wandereroutdoors.in.";
    p.appendChild(card("Welcome to the Control Room", [
      el("p", { class: "tip" }, [conn]),
      el("p", { class: "tip" }, ["Manage modular views, individual trek details, itinerary and gear lists, cover photos, blog articles, FAQs, Google reviews and bookings inbox."]),
      el("div", { class: "row", style: { marginTop: "14px" } }, [
        el("a", { class: "btn btn-primary", href: "../", target: "_blank", rel: "noopener" }, ["↗ Open live site"]),
        el("button", { class: "btn btn-ghost", onclick: function () { save(); } }, ["Save to site now"])
      ])
    ]));
    p.appendChild(card("Tools & Backup", [
      el("div", { class: "grid2" }, [
        el("button", { class: "btn btn-ghost", onclick: exportJSON }, ["Export content as JSON"]),
        el("button", { class: "btn btn-ghost", onclick: importJSON }, ["Import content from JSON"])
      ]),
      el("div", { style: { marginTop: "12px" } }, [
        el("button", { class: "btn btn-danger", onclick: resetAll }, ["Reset site to default content"])
      ])
    ]));
  }

  function exportJSON() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "wanderer-content.json" }, []);
    document.body.appendChild(a); a.click(); a.remove();
    toast("Exported content.");
  }
  function importJSON() {
    var inp = el("input", { type: "file", accept: "application/json", style: { display: "none" } }, []);
    document.body.appendChild(inp);
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          state = mergeState(JSON.parse(rd.result));
          markDirty(); save(); toast("Imported and saved."); showPanel(currentPanel);
        } catch (e) { toast("Invalid JSON file.", false); }
      };
      rd.readAsText(f); inp.remove();
    });
    inp.click();
  }
  async function resetAll() {
    if (!confirm("Reset the entire site to its default content? This erases all edits (bookings database is kept untouched).")) return;
    state = deepClone(window.WO_DEFAULTS); markDirty(); await save(); showPanel(currentPanel); toast("Reset to defaults.");
  }

  /* ============================================================
     Panel: View Manager (Requirement 4 & MD Section 4)
     ============================================================ */
  function renderViewsManager(p) {
    p.appendChild(el("p", { class: "tip" }, [
      "Manage entire website views. Hide a view to take it off public navigation while keeping all data saved. Reorder with ↑ / ↓."
    ]));

    var views = state.views || (state.views = deepClone(window.WO_DEFAULTS.views));

    var list = el("div", { class: "card" });
    views.forEach(function (v, idx) {
      var row = el("div", { class: "section-block", style: { marginBottom: "10px" } }, [
        el("div", { class: "inline", style: { justifyContent: "space-between" } }, [
          el("div", { class: "inline", style: { flex: 1 } }, [
            el("strong", {}, [v.title || v.id]),
            el("span", { class: "tip" }, ["Route: " + (v.path || "/" + v.id)])
          ]),
          el("div", { class: "inline" }, [
            el("label", { class: "inline", style: { fontSize: "12px" } }, [
              el("input", { type: "checkbox", checked: v.enabled !== false, onchange: function (e) {
                v.enabled = e.target.checked; markDirty();
              } }), " Enabled"
            ]),
            el("label", { class: "inline", style: { fontSize: "12px", marginLeft: "8px" } }, [
              el("input", { type: "checkbox", checked: v.inNav !== false, onchange: function (e) {
                v.inNav = e.target.checked; markDirty();
              } }), " In Nav"
            ]),
            el("button", { class: "btn btn-ghost mini", onclick: function () {
              if (idx > 0) { views.splice(idx - 1, 0, views.splice(idx, 1)[0]); markDirty(); renderViewsManager(p); }
            } }, ["↑"]),
            el("button", { class: "btn btn-ghost mini", onclick: function () {
              if (idx < views.length - 1) { views.splice(idx + 1, 0, views.splice(idx, 1)[0]); markDirty(); renderViewsManager(p); }
            } }, ["↓"]),
            el("button", { class: "btn btn-danger mini", onclick: function () {
              if (confirm("Delete view '" + (v.title || v.id) + "'? If you only want to take it down, uncheck 'Enabled' instead.")) {
                views.splice(idx, 1); markDirty(); renderViewsManager(p);
              }
            } }, ["Delete"])
          ])
        ]),
        el("div", { class: "grid2", style: { marginTop: "10px" } }, [
          text("Title", v.title, function (val) { v.title = val; }),
          text("Path / URL slug", v.path, function (val) { v.path = val; })
        ])
      ]);
      list.appendChild(row);
    });

    list.appendChild(el("button", { class: "btn btn-primary", onclick: function () {
      var title = prompt("New view title (e.g. Expeditions):");
      if (!title) return;
      var slug = "/" + (window.WO_slugify ? window.WO_slugify(title) : title.toLowerCase());
      views.push({
        id: "view_" + Date.now().toString(36),
        title: title,
        path: slug,
        inNav: true,
        enabled: true
      });
      markDirty(); renderViewsManager(p);
    } }, ["+ Add new view"]));

    p.appendChild(list);
  }


  /* ============================================================
     Panel: Button Destinations & Navigation Links
     ============================================================ */
  function renderButtons(p) {
    var bl = state.buttonLinks || (state.buttonLinks = {});
    var h = state.hero || (state.hero = {});
    var c = state.customTrip || (state.customTrip = {});

    p.appendChild(el("p", { class: "tip", style: { fontSize: "14px", lineHeight: "1.6", marginBottom: "16px" } }, [
      "Manage the label and destination of every public button across your entire website from this central panel. Use internal routes (e.g. ",
      el("code", {}, ["#/contact"]),
      ", ",
      el("code", {}, ["#/booking"]),
      ", ",
      el("code", {}, ["#/treks"]),
      "), section IDs, or full external URLs (e.g. ",
      el("code", {}, ["https://wa.me/917387778296"]),
      "). All changes take effect on the live website after clicking 'Save to site'."
    ]));

    // Card 1: Homepage Action Buttons
    p.appendChild(card("1. Homepage Action Buttons", [
      el("strong", { style: { display: "block", color: "#6cc28f", margin: "4px 0 8px" } }, ["Hero Section Primary Button"]),
      text("Hero Button Label", h.ctaText || "Plan an Adventure", function(v){ h.ctaText = v; bl.heroCtaLabel = v; }),
      text("Hero Button Destination", h.ctaHref || bl.heroCta || "/treks", function(v){ h.ctaHref = v; bl.heroCta = v; }, { placeholder: "/treks or #/contact" }),

      el("strong", { style: { display: "block", color: "#6cc28f", margin: "18px 0 8px" } }, ["Green Call-To-Action Banner ('Ready to explore…' block)"]),
      text("CTA Banner Headline", bl.homeCTATitle || "Ready to explore the outdoors?", function(v){ bl.homeCTATitle = v; }),
      text("CTA Banner Subtitle", bl.homeCTASubtitle || "Speak directly with our instructors on WhatsApp or book your spot in under 2 minutes.", function(v){ bl.homeCTASubtitle = v; }, { textarea: true }),
      text("Reserve a Spot Button Label", bl.homeReserveLabel || "Reserve a Spot", function(v){ bl.homeReserveLabel = v; }),
      text("Reserve a Spot Button Destination", bl.homeReserve || "#/contact", function(v){ bl.homeReserve = v; }, { placeholder: "#/contact or #/booking or full URL" }),
      text("CTA Banner WhatsApp Us Link", bl.homeWhatsApp || "https://wa.me/917387778296", function(v){ bl.homeWhatsApp = v; }, { placeholder: "https://wa.me/..." }),

      el("strong", { style: { display: "block", color: "#6cc28f", margin: "18px 0 8px" } }, ["Featured Adventures Section"]),
      text("Featured Section 'View all' Button Label", bl.featuredTripsLabel || "View all treks & camps ▸", function(v){ bl.featuredTripsLabel = v; }),
      text("Featured Section 'View all' Destination", bl.featuredTrips || "#/treks", function(v){ bl.featuredTrips = v; }, { placeholder: "#/treks" })
    ]));

    // Card 2: Blog Article Action Buttons
    p.appendChild(card("2. Blog & Trail Guide Article Buttons", [
      el("p", { class: "tip" }, ["Buttons appearing at the bottom of every individual blog article:"]),
      text("Article Bottom Primary Button Label (e.g. Plan a Trip with Us)", bl.blogCtaLabel || "Plan a Trip with Us", function(v){ bl.blogCtaLabel = v; }, { placeholder: "Plan a Trip with Us" }),
      text("Article Bottom Primary Button Destination", bl.blogCtaHref || "#/contact", function(v){ bl.blogCtaHref = v; }, { placeholder: "#/contact or #/booking or https://..." }),
      text("Article 'Back to Articles' Button Label", bl.blogBackLabel || "← Back to Articles", function(v){ bl.blogBackLabel = v; })
    ]));

    // Card 3: Contact Us & Enquiry Submission Buttons
    p.appendChild(card("3. Contact Us & Enquiry Submission Buttons", [
      el("p", { class: "tip" }, ["Controls for the enquiry form on the Contact Us page:"]),
      text("Enquiry Form Submit Button Label", bl.contactSubmitLabel || "Submit enquiry", function(v){ bl.contactSubmitLabel = v; }, { placeholder: "Submit enquiry" }),
      text("Optional Redirect URL after enquiry submission (leave blank to stay on page)", bl.contactSubmitRedirect || "", function(v){ bl.contactSubmitRedirect = v; }, { placeholder: "e.g. https://wa.me/917387778296 or blank" })
    ]));

    // Card 4: Custom Trip & Tours Section
    p.appendChild(card("4. Custom Trip & Tours Section ('Plan Your Trip With Us')", [
      el("p", { class: "tip" }, ["The custom-trip invitation banner featured on the Tours page and customizable globally:"]),
      text("Invitation Eyebrow", c.kicker || "Your journey, your way", function(v){ c.kicker = v; }),
      text("Invitation Heading", c.title || "Plan Your Trip With Us", function(v){ c.title = v; }),
      text("Plan My Trip Button Label", c.buttonTextLabel || "Plan My Trip", function(v){ c.buttonTextLabel = v; }),
      text("Plan My Trip Button Destination", c.buttonUrl || "#/contact", function(v){ c.buttonUrl = v; }, { placeholder: "#/contact or https://..." })
    ]));

    // Card 5: Booking Form & Float Actions
    p.appendChild(card("5. Booking Flow & Floating Actions", [
      text("Booking Form 'Confirm Booking' Button Label", bl.bookingSubmitLabel || "Confirm Booking", function(v){ bl.bookingSubmitLabel = v; }),
      text("Booking Success 'Book another trip' Button Label", bl.bookAnotherLabel || "Book another trip", function(v){ bl.bookAnotherLabel = v; }),
      text("Floating WhatsApp Button URL", bl.floatingWhatsApp || ("https://wa.me/" + (state.contact.whatsapp || "917387778296").replace(/\D/g, "")), function(v){ bl.floatingWhatsApp = v; }, { placeholder: "https://wa.me/917387778296" })
    ]));

    // Card 6: Footer Links
    p.appendChild(card("6. Footer Action Links", [
      text("Footer WhatsApp Link", bl.footerWhatsApp || "https://wa.me/917387778296", function(v){ bl.footerWhatsApp = v; }, { placeholder: "https://wa.me/..." }),
      text("Footer Email Link", bl.footerEmail || "mailto:hello@wandereroutdoors.in", function(v){ bl.footerEmail = v; }, { placeholder: "mailto:..." }),
      text("Footer Instagram Link", bl.footerInstagram || "https://www.instagram.com/the_wanderer_outdoors/", function(v){ bl.footerInstagram = v; }, { placeholder: "https://instagram.com/..." })
    ]));
  }

  /* ============================================================
     Panel: Brand & Hero Background
     ============================================================ */
  function renderBrand(p) {
    var b = state.brand, h = state.hero, t = state.theme || (state.theme = {});
    p.appendChild(card("Brand Identity", [
      text("Brand name", b.name, function (v) { b.name = v; }),
      text("Tagline", b.tagline, function (v) { b.tagline = v; }),
      imageField("Logo", b.logo, function (v) { b.logo = v; })
    ]));
    state.buttonLinks = state.buttonLinks || {};
    p.appendChild(card("Homepage & global button destinations", [
      el("p", { class: "tip" }, ["Change the destinations of the main homepage actions without editing code. Use internal routes such as #/contact or #/booking, or a full https:// URL."]),
      text("Reserve a Spot button destination", state.buttonLinks.homeReserve || "#/contact", function(v){ state.buttonLinks.homeReserve=v; }, {placeholder:"#/contact or #/booking"}),
      text("View all treks & camps destination", state.buttonLinks.featuredTrips || "#/treks", function(v){ state.buttonLinks.featuredTrips=v; }, {placeholder:"#/treks"}),
      text("Home WhatsApp button destination", state.buttonLinks.homeWhatsApp || "https://wa.me/917387778296", function(v){ state.buttonLinks.homeWhatsApp=v; }, {placeholder:"https://wa.me/..."}),
      text("Footer WhatsApp destination", state.buttonLinks.footerWhatsApp || "https://wa.me/917387778296", function(v){ state.buttonLinks.footerWhatsApp=v; }, {placeholder:"https://wa.me/..."}),
      text("Footer email destination", state.buttonLinks.footerEmail || "mailto:hello@wandereroutdoors.in", function(v){ state.buttonLinks.footerEmail=v; }, {placeholder:"mailto:..."})
    ]));

    // Home CTA Banner — "Ready to explore the outdoors?" section
    p.appendChild(card("Home CTA Banner ('Ready to explore…' block)", [
      el("p", { class: "tip" }, ["Customize the high-visibility green invitation banner on your homepage. Control the headline, subtitle, button text, and exactly where 'Reserve a Spot' redirects."]),
      text("Banner Title", state.buttonLinks.homeCTATitle || "Ready to explore the outdoors?", function(v){ state.buttonLinks.homeCTATitle=v; }, {placeholder:"Ready to explore the outdoors?"}),
      text("Banner Subtitle / Description", state.buttonLinks.homeCTASubtitle || "Speak directly with our instructors on WhatsApp or book your spot in under 2 minutes.", function(v){ state.buttonLinks.homeCTASubtitle=v; }, {textarea:true, placeholder:"Subtitle text..."}),
      text("Reserve a Spot Button Label", state.buttonLinks.homeReserveLabel || "Reserve a Spot", function(v){ state.buttonLinks.homeReserveLabel=v; }, {placeholder:"Reserve a Spot"}),
      text("Reserve a Spot Button Destination", state.buttonLinks.homeReserve || "#/contact", function(v){ state.buttonLinks.homeReserve=v; }, {placeholder:"#/contact or #/booking or https://..."})
    ]));

    // Dedicated Hero Background controls with live preview, upload, and reset
    var heroDefaultImg = "https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?w=1800&q=70";
    p.appendChild(card("Hero Header & Background Image", [
      text("Headline", h.title, function (v) { h.title = v; }),
      text("Subtitle", h.subtitle, function (v) { h.subtitle = v; }, { textarea: true }),
      text("Button text", h.ctaText, function (v) { h.ctaText = v; }),
      text("Button link (e.g. /treks or https://…)", h.ctaHref, function (v) { h.ctaHref = v; }),
      el("div", { style: { marginTop: "12px", borderTop: "1px solid #25312a", paddingTop: "12px" } }, [
        el("strong", { style: { display: "block", marginBottom: "8px", color: "#6cc28f" } }, ["Hero Section Background Photo"]),
        imageField("Hero Photo (Upload to Supabase Storage or paste URL)", h.bg, function (v) { h.bg = v; }),
        el("div", { class: "inline", style: { marginTop: "8px" } }, [
          el("button", { class: "btn btn-ghost mini", onclick: function() {
            h.bg = heroDefaultImg;
            markDirty();
            showPanel("brand");
            toast("Reset hero background to default mountain panorama.");
          } }, ["Reset to Default Hero Image"]),
          el("span", { class: "tip" }, ["Default: High-resolution mountain panorama"])
        ])
      ])
    ]));

    // Global Page Background Image control
    p.appendChild(card("Website Background Texture / Image (Optional)", [
      el("p", { class: "tip" }, ["Optionally set a background image for the entire website. If left blank, the solid theme background color is used."]),
      imageField("Full Page Background Image", t.pageBgImage || "", function (v) { t.pageBgImage = v; }),
      el("div", { class: "inline", style: { marginTop: "8px" } }, [
        el("button", { class: "btn btn-ghost mini", onclick: function() {
          t.pageBgImage = "";
          markDirty();
          showPanel("brand");
          toast("Cleared page background image. Using solid theme background color.");
        } }, ["Clear Page Background Image"])
      ])
    ]));
  }

  /* ============================================================
     Panel: Design & Theme
     ============================================================ */
  function renderTheme(p) {
    var t = state.theme || (state.theme = {});
    var presetOpts = Object.keys(window.WO_THEME_PRESETS).map(function (k) {
      return { value: k, label: window.WO_THEME_PRESETS[k].label };
    });
    p.appendChild(card("Theme preset", [
      selectField("Colour preset", t.preset || "light", presetOpts, function (v) {
        var pr = window.WO_THEME_PRESETS[v]; if (!pr) return;
        t.preset = v; t.pageBg = pr.pageBg; t.pageText = pr.pageText; t.accent = pr.accent; t.accent2 = pr.accent2; t.sectionBg = pr.sectionBg;
        markDirty(); showPanel("theme");
      }),
      el("p", { class: "tip" }, ["Presets apply theme colors across all full-page views."])
    ]));
    p.appendChild(card("Site colours", [
      colorField("Page background", t.pageBg, function (v) { t.pageBg = v; }),
      colorField("Page text", t.pageText, function (v) { t.pageText = v; }),
      colorField("Accent (Ember)", t.accent, function (v) { t.accent = v; }),
      colorField("Secondary accent (Forest)", t.accent2, function (v) { t.accent2 = v; }),
      colorField("Section background", t.sectionBg, function (v) { t.sectionBg = v; }),
      colorField("Global heading text", (t.heading && t.heading.color) || "#1A1F1B", function (v) { t.heading = t.heading || {}; t.heading.color = v; }),
      colorField("Global body text", (t.body && t.body.color) || "#1A1F1B", function (v) { t.body = t.body || {}; t.body.color = v; }),
      colorField("Footer background", (t.footerBg || "#F1ECE3"), function (v) { t.footerBg = v; }),
      colorField("Footer text", (t.footerText || "#1A1F1B"), function (v) { t.footerText = v; })
    ]));
    p.appendChild(card("Page Background Image", [
      imageField("Global Background Image (optional)", t.pageBgImage || "", function(v){ t.pageBgImage = v; }),
      el("div", { class: "inline", style: { marginTop: "8px" } }, [
        el("button", { class: "btn btn-ghost mini", onclick: function(){ t.pageBgImage = ""; markDirty(); showPanel("theme"); } }, ["Remove Image & Keep Solid Color"])
      ])
    ]));
  }

  function renderCustomTrip(p) {
    var c = state.customTrip || (state.customTrip = {});
    p.appendChild(card("Plan Your Trip With Us", [
      text("Eyebrow", c.kicker || "Your journey, your way", function(v){ c.kicker=v; }),
      text("Heading", c.title || "Plan Your Trip With Us", function(v){ c.title=v; }),
      text("Description", c.description || "Tell us where you want to go, when you want to travel, and what kind of experience you have in mind.", function(v){ c.description=v; }, {textarea:true}),
      text("Button label", c.buttonTextLabel || "Plan My Trip", function(v){ c.buttonTextLabel=v; }),
      text("Button destination", c.buttonUrl || "#/contact", function(v){ c.buttonUrl=v; }, {placeholder:"#/contact or https://…"}),
      colorField("Panel background", c.background || "#1F4D36", function(v){ c.background=v; }),
      colorField("Panel text", c.text || "#FFFFFF", function(v){ c.text=v; }),
      colorField("Button background", c.buttonBackground || "#D9582B", function(v){ c.buttonBackground=v; }),
      colorField("Button text", c.buttonText || "#FFFFFF", function(v){ c.buttonText=v; })
    ]));
  }

  /* ============================================================
     Panel: SEO & Social Metadata (Requirement 7)
     ============================================================ */
  function renderSEO(p) {
    p.appendChild(el("p", { class: "tip" }, [
      "Edit the SEO values below, then click the Control Room Save button to store them in Supabase. The public app applies them when it loads. Search engines may need time to recrawl the site; social preview bots may not read JavaScript-updated tags, so share previews should be checked after launch."
    ]));

    var s = state.seo || (state.seo = {
      title: "The Wanderer Outdoors — Live. Travel. Explore.",
      metaDescription: "Adventure and outdoor activities — winter & summer camps, treks, tours, outings and corporate events across the Indian Himalayas and Sahyadris.",
      canonicalUrl: "https://www.wandereroutdoors.in/",
      ogTitle: "The Wanderer Outdoors — Live. Travel. Explore.",
      ogDescription: "Hand-crafted Himalayan & Sahyadri treks, winter & summer camps, tours, day outings and corporate offsites.",
      ogImage: "https://www.wandereroutdoors.in/assets/logo.png",
      keywords: "Himalayan treks, Sahyadri treks, winter camps, summer camps, adventure tours, day outings, corporate offsites, The Wanderer Outdoors",
      robots: "index, follow"
    });

    p.appendChild(card("Search Engine Metadata", [
      text("Website Title (<title>)", s.title, function (v) { s.title = v; if (state.site) state.site.title = v; }),
      text("Meta Description", s.metaDescription, function (v) { s.metaDescription = v; }, { textarea: true }),
      text("Canonical Domain URL (e.g. https://www.wandereroutdoors.in/)", s.canonicalUrl, function (v) { s.canonicalUrl = v; }),
      text("Search Keywords (comma separated)", s.keywords || "", function (v) { s.keywords = v; }),
      text("Search Engine Indexing Directives (e.g. index, follow)", s.robots || "index, follow", function (v) { s.robots = v; })
    ]));

    p.appendChild(card("Social Media & Open Graph (WhatsApp, Facebook, Twitter/X)", [
      el("p", { class: "tip" }, [
        "These tags control how your website previews appear when links are shared on WhatsApp, Facebook, LinkedIn, and Twitter."
      ]),
      text("Social Share Title (og:title)", s.ogTitle || "", function (v) { s.ogTitle = v; }),
      text("Social Share Description (og:description)", s.ogDescription || "", function (v) { s.ogDescription = v; }, { textarea: true }),
      imageField("Social Share Preview Image (og:image) (Upload or paste URL)", s.ogImage || "", function (v) { s.ogImage = v; })
    ]));

    p.appendChild(card("Sitemap & Robots Verification", [
      el("p", { class: "tip" }, [
        "These links let you inspect the static sitemap.xml and robots.txt files; they do not verify Google indexing by themselves. After the domain is live, add it in Google Search Console and submit https://www.wandereroutdoors.in/sitemap.xml. The current site uses hash-based sections, so those sections are not separate crawlable URLs in the sitemap; clean page URLs/server-rendered metadata can be added in a later SEO phase."
      ]),
      el("div", { class: "inline", style: { gap: "12px", marginTop: "8px" } }, [
        el("a", { href: "../sitemap.xml", target: "_blank", rel: "noopener", class: "btn btn-ghost mini" }, ["↗ View sitemap.xml"]),
        el("a", { href: "../robots.txt", target: "_blank", rel: "noopener", class: "btn btn-ghost mini" }, ["↗ View robots.txt"])
      ])
    ]));
  }

  /* ============================================================
     Panel: Sections & Treks (Enhanced with Per-Trip Controls)
     ============================================================ */
  function renderSections(p) {
    p.appendChild(el("p", { class: "tip" }, [
      "Manage categories and each individual adventure. For each trip, you can upload cover photos, add galleries, itinerary, inclusions, gear, and toggle section visibility."
    ]));

    var all = [].concat(state.sections || [], state.extraSections || []);
    all.forEach(function (sec) {
      var ref = getSectionArrayAndIndex(sec.key);
      var block = el("div", { class: "section-block" });

      block.appendChild(el("div", { class: "sec-head" }, [
        el("b", {}, [sec.title || sec.key]),
        el("button", { class: "btn btn-ghost mini", onclick: function () {
          if (ref.i > 0) { ref.arr.splice(ref.i - 1, 0, ref.arr.splice(ref.i, 1)[0]); markDirty(); showPanel("sections"); }
        } }, ["↑"]),
        el("button", { class: "btn btn-ghost mini", onclick: function () {
          if (ref.i < ref.arr.length - 1) { ref.arr.splice(ref.i + 1, 0, ref.arr.splice(ref.i, 1)[0]); markDirty(); showPanel("sections"); }
        } }, ["↓"]),
        el("label", { class: "inline", style: { marginLeft: "auto" } }, [
          el("input", { type: "checkbox", checked: !!sec.hidden, onchange: function (e) { sec.hidden = e.target.checked; markDirty(); } }), " Hidden"
        ]),
        el("button", { class: "btn btn-danger mini", onclick: function () {
          if (!confirm("Delete this section and its trips?")) return;
          ref.arr.splice(ref.i, 1); markDirty(); showPanel("sections");
        } }, ["Delete"])
      ]));

      block.appendChild(text("Eyebrow / Kicker", sec.kicker, function (v) { sec.kicker = v; }));
      block.appendChild(text("Category Title", sec.title, function (v) { sec.title = v; }));
      block.appendChild(text("Intro", sec.intro, function (v) { sec.intro = v; }, { textarea: true }));
      sec.colors = sec.colors || {};
      block.appendChild(card("Section colours", [
        colorField("Section background", sec.colors.background || "#FAF7F2", function(v){ sec.colors.background=v; }),
        colorField("Section heading", sec.colors.heading || "#1A1F1B", function(v){ sec.colors.heading=v; }),
        colorField("Section body text", sec.colors.text || "#1A1F1B", function(v){ sec.colors.text=v; }),
        colorField("Section accent / CTA buttons", sec.colors.accent || "#D9582B", function(v){ sec.colors.accent=v; })
      ]));
      sec.buttonLinks = sec.buttonLinks || {};
      block.appendChild(card("Section call-to-action button (optional)", [
        el("label", { class: "inline" }, [el("input", { type: "checkbox", checked: !!sec.buttonLinks.ctaEnabled, onchange: function(e){ sec.buttonLinks.ctaEnabled=e.target.checked; markDirty(); } }), " Show a CTA button below this section heading"]),
        text("Button label", sec.buttonLinks.ctaLabel || "Enquire Now", function(v){ sec.buttonLinks.ctaLabel=v; }),
        text("Button destination", sec.buttonLinks.cta || "#/contact", function(v){ sec.buttonLinks.cta=v; }, {placeholder:"#/contact, #/booking, https://…"}),
        text("Homepage category pill destination", sec.buttonLinks.nav || ("#/" + sec.key), function(v){ sec.buttonLinks.nav=v; }, {placeholder:"#/treks, #/contact, https://…"})
      ]));

      // Subsections / Subcategories Management
      sec.subsections = Array.isArray(sec.subsections) ? sec.subsections : [];
      var subCard = el("div", { class: "card", style: { background: "#131d16", border: "1px solid #233b2a", margin: "14px 0", padding: "14px 16px" } });
      subCard.appendChild(el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" } }, [
        el("strong", { style: { color: "#6cc28f", fontSize: "14px" } }, ["📂 Subsections / Categories for " + (sec.title || sec.key)]),
        el("span", { class: "muted", style: { fontSize: "12px" } }, [sec.subsections.length + " subsection" + (sec.subsections.length === 1 ? "" : "s")])
      ]));
      subCard.appendChild(el("p", { class: "tip", style: { margin: "0 0 10px 0", fontSize: "12.5px", color: "#a0b0a6" } }, [
        "Organize trips into interactive category tabs on the website (e.g. Kids Camps, Adults Adventure, Family Tours, Wildlife, International, Backpacking / Road Trip). If you delete all subsections or leave this empty, the website will display all trips together as normal without tabs."
      ]));

      var subListWrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" } });
      if (sec.subsections.length === 0) {
        subListWrap.appendChild(el("div", { style: { fontSize: "12.5px", color: "#8a968e", fontStyle: "italic", padding: "4px 0" } }, [
          "No subsections active. All trips in this category will display in one standard grid."
        ]));
      } else {
        sec.subsections.forEach(function (subName, subIdx) {
          var row = el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, [
            el("input", {
              type: "text",
              value: subName,
              placeholder: "Subsection Name",
              style: { flex: 1, padding: "6px 10px", fontSize: "13px", background: "#0c140f", border: "1px solid #243c2a", borderRadius: "6px", color: "#fff" },
              oninput: function(e){
                sec.subsections[subIdx] = e.target.value.trim();
                markDirty();
              }
            }),
            el("button", {
              class: "btn btn-ghost mini",
              title: "Move up",
              onclick: function(e){
                e.preventDefault();
                if (subIdx > 0) {
                  sec.subsections.splice(subIdx - 1, 0, sec.subsections.splice(subIdx, 1)[0]);
                  markDirty();
                  showPanel("sections");
                }
              }
            }, ["↑"]),
            el("button", {
              class: "btn btn-ghost mini",
              title: "Move down",
              onclick: function(e){
                e.preventDefault();
                if (subIdx < sec.subsections.length - 1) {
                  sec.subsections.splice(subIdx + 1, 0, sec.subsections.splice(subIdx, 1)[0]);
                  markDirty();
                  showPanel("sections");
                }
              }
            }, ["↓"]),
            el("button", {
              class: "btn btn-danger mini",
              title: "Delete subsection",
              onclick: function(e){
                e.preventDefault();
                sec.subsections.splice(subIdx, 1);
                markDirty();
                showPanel("sections");
              }
            }, ["✕"])
          ]);
          subListWrap.appendChild(row);
        });
      }
      subCard.appendChild(subListWrap);

      subCard.appendChild(el("button", {
        class: "btn btn-ghost mini",
        style: { fontSize: "12px", border: "1px dashed #3a5c43" },
        onclick: function(e){
          e.preventDefault();
          sec.subsections.push("New Subsection");
          markDirty();
          showPanel("sections");
        }
      }, ["+ Add Subsection / Category"]));
      block.appendChild(subCard);

      // Individual Trips List in this category
      block.appendChild(el("h3", { style: { fontSize: "15px", marginTop: "16px", color: "#d9582b" } }, [
        "Adventures & Packages in " + (sec.title || sec.key)
      ]));

      sec.items = (sec.items || []).map(function(it){ return window.WO_normalizeItem ? window.WO_normalizeItem(it) : it; });

      var itemsWrap = el("div", { style: { marginTop: "10px" } });
      sec.items.forEach(function (item, itIdx) {
        var itBlock = el("details", { class: "section-block", style: { background: "#101612", marginBottom: "10px" } });
        var itSummary = el("summary", { style: { cursor: "pointer", fontWeight: "700", padding: "8px 0", display: "flex", alignItems: "center", gap: "10px" } }, [
          el("span", { style: { flex: 1 } }, [(item.name || "Untitled") + " (₹" + (item.cost || "") + " · " + (item.days || "") + ")"]),
          el("button", { class: "btn btn-ghost mini", onclick: function (e) {
            e.preventDefault();
            if (itIdx > 0) { sec.items.splice(itIdx - 1, 0, sec.items.splice(itIdx, 1)[0]); markDirty(); showPanel("sections"); }
          } }, ["↑"]),
          el("button", { class: "btn btn-ghost mini", onclick: function (e) {
            e.preventDefault();
            if (itIdx < sec.items.length - 1) { sec.items.splice(itIdx + 1, 0, sec.items.splice(itIdx, 1)[0]); markDirty(); showPanel("sections"); }
          } }, ["↓"]),
          el("button", { class: "btn btn-danger mini", onclick: function (e) {
            e.preventDefault();
            if (confirm("Delete adventure '" + item.name + "'?")) {
              sec.items.splice(itIdx, 1); markDirty(); showPanel("sections");
            }
          } }, ["✕"])
        ]);
        itBlock.appendChild(itSummary);

        var itContent = el("div", { style: { paddingTop: "12px", borderTop: "1px solid #222c24" } });

        // Basic Info
        itContent.appendChild(el("div", { class: "grid2" }, [
          text("Adventure Name", item.name, function (v) {
            item.name = v;
            // Auto-sync slug if empty or if matching old default
            if (!item.slug || item.slug === "kedarkantha-winter-trek") {
              item.slug = window.WO_slugify ? window.WO_slugify(v) : v.toLowerCase().replace(/[^\w-]/g, "");
              var slugInp = itContent.querySelector("input[data-field='slug']");
              if (slugInp) slugInp.value = item.slug;
            }
            var sSpan = itSummary.querySelector("span");
            if (sSpan) sSpan.textContent = (item.name || "Untitled") + " (₹" + (item.cost || "") + " · " + (item.days || "") + ")";
          }),
          text("Cost (INR)", item.cost, function (v) { item.cost = v; })
        ]));
        itContent.appendChild(el("div", { class: "grid2" }, [
          text("URL Slug (e.g. lakeside-camping)", item.slug || (window.WO_slugify ? window.WO_slugify(item.name) : ""), function (v) {
            item.slug = window.WO_slugify ? window.WO_slugify(v) : v.toLowerCase().replace(/[^\w-]/g, "");
          }, { placeholder: "lakeside-camping", dataField: "slug" }),
          text("Duration (e.g. 1 day or 6 days)", item.days, function (v) { item.days = v; })
        ]));
        itContent.appendChild(text("Dates Summary (e.g. 20th Sept or Dec - Feb)", item.dates, function (v) { item.dates = v; }));

        // Subsection Assignment
        if (sec.subsections && sec.subsections.length > 0) {
          var subOpts = [el("option", { value: "" }, ["-- None / Default (shows under All) --"])];
          sec.subsections.forEach(function(sub){
            var opt = el("option", { value: sub }, [sub]);
            if (item.subsection === sub) opt.selected = true;
            subOpts.push(opt);
          });
          var subSelect = el("select", {
            style: { width: "100%", padding: "8px 10px", background: "#0c140f", border: "1px solid #243c2a", borderRadius: "6px", color: "#fff", fontSize: "13px" },
            onchange: function(e){ item.subsection = e.target.value; markDirty(); }
          }, subOpts);
          itContent.appendChild(el("div", { style: { margin: "10px 0" } }, [
            el("label", { style: { display: "block", fontSize: "12.5px", fontWeight: "600", marginBottom: "4px", color: "#6cc28f" } }, [
              "Assigned Subsection / Category"
            ]),
            subSelect
          ]));
        }

        // Pick-up / Meeting Point
        itContent.appendChild(text("Pick-up / Meeting Point (e.g. Ex-Pune, Mumbai Airport, Base village)", item.pickup || "", function(v){ item.pickup = v; markDirty(); }, { placeholder: "e.g. Ex-Pune / Base village" }));

        // Image Display Fit
        var fitVal = item.imageFit || 'cover';
        var fitOpts = ['cover', 'contain'].map(function(f){
          var o = el("option", { value: f }, [f === 'cover' ? 'Cover (fill frame, may crop)' : 'Contain (show full image)']);
          if (fitVal === f) o.selected = true;
          return o;
        });
        var fitSelect = el("select", {
          style: { width: "100%", padding: "8px 10px", background: "#0c140f", border: "1px solid #243c2a", borderRadius: "6px", color: "#fff", fontSize: "13px" },
          onchange: function(e){ item.imageFit = e.target.value; markDirty(); }
        }, fitOpts);
        itContent.appendChild(el("div", { style: { margin: "10px 0" } }, [
          el("label", { style: { display: "block", fontSize: "12.5px", fontWeight: "600", marginBottom: "4px", color: "#6cc28f" } }, ["Cover Image Display Mode"]),
          fitSelect
        ]));

        // Upcoming Batches / Departure Dates
        var batchStr = (item.batches || []).join("\n");
        itContent.appendChild(text("Upcoming Batches / Departure Dates (one per line, e.g. '15–20 Dec 2026' or 'Batch 1: 24–29 Dec (Christmas)')", batchStr, function(v){
          item.batches = v.split("\n").map(function(s){ return s.trim(); }).filter(Boolean);
        }, {
          textarea: true,
          placeholder: "15–20 Dec 2026\n24–29 Dec 2026 (Christmas Special)\n29 Dec 2026 – 03 Jan 2027 (New Year Summit)\n12–17 Jan 2027"
        }));

        // Cover Image (Upload or URL)
        var coverUrl = (item.coverImage && item.coverImage.url) ? item.coverImage.url : "";
        itContent.appendChild(imageField("Trip Cover Image", coverUrl, function (v) {
          item.coverImage = { url: v, path: "" };
        }));

        // Description
        itContent.appendChild(text("Overview / Description", item.desc, function (v) { item.desc = v; }, { textarea: true }));
        item.colors = item.colors || {}; item.buttonLinks = item.buttonLinks || {};
        itContent.appendChild(card("Card colours & button destinations", [
          colorField("Card background", item.colors.background || "#FFFFFF", function(v){ item.colors.background=v; }),
          colorField("Card text", item.colors.text || "#1A1F1B", function(v){ item.colors.text=v; }),
          colorField("Card heading", item.colors.heading || "#1A1F1B", function(v){ item.colors.heading=v; }),
          colorField("Buttons background", item.colors.buttonBackground || "#D9582B", function(v){ item.colors.buttonBackground=v; }),
          colorField("Buttons text", item.colors.buttonText || "#FFFFFF", function(v){ item.colors.buttonText=v; }),
          text("Details button destination (blank = built-in trip details)", item.buttonLinks.details || "", function(v){ item.buttonLinks.details=v; }, {placeholder:"#/contact, /booking, https://…"}),
          text("Book button destination (blank = built-in booking form)", item.buttonLinks.book || "", function(v){ item.buttonLinks.book=v; }, {placeholder:"#/contact, /booking, https://…"})
        ]));

        // PER-ITEM PAYMENT RULES CONFIGURATION (Requirements 1 & 2)
        var pay = item.payment || (item.payment = {
          cashEnabled: true,
          upiEnabled: true,
          upiId: "7387778296@upi",
          qrImage: "",
          paymentLink: "",
          instructions: "",
          amount: ""
        });

        var payConfigCard = el("div", { class: "card", style: { background: "#152219", border: "1px solid #253e2d", margin: "14px 0" } }, [
          el("strong", { style: { display: "block", marginBottom: "6px", color: "#6cc28f", fontSize: "14px" } }, [
            "💳 Payment Rules for " + (item.name || "This Adventure")
          ]),
          el("p", { class: "tip", style: { marginBottom: "12px" } }, [
            "Configure Cash and UPI payments independently for this specific bookable item. When Cash is OFF, customers cannot choose Cash. When UPI is ON, your custom QR or payment link will be displayed during booking."
          ]),
          el("div", { style: { display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "14px" } }, [
            el("label", { class: "inline", style: { background: "#0e1811", padding: "8px 14px", borderRadius: "8px", border: "1px solid #243c2a" } }, [
              el("input", { type: "checkbox", checked: pay.cashEnabled !== false, onchange: function(e){ pay.cashEnabled = e.target.checked; markDirty(); } }),
              el("span", { style: { fontWeight: "700", marginLeft: "4px" } }, ["Enable Cash Payment (Pay on trip day)"])
            ]),
            el("label", { class: "inline", style: { background: "#0e1811", padding: "8px 14px", borderRadius: "8px", border: "1px solid #243c2a" } }, [
              el("input", { type: "checkbox", checked: pay.upiEnabled !== false, onchange: function(e){ pay.upiEnabled = e.target.checked; markDirty(); } }),
              el("span", { style: { fontWeight: "700", marginLeft: "4px" } }, ["Enable UPI Payment (QR / Link)"])
            ])
          ]),
          el("div", { class: "grid2" }, [
            text("UPI ID (e.g. 7387778296@upi)", pay.upiId || "7387778296@upi", function(v){ pay.upiId = v; }),
            text("Applicable Amount / Advance (₹) (Leave blank to use full trip cost)", pay.amount || "", function(v){ pay.amount = v; })
          ]),
          text("UPI Payment Link (e.g. upi://pay?pa=... or payment link)", pay.paymentLink || "", function(v){ pay.paymentLink = v; }),
          imageField("UPI QR Code Image (Upload QR or paste image URL)", pay.qrImage || "", function(v){ pay.qrImage = v; }),
          text("Payment Instructions for Customer", pay.instructions || "", function(v){ pay.instructions = v; }, { textarea: true, placeholder: "e.g. Scan QR code to transfer advance. Share UTR/Txn number below. Our team verifies on WhatsApp." })
        ]);
        itContent.appendChild(payConfigCard);

        // Section Visibility Toggles (MD Section 5 & 31)
        var vis = item.visibility || (item.visibility = {});
        var visBox = el("div", { class: "card", style: { background: "#162018", margin: "14px 0" } }, [
          el("strong", { style: { display: "block", marginBottom: "8px", color: "#6cc28f" } }, ["Per-Trip Section Visibility (No empty blocks rendered)"]),
          el("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "8px" } }, [
            el("label", {}, [el("input", { type: "checkbox", checked: vis.description !== false, onchange: function(e){ vis.description = e.target.checked; markDirty(); } }), " Description"]),
            el("label", {}, [el("input", { type: "checkbox", checked: vis.highlights !== false, onchange: function(e){ vis.highlights = e.target.checked; markDirty(); } }), " Highlights"]),
            el("label", {}, [el("input", { type: "checkbox", checked: vis.itinerary !== false, onchange: function(e){ vis.itinerary = e.target.checked; markDirty(); } }), " Itinerary"]),
            el("label", {}, [el("input", { type: "checkbox", checked: vis.inclusions !== false, onchange: function(e){ vis.inclusions = e.target.checked; markDirty(); } }), " Inclusions"]),
            el("label", {}, [el("input", { type: "checkbox", checked: vis.exclusions !== false, onchange: function(e){ vis.exclusions = e.target.checked; markDirty(); } }), " Exclusions"]),
            el("label", {}, [el("input", { type: "checkbox", checked: vis.thingsToCarry !== false, onchange: function(e){ vis.thingsToCarry = e.target.checked; markDirty(); } }), " Carry List"]),
            el("label", {}, [el("input", { type: "checkbox", checked: vis.faq !== false, onchange: function(e){ vis.faq = e.target.checked; markDirty(); } }), " FAQs"]),
            el("label", {}, [el("input", { type: "checkbox", checked: vis.gallery !== false, onchange: function(e){ vis.gallery = e.target.checked; markDirty(); } }), " Gallery"]),
            el("label", {}, [el("input", { type: "checkbox", checked: vis.payment !== false, onchange: function(e){ vis.payment = e.target.checked; markDirty(); } }), " Payment"]),
            el("label", {}, [el("input", { type: "checkbox", checked: vis.booking !== false, onchange: function(e){ vis.booking = e.target.checked; markDirty(); } }), " Booking"])
          ])
        ]);
        itContent.appendChild(visBox);

        // Highlights
        var hlStr = (item.highlights || []).join("\n");
        itContent.appendChild(text("Highlights (one per line)", hlStr, function (v) {
          item.highlights = v.split("\n").map(function(s){ return s.trim(); }).filter(Boolean);
        }, { textarea: true }));

        // Inclusions & Exclusions
        itContent.appendChild(el("div", { class: "grid2" }, [
          text("Inclusions (one per line)", (item.inclusions || []).join("\n"), function (v) {
            item.inclusions = v.split("\n").map(function(s){ return s.trim(); }).filter(Boolean);
          }, { textarea: true }),
          text("Exclusions (one per line)", (item.exclusions || []).join("\n"), function (v) {
            item.exclusions = v.split("\n").map(function(s){ return s.trim(); }).filter(Boolean);
          }, { textarea: true })
        ]));

        // Things to carry
        itContent.appendChild(text("Things to Carry (one per line)", (item.thingsToCarry || []).join("\n"), function (v) {
          item.thingsToCarry = v.split("\n").map(function(s){ return s.trim(); }).filter(Boolean);
        }, { textarea: true }));

        itBlock.appendChild(itContent);
        itemsWrap.appendChild(itBlock);
      });

      itemsWrap.appendChild(el("button", { class: "btn btn-ghost mini", onclick: function () {
        sec.items.push(window.WO_normalizeItem ? window.WO_normalizeItem({ name: "New Adventure", cost: "1,499", days: "1 day" }) : { name: "New Adventure" });
        markDirty(); showPanel("sections");
      } }, ["+ Add adventure to " + (sec.title || sec.key)]));

      block.appendChild(itemsWrap);
      p.appendChild(block);
    });

    p.appendChild(el("button", { class: "btn btn-primary", onclick: function () {
      var key = "sec_" + Date.now().toString(36);
      state.extraSections.push({
        key: key, id: key, kicker: "New Category", title: "New Category",
        intro: "", bg: "", gallery: [], items: []
      });
      markDirty(); showPanel("sections");
    } }, ["+ Add new category"]));
  }

  /* ============================================================
     Panel: Reviews & Google Reviews (Requirement 3 & MD Section 35)
     ============================================================ */
  function renderReviews(p) {
    p.appendChild(el("p", { class: "tip" }, [
      "Manage Google Reviews integration and verified customer testimonials. Google Reviews can be linked directly or integrated via Google Places API."
    ]));

    var g = state.googleReviews || (state.googleReviews = {
      enabled: false, method: "places", placeId: "", limit: 5, showManual: true,
      rating: "", attribution: "Google", reviewUrl: "", displayMode: "latest"
    });

    // Google Reviews Configuration Card
    p.appendChild(card("Google Business Reviews Integration", [
      el("div", { style: { marginBottom: "14px" } }, [
        el("label", { class: "inline" }, [
          el("input", { type: "checkbox", checked: !!g.enabled, onchange: function(e){ g.enabled = e.target.checked; markDirty(); } }),
          el("strong", {}, ["Enable Google Reviews section on public website"])
        ])
      ]),
      selectField("Review source", g.method || "places", [
        { value: "places", label: "Live Google reviews (via secure server proxy)" },
        { value: "manual", label: "Link only (visitors review on Google Maps)" }
      ], function(v){ g.method = v; }),
      text("Google Place ID (e.g. ChIJ...)", g.placeId, function(v){ g.placeId = v; }),
      el("p", { class: "tip" }, [
        "Find your Place ID via the official Google Place ID Finder: ",
        el("a", { href: "https://developers.google.com/maps/documentation/places/web-service/place-id", target: "_blank", rel: "noopener" }, ["Google Place ID Tool ↗"])
      ]),
      text("Number of reviews to show (1–10)", String(g.limit || 5), function(v){ g.limit = parseInt(v, 10) || 5; }, { type: "number" }),
      el("label", { class: "inline" }, [
        el("input", { type: "checkbox", checked: g.showManual !== false, onchange: function(e){ g.showManual = e.target.checked; markDirty(); } }),
        el("strong", {}, ["Also show curated customer testimonials"])
      ]),
      text("Optional rating badge (leave blank to hide the number)", g.rating || "", function(v){ g.rating = v; }, { placeholder: "e.g. 4.9" }),
      text("Direct Google Review Link (for 'Review Us on Google' button)", g.reviewUrl, function(v){ g.reviewUrl = v; }, { placeholder: "https://search.google.com/local/writereview?placeid=..." }),
      el("div", { class: "cfgwarn", style: { marginTop: "14px", background: "#16251b", borderColor: "#284431", color: "#b9e2c6" } }, [
        "🔐 Security: The Google Places API key is NEVER stored in the browser. It lives in the server environment variable GOOGLE_PLACES_API_KEY (see .env.example). The public site calls the server proxy at /api/google-reviews, which keeps the key secret and caches results. ",
        el("br", {}),
        "We do not fake reviews. Live reviews come directly from Google; curated testimonials are clearly labelled."
      ])
    ]));

    // Customer Testimonials Repeater
    p.appendChild(card("Customer Testimonials", [
      makeRepeater(state.reviews || (state.reviews = []), function (rv, i, cb) {
        return el("div", { class: "section-block", style: { marginBottom: "10px" } }, [
          el("div", { class: "inline", style: { justifyContent: "space-between" } }, [
            el("strong", {}, [rv.name || "Traveller"]),
            el("div", { class: "inline" }, [
              el("button", { class: "btn btn-ghost mini", onclick: cb.up }, ["↑"]),
              el("button", { class: "btn btn-ghost mini", onclick: cb.down }, ["↓"]),
              el("button", { class: "btn btn-danger mini", onclick: cb.remove }, ["✕"])
            ])
          ]),
          text("Name", rv.name || "", function (v) { rv.name = v; }),
          text("Role / Adventure Name", rv.role || "", function (v) { rv.role = v; }),
          text("Review", rv.text || "", function (v) { rv.text = v; }, { textarea: true }),
          imageField("Photo (optional)", rv.photo || "", function (v) { rv.photo = v; })
        ]);
      }, function () { return { id: window.WO_newId("rv"), name: "New Explorer", role: "Trekker", text: "", photo: "" }; })
    ]));
  }

  /* ============================================================
     Panel: Blog Articles (MD Section 34)
     ============================================================ */
  function renderBlog(p) {
    p.appendChild(el("p", { class: "tip" }, [
      "Create and edit trail guides, trekking advice and stories. Articles publish to the /blog and /blog/:slug routes."
    ]));

    var blogs = state.blogs || (state.blogs = deepClone(window.WO_DEFAULTS.blogs || []));

    p.appendChild(card("Blog Articles", [
      makeRepeater(blogs, function (b, i, cb) {
        return el("details", { class: "section-block", style: { marginBottom: "12px", background: "#121b14" } }, [
          el("summary", { style: { cursor: "pointer", fontWeight: "700", display: "flex", alignItems: "center", gap: "10px" } }, [
            el("span", { style: { flex: 1 } }, [(b.title || "Untitled") + " (" + (b.category || "Guide") + ")"]),
            el("span", { class: "tip" }, [b.published !== false ? "Published" : "Draft"]),
            el("button", { class: "btn btn-danger mini", onclick: cb.remove }, ["✕"])
          ]),
          el("div", { style: { paddingTop: "12px" } }, [
            text("Article Title", b.title, function(v){ b.title = v; }),
            text("Slug (URL path, e.g. monsoon-trek-guide)", b.slug, function(v){ b.slug = v; }),
            text("Category", b.category, function(v){ b.category = v; }),
            imageField("Cover Image", b.coverImage, function(v){ b.coverImage = v; }),
            text("Excerpt", b.excerpt, function(v){ b.excerpt = v; }, { textarea: true }),
            text("Content (Markdown supported)", b.content, function(v){ b.content = v; }, { textarea: true, rows: 8 }),
            el("label", { class: "inline", style: { marginTop: "10px" } }, [
              el("input", { type: "checkbox", checked: b.published !== false, onchange: function(e){ b.published = e.target.checked; markDirty(); } }),
              " Published (visible on website)"
            ])
          ])
        ]);
      }, function () {
        return {
          id: window.WO_newId("b"),
          title: "New Trail Guide",
          slug: "guide-" + Date.now().toString(36),
          excerpt: "",
          content: "",
          category: "Trek Guide",
          date: new Date().toISOString().slice(0, 10),
          published: true
        };
      })
    ]));
  }

  /* ============================================================
     Panel: FAQs (MD Section 37)
     ============================================================ */
  function renderFaq(p) {
    p.appendChild(el("p", { class: "tip" }, ["Manage questions and answers displayed in the public FAQ view."]));

    var faqs = state.faqs || (state.faqs = deepClone(window.WO_DEFAULTS.faqs || []));

    p.appendChild(card("Frequently Asked Questions", [
      makeRepeater(faqs, function (f, i, cb) {
        return el("div", { class: "section-block", style: { marginBottom: "10px" } }, [
          el("div", { class: "inline", style: { justifyContent: "space-between" } }, [
            el("strong", {}, [f.category || "General"]),
            el("button", { class: "btn btn-danger mini", onclick: cb.remove }, ["✕"])
          ]),
          text("Category", f.category, function(v){ f.category = v; }),
          text("Question", f.q, function(v){ f.q = v; }),
          text("Answer", f.a, function(v){ f.a = v; }, { textarea: true })
        ]);
      }, function () { return { id: window.WO_newId("faq"), category: "General", q: "New Question?", a: "" }; })
    ]));
  }

  /* ============================================================
     Panel: Highlights & Gallery
     ============================================================ */
  function renderHighlights(p) {
    var h = state.highlights;
    p.appendChild(card("Highlights header", [
      text("Eyebrow", h.kicker, function (v) { h.kicker = v; }),
      text("Title", h.title, function (v) { h.title = v; }),
      text("Subtitle", h.subtitle, function (v) { h.subtitle = v; }, { textarea: true })
    ]));
    p.appendChild(card("Gallery / video items", [
      makeRepeater(h.items || (h.items = []), function (it, i, cb) {
        return el("div", { class: "section-block", style: { marginBottom: "10px" } }, [
          el("div", { class: "inline" }, [
            selectField("Type", it.type || "photo", [
              { value: "photo", label: "Photo" },
              { value: "video", label: "Video (mp4)" },
              { value: "yt",    label: "YouTube" },
              { value: "ig",    label: "Instagram Post / Reel" }
            ], function (v) { it.type = v; cb.rerender(); }),
            el("button", { class: "btn btn-ghost mini", onclick: cb.up }, ["↑"]),
            el("button", { class: "btn btn-ghost mini", onclick: cb.down }, ["↓"]),
            el("button", { class: "btn btn-danger mini", onclick: cb.remove }, ["✕"])
          ]),
          imageField("Image / video URL", it.src || "", function (v) { it.src = v; }),
          text("Caption", it.caption || "", function (v) { it.caption = v; }),
          (it.type === "yt") ? text("YouTube video ID", it.videoId || "", function (v) { it.videoId = v; }) : null,
          (it.type === "ig") ? text("Instagram Shortcode (e.g. Cxxxxxx)", it.code || "", function (v) { it.code = v; }) : null
        ].filter(Boolean));
      }, function () { return { id: window.WO_newId("hl"), type: "photo", src: "", caption: "" }; })
    ]));
  }

  /* ============================================================
     Panel: Contact & Booking
     ============================================================ */
  function renderContact(p) {
    var c = state.contact, bk = state.booking, f = state.footer;
    p.appendChild(card("Contact Details", [
      text("Eyebrow", c.kicker, function (v) { c.kicker = v; }),
      text("Title", c.title, function (v) { c.title = v; }),
      text("Intro", c.intro, function (v) { c.intro = v; }, { textarea: true }),
      text("Phone / WhatsApp", c.phone, function (v) { c.phone = v; }),
      text("Email", c.email, function (v) { c.email = v; }),
      text("Instagram handle", c.instagram, function (v) { c.instagram = v; }),
      text("Instagram URL", c.instagramUrl, function (v) { c.instagramUrl = v; }),
      text("City", c.city, function (v) { c.city = v; }),
      text("WhatsApp number (digits only, e.g. 917387778296)", c.whatsapp, function (v) { c.whatsapp = v; })
    ]));
    p.appendChild(card("Booking Section Text", [
      text("Eyebrow", bk.kicker, function (v) { bk.kicker = v; }),
      text("Title", bk.title, function (v) { bk.title = v; }),
      text("Intro", bk.intro, function (v) { bk.intro = v; }, { textarea: true })
    ]));
    p.appendChild(card("Default Payment Settings & UPI QR Code", [
      el("p", { class: "tip" }, [
        "Configure the global default UPI ID, QR code, and payment instructions. These apply to all adventures unless specifically overridden inside a trip in 'Sections & Treks'."
      ]),
      el("div", { class: "grid2" }, [
        text("Default UPI ID", bk.upiId || "7387778296@upi", function (v) { bk.upiId = v; }),
        text("Default UPI Payment Link (optional)", bk.paymentLink || "", function (v) { bk.paymentLink = v; })
      ]),
      imageField("Default UPI QR Code Image (Upload QR or paste image URL)", bk.qrImage || "", function (v) { bk.qrImage = v; }),
      text("Default Payment Instructions", bk.instructions || "", function (v) { bk.instructions = v; }, { textarea: true, placeholder: "e.g. Scan QR code to transfer advance. Share UTR/Txn number below. Our team verifies on WhatsApp." })
    ]));
    p.appendChild(card("Footer", [
      numberField("Copyright year", f.copyYear, function (v) { f.copyYear = +v; }),
      text("Footer tagline", f.tagline || "", function(v){ f.tagline=v; })
    ]));
  }

  /* ============================================================
     Panel: Booking Inbox (Requirements 2, 3, 4)
     ============================================================ */
  async function renderBookings(p) {
    p.appendChild(el("p", { class: "tip" }, [
      "All bookings submitted through the public booking system and saved in Supabase. You can verify UPI/cash payments, update booking status, and view/print customer receipts."
    ]));

    var wrap = el("div", { class: "card" }, [el("p", { class: "tip" }, ["Loading bookings…"])]);
    p.appendChild(wrap);

    if (localMode || !window.Backend.configured()) {
      wrap.innerHTML = "";
      wrap.appendChild(el("p", { class: "tip" }, ["Connect Supabase to inspect and manage database bookings."]));
      return;
    }

    var rows = await window.Backend.loadBookings();
    wrap.innerHTML = "";
    if (!rows.length) {
      wrap.appendChild(el("p", { class: "tip" }, ["No booking records in database yet."]));
      return;
    }

    var head = el("tr", {}, [
      "Ref / ID", "Received", "Customer Details",
      "Adventure", "Date / People", "Payment Method & Info",
      "Payment Status", "Booking Status", "Actions"
    ].map(function (h) { return el("th", {}, [h]); }));

    var body = rows.map(function (r) {
      var payStatus = r.payment_status || "pending";
      var bookStatus = String(r.status || "new").toLowerCase();
      var specialReq = String(r.special_req || "");
      var txnMatch = specialReq.match(/Transaction reference:\s*([^|]+)/i);
      var txnRefVal = txnMatch ? txnMatch[1].trim() : "";

      // Quick visual badge
      var statusColor = "#f59e0b"; // yellow/pending
      if (payStatus === "Paid") statusColor = "#10b981"; // green
      else if (payStatus === "Failed") statusColor = "#ef4444"; // red

      var paySelect = el("select", { style: { padding: "4px 8px", fontSize: "12px", borderRadius: "6px" } }, [
        { val: "Pending", lbl: "Payment Pending" },
        { val: "Verification Required", lbl: "Verification Required" },
        { val: "Paid", lbl: "Paid (Verified)" },
        { val: "Failed", lbl: "Payment Failed" },
        { val: "Refunded", lbl: "Refunded" }
      ].map(function(opt){
        var o = el("option", { value: opt.val }, [opt.lbl]);
        if (payStatus.toLowerCase().includes(opt.val.toLowerCase())) o.selected = true;
        return o;
      }));

      var bookSelect = el("select", { style: { padding: "4px 8px", fontSize: "12px", borderRadius: "6px" } }, [
        { val: "new", lbl: "New" },
        { val: "contacted", lbl: "Contacted" },
        { val: "confirmed", lbl: "Confirmed" },
        { val: "cancelled", lbl: "Cancelled" }
      ].map(function(opt){
        var o = el("option", { value: opt.val }, [opt.lbl]);
        if (bookStatus === opt.val) o.selected = true;
        return o;
      }));

      var txnInput = el("input", {
        type: "text",
        placeholder: "Txn / UTR Ref",
        value: txnRefVal,
        style: { width: "110px", padding: "4px 6px", fontSize: "12px", marginTop: "4px" }
      });

      var saveBtn = el("button", { class: "btn btn-primary mini", style: { padding: "4px 10px", marginTop: "4px" }, onclick: async function() {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        var updates = {
          payment_status: paySelect.value,
          status: bookSelect.value,
          txn_ref: txnInput.value.trim()
        };
        var res = await window.Backend.updateBooking(r.ref || r.id, updates);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Status";
        if (res && res.ok) {
          toast("Booking " + (r.ref || r.id) + " updated successfully ✓");
          showPanel("bookings");
        } else {
          toast("Update failed: " + ((res && res.error) || "unknown"), false);
        }
      } }, ["Save Status"]);

      var receiptTokenForRow = r.receipt_token || ((String(r.special_req || "").match(/ReceiptToken:\s*([^\s|]+)/i) || [])[1]) || "";
      var viewReceiptBtn = el("button", { class: "btn btn-ghost mini", style: { padding: "4px 8px", marginTop: "4px" }, onclick: function() {
        // Prefer the secure receipt token. Legacy rows without one can still be
        // opened by reference for an authenticated editor, but new bookings use tokens.
        var tokenOrRef = receiptTokenForRow || r.ref || r.id;
        var receiptUrl = "../#/receipt/" + encodeURIComponent(tokenOrRef);
        window.open(receiptUrl, "_blank", "noopener");
      } }, ["View Receipt ↗"]);

      // ---- Mark Payment as Received + WhatsApp confirmation (Requirement 5) ----
      // Extract amount: try the amount column first, then parse from notes metadata.
      var amountVal = "";
      var metadataText = String(r.special_req || "");
      if(!amountVal && metadataText){
        var amtMatch = metadataText.match(/Amount:\s*([^\s|]+)/i);
        if(amtMatch) amountVal = amtMatch[1];
      }
      // If still no amount, try the trip cost from state.
      if(!amountVal){
        var tripItem = null;
        var allSecs = [].concat(state.sections || [], state.extraSections || []);
        for(var si = 0; si < allSecs.length; si++){
          for(var ii = 0; ii < (allSecs[si].items || []).length; ii++){
            if(allSecs[si].items[ii].name === (r.trip_title || r.package)){ tripItem = allSecs[si].items[ii]; break; }
          }
          if(tripItem) break;
        }
        if(tripItem && tripItem.cost) amountVal = tripItem.cost;
      }

      var isPaid = (payStatus === "Paid" || payStatus.toLowerCase().includes("paid"));
      var customerPhone = String(r.phone || "").replace(/\D/g, "");
      // Normalize Indian numbers to international format (91 prefix).
      if(customerPhone.length === 10) customerPhone = "91" + customerPhone;
      else if(customerPhone.length === 12 && customerPhone.startsWith("91")) { /* already correct */ }
      else if(customerPhone.length === 11 && customerPhone.startsWith("0")) customerPhone = "91" + customerPhone.slice(1);

      var markPaidBtn = el("button", {
        class: "btn " + (isPaid ? "btn-ghost" : "btn-primary") + " mini",
        style: { padding: "4px 10px", marginTop: "4px", fontSize: "12px" },
        disabled: isPaid,
        onclick: async function() {
          markPaidBtn.disabled = true;
          markPaidBtn.textContent = "Verifying…";
          // Update payment_status to "Paid" in the database.
          var res = await window.Backend.updateBooking(r.ref || r.id, {
            payment_status: "Paid",
            status: "confirmed"
          });
          if (res && res.ok) {
            toast("Payment marked as received & verified ✓");
            markPaidBtn.textContent = "✓ Payment Verified";
            markPaidBtn.classList.remove("btn-primary");
            markPaidBtn.classList.add("btn-ghost");
            // Show the WhatsApp notify button.
            notifyWaBtn.style.display = "block";
            // Update local row state for the select.
            paySelect.value = "Paid";
            bookSelect.value = "Confirmed";
          } else {
            markPaidBtn.disabled = false;
            markPaidBtn.textContent = "✓ Mark Payment as Received";
            toast("Database update failed — payment NOT confirmed: " + ((res && res.error) || "unknown"), false);
          }
        }
      }, [isPaid ? "✓ Payment Verified" : "✓ Mark Payment as Received"]);

      // WhatsApp "Notify Customer" button — opens WhatsApp with prefilled message.
      var notifyWaBtn = el("button", {
        class: "btn btn-success mini",
        style: { padding: "4px 10px", marginTop: "4px", fontSize: "12px", display: isPaid ? "block" : "none", background: "#25D366", color: "#fff", border: "none" },
        onclick: function() {
          if(!customerPhone){
            toast("No customer phone number on file — cannot open WhatsApp.", false);
            return;
          }
          var ref = r.ref || r.id || "";
          var name = r.name || "Customer";
          var adventure = r.trip_title || r.package || r.trip_kind || r.type || "Adventure";
          var date = r.travel_date || r.date || "TBD";
          var amount = amountVal ? "₹" + amountVal : "the agreed amount";
          var token = receiptTokenForRow || "";
          var receiptLink = "";
          if(token){
            var baseOrigin = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
              ? ((state && state.seo && state.seo.canonicalUrl) ? state.seo.canonicalUrl.replace(/\/$/, "") : "https://www.wandereroutdoors.in")
              : location.origin.replace(/\/admin\/?$/, "");
            receiptLink = "\n\nView your updated receipt: " + baseOrigin + "/#/receipt/" + encodeURIComponent(token);
          }
          var msg = "Hi " + name + "! 😊\n\n" +
            "Your payment of " + amount + " for " + adventure + " has been received and verified by The Wanderer Outdoors.\n\n" +
            "Booking Reference: " + ref + "\n" +
            "Travel Date: " + date + "\n" +
            "Payment Status: Paid / Payment Verified\n" +
            receiptLink + "\n\n" +
            "Thank you for choosing The Wanderer Outdoors! 🌿 Live. Travel. Explore.";

          var waUrl = "https://wa.me/" + customerPhone + "?text=" + encodeURIComponent(msg);
          window.open(waUrl, "_blank");
          toast("WhatsApp opened — press Send in the chat to notify the customer.");
        }
      }, ["💬 Notify Customer on WhatsApp"]);

      return el("tr", {}, [
        el("td", {}, [
          el("strong", { style: { color: "#d9582b", display: "block" } }, [r.ref || r.id || "—"]),
          el("span", { style: { fontSize: "11px", color: statusColor, fontWeight: "700" } }, [payStatus.toUpperCase()])
        ]),
        el("td", { style: { fontSize: "12px", color: "#9fb0a3" } }, [r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : (r.received_at ? new Date(r.received_at).toLocaleDateString("en-IN") : "—")]),
        el("td", {}, [
          el("div", { style: { fontWeight: "700" } }, [r.name || "Anonymous"]),
          el("div", { style: { fontSize: "12px", color: "#6cc28f" } }, [r.phone ? el("a", { href: "tel:" + r.phone }, [r.phone]) : ""]),
          el("div", { style: { fontSize: "12px", color: "#9fb0a3" } }, [r.email || ""])
        ]),
        el("td", {}, [el("strong", {}, [r.trip_title || r.package || r.trip_kind || r.type || "—"])]),
        el("td", {}, [
          el("div", {}, [r.travel_date || r.date || "TBD"]),
          el("div", { style: { fontSize: "12px", color: "#9fb0a3" } }, [String(r.people || "1") + " pax"])
        ]),
        el("td", {}, [
          el("div", {}, [specialReq.match(/Payment:\s*([^|]+)/i) ? specialReq.match(/Payment:\s*([^|]+)/i)[1].trim() : "Payment details in notes"]),
          txnInput,
          el("div", { style: { fontSize: "11px", color: "#9fb0a3", maxWidth: "240px", whiteSpace: "normal" } }, [specialReq || ""])
        ]),
        el("td", {}, [paySelect]),
        el("td", {}, [bookSelect]),
        el("td", {}, [
          el("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } }, [
            saveBtn,
            markPaidBtn,
            notifyWaBtn,
            viewReceiptBtn
          ])
        ])
      ]);
    });

    wrap.appendChild(el("div", { class: "tablewrap" }, [
      el("table", { class: "tbl" }, [el("thead", {}, [head]), el("tbody", {}, body)])
    ]));
  }

  /* ============================================================
     Panel: Enquiries Inbox (Requirement 4)
     ============================================================ */
  async function renderEnquiries(p) {
    p.appendChild(el("p", { class: "tip" }, [
      "General contact inquiries submitted via the website contact form."
    ]));

    var wrap = el("div", { class: "card" }, [el("p", { class: "tip" }, ["Loading general enquiries…"])]);
    p.appendChild(wrap);

    if (localMode || !window.Backend.configured()) {
      wrap.innerHTML = "";
      wrap.appendChild(el("p", { class: "tip" }, ["Connect Supabase to inspect enquiries."]));
      return;
    }

    var result = await window.Backend.loadEnquiries();
    wrap.innerHTML = "";
    if (!result || result.ok !== true) {
      wrap.appendChild(el("p", { class: "tip" }, ["Could not load enquiries: " + ((result && result.error) || "Unknown database error") + ". Check the enquiries migration and Supabase policies."]));
      return;
    }
    var rows = result.data || [];
    if (!rows.length) {
      wrap.appendChild(el("p", { class: "tip" }, ["No general contact enquiries recorded yet."]));
      return;
    }

    var head = el("tr", {}, [
      "Received", "Name", "Phone & Email", "Trip Details / Message"
    ].map(function (h) { return el("th", {}, [h]); }));

    var body = rows.map(function (r) {
      return el("tr", {}, [
        el("td", { style: { fontSize: "12px", color: "#9fb0a3" } }, [r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : "—"]),
        el("td", { style: { fontWeight: "700" } }, [r.name || "Anonymous"]),
        el("td", {}, [
          el("div", {}, [r.phone ? el("a", { href: "tel:" + r.phone, style: { color: "#6cc28f" } }, [r.phone]) : "—"]),
          el("div", { style: { fontSize: "12px", color: "#9fb0a3" } }, [r.email || ""])
        ]),
        el("td", {}, [
          r.travel_type ? el("div", { style: { fontWeight: "600", color: "#d9582b" } }, [r.travel_type]) : null,
          r.destination ? el("div", { style: { fontSize: "12px" } }, ["Destination: " + r.destination]) : null,
          r.travel_date ? el("div", { style: { fontSize: "12px" } }, ["Travel date: " + r.travel_date]) : null,
          r.people ? el("div", { style: { fontSize: "12px" } }, ["People: " + r.people]) : null,
          r.budget ? el("div", { style: { fontSize: "12px" } }, ["Budget: " + r.budget]) : null,
          r.requirements ? el("div", { style: { fontSize: "12px" } }, ["Requirements: " + r.requirements]) : null,
          el("div", { style: { fontSize: "13px", whiteSpace: "pre-wrap" } }, [r.message || "—"])
        ].filter(Boolean))
      ]);
    });

    wrap.appendChild(el("div", { class: "tablewrap" }, [
      el("table", { class: "tbl" }, [el("thead", {}, [head]), el("tbody", {}, body)])
    ]));
  }

  /* ============================================================
     Panel: Account & Editors
     ============================================================ */
  function renderAccount(p) {
    p.appendChild(card("Your account", [
      el("p", { class: "tip" }, ["Signed in as: " + ($("#who").textContent || "")]),
      el("button", { class: "btn btn-ghost", onclick: changePassword }, ["Change password"]),
      el("button", { class: "btn btn-ghost", onclick: signOut }, ["Sign out"])
    ]));
    p.appendChild(card("Editors", [
      el("p", { class: "tip" }, ["Owners can invite editors by email. They sign in to edit without seeing your password."]),
      el("div", { class: "inline", style: { marginTop: "10px" } }, [
        el("input", { id: "inviteEmail", type: "email", class: "grow", placeholder: "editor@example.com" }, []),
        el("button", { class: "btn btn-primary", onclick: invite }, ["Invite editor"])
      ]),
      el("div", { id: "inviteMsg", class: "login-msg" })
    ]));
    p.appendChild(card("Site lock", [
      el("p", { class: "tip" }, ["Lock the public site behind a viewing code."]),
      el("button", { class: "btn btn-ghost", onclick: toggleLock }, ["Lock / unlock site"])
    ]));
  }

  async function changePassword() {
    var np = prompt("New password (at least 6 characters):");
    if (!np || np.length < 6) { if (np !== null) toast("Password too short.", false); return; }
    var r = await window.Backend.changePassword(np);
    toast(r && r.ok ? "Password updated." : "Could not update password.", !(r && r.ok));
  }
  async function invite() {
    var email = $("#inviteEmail").value.trim();
    var msg = $("#inviteMsg");
    if (!email) { msg.textContent = "Enter an email."; return; }
    var r = await window.Backend.inviteEditor(email);
    msg.textContent = (r && r.ok) ? ("Invited " + r.email) : ("Failed: " + ((r && r.error) || "unknown"));
    msg.style.color = (r && r.ok) ? "#22c55e" : "#f87171";
  }
  async function toggleLock() {
    var cur = await window.Backend.getViewLock();
    var code;
    if (cur) { if (!confirm("Unlock site for public visitors?")) return; code = ""; }
    else { code = prompt("Set viewing code:", "preview2026"); if (code === null) return; }
    var r = await window.Backend.setViewLock(code);
    toast(r && r.ok ? (code ? "Site locked." : "Site unlocked.") : "Could not change lock.", !(r && r.ok));
  }
  async function signOut() {
    await window.Backend.signOut();
    location.reload();
  }

  /* ---------------- Init Control Room ---------------- */
  async function init() {
    // 1. Wire topbar & sidebar buttons
    var saveBtn = $("#saveBtn"); if (saveBtn) saveBtn.addEventListener("click", save);
    var signOutBtn = $("#signOutBtn"); if (signOutBtn) signOutBtn.addEventListener("click", signOut);

    Array.from(document.querySelectorAll(".sidebar .nav[data-panel]")).forEach(function (btn) {
      btn.addEventListener("click", function () { showPanel(btn.getAttribute("data-panel")); });
    });

    // 2. Wire Sign In & Sign Up buttons IMMEDIATELY before ANY async/network call
    var signInBtn = $("#signInBtn");
    var signUpBtn = $("#signUpBtn");
    var emailInput = $("#email");
    var passInput = $("#password");
    var loginMsg = $("#loginMsg");

    function doSignIn() {
      var em = emailInput ? emailInput.value.trim() : "";
      var pw = passInput ? passInput.value : "";
      if (!em || !pw) {
        if (loginMsg) loginMsg.textContent = "Please enter both your email and password.";
        return;
      }
      if (signInBtn) signInBtn.disabled = true;
      if (loginMsg) loginMsg.textContent = "Signing in… please wait.";
      window.Backend.signIn(em, pw).then(function(r) {
        if (signInBtn) signInBtn.disabled = false;
        if (r && r.ok) {
          if (loginMsg) loginMsg.textContent = "Signed in! Opening Control Room…";
          setTimeout(function() { location.reload(); }, 300);
        } else {
          var errMsg = (r && r.error) || "Sign-in failed.";
          if (errMsg.toLowerCase().indexOf("invalid login credentials") !== -1) {
            errMsg = "Incorrect email or password. Please verify and try again.";
          } else if (errMsg.toLowerCase().indexOf("email not confirmed") !== -1) {
            errMsg = "Email is not confirmed yet. Turn off 'Confirm email' in Supabase Providers or confirm your email.";
          }
          if (loginMsg) loginMsg.textContent = errMsg;
        }
      }).catch(function(err) {
        if (signInBtn) signInBtn.disabled = false;
        if (loginMsg) loginMsg.textContent = "Sign-in error: " + (err.message || "Network issue");
      });
    }

    function doSignUp() {
      var em = emailInput ? emailInput.value.trim() : "";
      var pw = passInput ? passInput.value : "";
      if (!em || !pw) {
        if (loginMsg) loginMsg.textContent = "Please enter both email and password to create an account.";
        return;
      }
      if (signUpBtn) signUpBtn.disabled = true;
      if (loginMsg) loginMsg.textContent = "Creating account… please wait.";
      window.Backend.signUp(em, pw).then(function(r) {
        if (signUpBtn) signUpBtn.disabled = false;
        if (r && r.ok) {
          if (loginMsg) loginMsg.textContent = "Account created successfully! Signing you in…";
          doSignIn();
        } else {
          if (loginMsg) loginMsg.textContent = (r && r.error) || "Could not create account.";
        }
      }).catch(function(err) {
        if (signUpBtn) signUpBtn.disabled = false;
        if (loginMsg) loginMsg.textContent = "Create account error: " + (err.message || "Unknown error");
      });
    }

    if (signInBtn) signInBtn.addEventListener("click", doSignIn);
    if (signUpBtn) signUpBtn.addEventListener("click", doSignUp);

    // Support pressing Enter key in email or password input
    if (emailInput) {
      emailInput.addEventListener("keydown", function(e) { if (e.key === "Enter") doSignIn(); });
    }
    if (passInput) {
      passInput.addEventListener("keydown", function(e) { if (e.key === "Enter") doSignIn(); });
    }

    if (!window.Backend || !window.Backend.configured()) {
      localMode = true;
      var warn = $("#cfgWarn");
      if (warn) {
        warn.classList.remove("hidden");
        warn.textContent = "Control Room locked: Supabase is not configured. Connect the existing Supabase project before signing in. Offline editing is disabled for security.";
      }
      $("#signInBtn").disabled = true;
      $("#signUpBtn").disabled = true;
      $("#saveBtn").disabled = true;
      return;
    }

    // Check existing editor session — isEditor() wrapped in try-catch to prevent crash
    // if the profiles table or RLS policy doesn't exist yet.
    var sess = await window.Backend.getSession();
    var editorOk = false;
    if (sess && sess.user) {
      try { editorOk = await window.Backend.isEditor(); } catch(e) {
        console.warn('[Control Room] isEditor() failed:', e && e.message);
      }
    }
    if (sess && sess.user && editorOk) {
      $("#who").textContent = sess.user.email;
      $("#loginView").classList.add("hidden");
      $("#appView").classList.remove("hidden");
      authed = true;
      await loadContentAndBoot();
      return;
    } else if (sess && sess.user && !editorOk) {
      await window.Backend.signOut();
      $("#loginMsg").textContent = "This account is not authorized for the Control Room. Sign in with an approved editor account.";
    }

// (Sign in / Sign up buttons wired at start of init)
  }

  async function loadContentAndBoot() {
    var remote = null;
    var panel = $("#panel");
    if (panel) panel.innerHTML = '<div style="padding:40px;text-align:center;color:#9fb0a3">Loading site content\u2026</div>';
    try {
      if (!localMode && window.Backend.configured()) {
        remote = await window.Backend.loadContent();
      }
    } catch(e) {
      console.warn('[Control Room] loadContent error:', e && e.message);
    }
    if (!remote) {
      try { var raw = localStorage.getItem(LS_KEY); if (raw) remote = JSON.parse(raw); } catch (e) {}
    }
    try {
      state = mergeState(remote || {});
    } catch(e) {
      console.warn('[Control Room] mergeState error:', e && e.message);
      state = mergeState({});
    }
    showPanel("overview");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})();
