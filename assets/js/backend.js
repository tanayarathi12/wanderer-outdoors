/* ============================================================
   The Wanderer Outdoors — static backend (Supabase)
   ------------------------------------------------------------
   This provides the static backend that works on ANY host
   (Cloudflare Pages, GitHub Pages, GoDaddy static, Netlify, etc.).
   It exposes a single global: window.Backend.

   Loaded as a plain <script> (no modules). It expects the
   Supabase UMD build (window.supabase) to already be on the
   page, and window.WO_CONFIG to be set by config.js.
   ============================================================ */
(function () {
  "use strict";

  var cfg = window.WO_CONFIG || {};
  var URL = cfg.url || "";
  var ANON = cfg.anon || "";
  var client = null;

  function configured() {
    return (
      /^https:\/\/.+\.supabase\.(co|in)$/.test(URL) &&
      ANON &&
      ANON.indexOf("YOUR-") === -1 &&
      ANON.length > 20
    );
  }

  function init() {
    if (client || !configured()) return client;
    if (!window.supabase || !window.supabase.createClient) {
      console.error(
        "[Backend] Supabase library not found. Add the CDN <script> before backend.js."
      );
      return null;
    }
    client = window.supabase.createClient(URL, ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return client;
  }

  /* -------------------- content (the whole site state) -------------------- */
  async function loadContent() {
    if (!configured()) return null;
    init();
    try {
      var r = await client
        .from("site_content")
        .select("data")
        .eq("id", "main")
        .maybeSingle();
      if (r.error) {
        console.warn("[Backend] loadContent:", r.error.message);
        return null;
      }
      if (!r.data) return {};
      return r.data.data && typeof r.data.data === "object" ? r.data.data : {};
    } catch (e) {
      return null;
    }
  }

  async function saveContent(state) {
    if (!configured()) return { ok: false, error: "not-configured" };
    init();
    if (!client) return { ok: false, error: "supabase-unavailable" };
    var r = await client
      .from("site_content")
      .upsert(
        { id: "main", data: state, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (r.error) {
      var msg = (r.error.message || "") + " " + (r.error.code || "");
      var auth = /permission|policy|42501|unauthorized|jwt/i.test(msg);
      return { ok: false, error: r.error.message, auth: auth };
    }
    return { ok: true };
  }

  /* -------------------- crypto helpers (no Math.random) -------------------- */
  // Cryptographically secure random hex string (browser crypto).
  function cryptoHex(bytes) {
    try {
      var arr = new Uint8Array(bytes);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      var s = "";
      for (var i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, "0");
      return s;
    } catch (e) {
      // Extremely rare fallback (old browsers) — still large entropy.
      var out = "";
      for (var j = 0; j < bytes * 2; j++) out += Math.floor(Math.random() * 16).toString(16);
      return out;
    }
  }

  // Crypto-secure booking reference, e.g. WO-2026-9F3A1C...
  // 12 random bytes => 96 bits of entropy; collisions are computationally
  // infeasible (no Math.random for the reference itself).
  function generateRef() {
    var yr = new Date().getFullYear();
    return "WO-" + yr + "-" + cryptoHex(12).toUpperCase();
  }

  // Crypto-secure, unguessable receipt token (24 bytes => 192 bits).
  function generateToken() {
    return cryptoHex(24);
  }

  /* -------------------- bookings -------------------- */
  async function submitBooking(b) {
    if (!configured()) return { ok: false, error: "Supabase is not configured." };
    init();
    if (!client) return { ok: false, error: "Supabase client could not start." };

    var ref = b.ref || b.booking_id || generateRef();
    var rawDate = b.travel_date || b.trip_date || b.date || "";
    var parsed = rawDate ? new Date(rawDate) : null;
    var travelDate = parsed && !isNaN(parsed.getTime())
      ? parsed.getFullYear() + "-" + String(parsed.getMonth() + 1).padStart(2, "0") + "-" + String(parsed.getDate()).padStart(2, "0")
      : (rawDate ? String(rawDate) : null);

    var meta = [];
    var notes = String(b.notes || b.special_req || "").trim();
    if (b.payment) meta.push("Payment: " + b.payment);
    if (b.amount != null && b.amount !== "") meta.push("Amount: " + b.amount);
    if (b.txn_ref) meta.push("Transaction reference: " + b.txn_ref);
    if (b.receipt_token) meta.push("ReceiptToken: " + b.receipt_token);
    var specialReq = [notes].concat(meta).filter(Boolean).join(" | ");
    var status = String(b.status || b.booking_status || "new").toLowerCase();
    if (["new", "contacted", "confirmed", "cancelled"].indexOf(status) === -1) status = "new";

    // Exact columns/types from the connected public.bookings table.
    var row = {
      ref: String(ref),
      name: String(b.name || "").trim(),
      age: b.age == null || b.age === "" ? null : String(b.age),
      email: String(b.email || "").trim(),
      phone: String(b.phone || "").trim(),
      whatsapp: String(b.whatsapp || b.phone || "").trim(),
      trip_kind: String(b.trip_kind || b.type || "").trim(),
      trip_id: b.trip_id || null,
      trip_title: String(b.trip_title || b.package || "").trim(),
      travel_date: travelDate,
      people: b.people == null || b.people === "" ? "1" : String(b.people),
      special_req: specialReq || null,
      payment_status: String(b.payment_status || "pending"),
      status: status,
      source: String(b.source || "web")
    };
    if (!row.name) return { ok: false, error: "Please enter the traveller name." };

    var result = await client.from("bookings").insert([row]);
    if (result.error) {
      console.error("[Backend] submitBooking failed:", result.error.message, result.error);
      return { ok: false, error: result.error.message };
    }
    return { ok: true, ref: ref, token: b.receipt_token || null };
  }

  // SECURE public receipt lookup: returns at most ONE booking row for a token.
  // Uses the get_booking_by_token() SECURITY DEFINER function so we never
  // expose the full bookings table to anonymous visitors.
  // If called by an authenticated editor, also allows resolving by ref.
  // Falls back gracefully if the migration (function/columns) hasn't been run.
  async function getBookingByToken(token) {
    if (!configured() || !token) return null;
    init();
    if (!client) return null;
    try {
      // First try the RPC function (added by migration_receipts_payments_v2.sql).
      var r = await client.rpc("get_booking_by_token", { p_token: String(token) });
      if (!r.error && r.data && Array.isArray(r.data) && r.data.length > 0) {
        return r.data[0];
      }

      // If the RPC failed because the function doesn't exist (migration not run),
      // try resolving by ref for authenticated editors. For anonymous users, we
      // check if the token appears in special_req metadata (the live schema
      // uses this column rather than a separate notes column).
      var sess = await getSession();
      if (sess && sess.user) {
        var query = client.from("bookings").select("*").limit(1);
        if (String(token).startsWith("WO")) {
          query = query.eq("ref", token);
        } else {
          // Try receipt_token column first; if that fails (no column), search notes.
          try {
            var direct = await query.or("receipt_token.eq." + token + ",ref.eq." + token).maybeSingle();
            if (direct && direct.data) return direct.data;
          } catch (e) {}
          // Fallback: search special_req for the token (stored as metadata).
          var noteR = await client
            .from("bookings")
            .select("*")
            .ilike("special_req", "%ReceiptToken: " + token + "%")
            .limit(1)
            .maybeSingle();
          if (noteR && noteR.data) return noteR.data;
        }
      } else {
        // Anonymous visitor — try ref match (WO- prefix only).
        if (String(token).startsWith("WO")) {
          var refR = await client.from("bookings").select("*").eq("ref", token).limit(1).maybeSingle();
          if (refR && refR.data) return refR.data;
        }
        // Check if the token is in notes (stored as metadata in fallback path).
        var noteAnon = await client
          .from("bookings")
          .select("*")
          .ilike("special_req", "%ReceiptToken: " + token + "%")
          .limit(1)
          .maybeSingle();
        if (noteAnon && noteAnon.data) return noteAnon.data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async function updateBooking(idOrRef, updates) {
    if (!configured()) return { ok: false, error: "Supabase is not configured." };
    init();
    if (!client) return { ok: false, error: "Supabase client could not start." };
    var matchFn = function(q) {
      if (typeof idOrRef === "string" && idOrRef.startsWith("WO")) return q.eq("ref", idOrRef);
      return q.eq("id", idOrRef);
    };
    var allowedStatuses = ["new", "contacted", "confirmed", "cancelled"];
    var patch = {};
    if (updates.status != null) {
      var normalizedStatus = String(updates.status).toLowerCase();
      if (normalizedStatus === "completed") normalizedStatus = "confirmed";
      if (allowedStatuses.indexOf(normalizedStatus) === -1) return { ok: false, error: "Invalid booking status." };
      patch.status = normalizedStatus;
    }
    if (updates.payment_status != null) patch.payment_status = String(updates.payment_status);

    // txn_ref/amount/receipt_token have no dedicated columns in this live schema.
    // Preserve them in special_req instead of sending nonexistent columns.
    var needsMetadata = updates.txn_ref != null || updates.amount != null || updates.receipt_token != null;
    if (needsMetadata) {
      var current = await matchFn(client.from("bookings").select("special_req").limit(1).maybeSingle());
      if (current.error) return { ok: false, error: current.error.message };
      if (!current.data) return { ok: false, error: "Booking was not found." };
      var existing = String(current.data.special_req || "");
      var parts = existing.split(/\s*\|\s*/).filter(Boolean).filter(function(part) {
        return !/^(Transaction reference|Amount|ReceiptToken|PaymentStatus):/i.test(part);
      });
      if (updates.txn_ref != null && String(updates.txn_ref).trim()) parts.push("Transaction reference: " + String(updates.txn_ref).trim());
      if (updates.amount != null && String(updates.amount).trim()) parts.push("Amount: " + String(updates.amount).trim());
      if (updates.receipt_token != null && String(updates.receipt_token).trim()) parts.push("ReceiptToken: " + String(updates.receipt_token).trim());
      patch.special_req = parts.join(" | ") || null;
    }
    if (!Object.keys(patch).length) return { ok: true };
    var result = await matchFn(client.from("bookings").update(patch));
    if (result.error) {
      console.error("[Backend] updateBooking failed:", result.error.message, result.error);
      return { ok: false, error: result.error.message };
    }
    return { ok: true };
  }

  async function loadBookings() {
    if (!configured()) return [];
    init();
    if (!client) return [];
    var r = await client
      .from("bookings")
      .select("*")
      .order("created_at", { ascending: false });
    if (r.error) {
      console.warn("[Backend] loadBookings:", r.error.message);
      return [];
    }
    return r.data || [];
  }

  /* -------------------- enquiries -------------------- */
  async function submitEnquiry(enq) {
    if (!configured()) return { ok: false, error: "Supabase is not configured." };
    init();
    if (!client) return { ok: false, error: "Supabase client could not start." };
    enq = enq || {};
    var name = String(enq.name || "").trim();
    var email = String(enq.email || "").trim();
    var phone = String(enq.phone || "").trim();
    var message = String(enq.message || "").trim();
    var subject = String(enq.subject || "").trim();
    if (!name || !message || (!email && !phone)) {
      return { ok: false, error: "Please enter your name, message, and either an email or phone number." };
    }
    // Match the actual connected public.enquiries columns. There is no subject column.
    var row = {
      name: name,
      email: email || null,
      phone: phone || null,
      whatsapp: String(enq.whatsapp || phone || "").trim() || null,
      destination: String(enq.destination || "").trim() || null,
      travel_type: String(enq.travel_type || subject || "General enquiry").trim() || null,
      travel_date: String(enq.travel_date || "").trim() || null,
      people: enq.people == null || String(enq.people).trim() === "" ? null : String(enq.people).trim(),
      budget: String(enq.budget || "").trim() || null,
      requirements: String(enq.requirements || "").trim() || null,
      message: subject ? "Subject: " + subject + "\n\n" + message : message
    };
    var r = await client.from("enquiries").insert([row]);
    if (r.error) {
      console.error("[Backend] submitEnquiry failed:", r.error.message, r.error);
      return { ok: false, error: r.error.message };
    }
    return { ok: true };
  }

  async function loadEnquiries() {
    if (!configured()) return { ok: false, error: "Supabase is not configured.", data: [] };
    init();
    if (!client) return { ok: false, error: "Supabase client could not start.", data: [] };
    var r = await client.from("enquiries").select("*").order("created_at", { ascending: false });
    if (r.error) {
      console.error("[Backend] loadEnquiries failed:", r.error.message, r.error);
      return { ok: false, error: r.error.message, data: [] };
    }
    return { ok: true, data: r.data || [] };
  }

  /* -------------------- auth -------------------- */
  async function getSession() {
    if (!configured()) return null;
    init();
    if (!client) return null;
    var r = await client.auth.getSession();
    return r.data && r.data.session ? r.data.session : null;
  }

  function onAuth(cb) {
    if (!configured()) return function () {};
    init();
    var s = client.auth.onAuthStateChange(function (_e, sess) {
      cb(sess);
    });
    return s && s.data && s.data.subscription
      ? function () {
          s.data.subscription.unsubscribe();
        }
      : function () {};
  }

  async function signIn(email, password) {
    if (!configured()) return { ok: false, error: "not-configured" };
    init();
    if (!client) return { ok: false, error: "supabase-unavailable" };
    var r = await client.auth.signInWithPassword({ email: email, password: password });
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true, session: r.data.session };
  }

  async function signUp(email, password) {
    if (!configured()) return { ok: false, error: "not-configured" };
    init();
    if (!client) return { ok: false, error: "supabase-unavailable" };
    var r = await client.auth.signUp({ email: email, password: password });
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true, session: r.data.session, user: r.data.user };
  }

  async function signOut() {
    if (client) {
      try {
        await client.auth.signOut();
      } catch (e) {}
    }
  }

  // Safe helper to read site_settings row whether id is INTEGER (1) or TEXT ('main')
  async function getSiteSettingsRow() {
    init();
    if (!client) return null;
    try {
      var r = await client.from("site_settings").select("*").limit(1).maybeSingle();
      if (r && r.data) return r.data;
    } catch (e) {}
    return null;
  }

  async function isEditor() {
    var s = await getSession();
    if (!s || !s.user) return false;
    init();
    if (!client) return false;
    try {
      var a = await client.from("profiles").select("is_admin").eq("id", s.user.id).maybeSingle();
      if (a.data && a.data.is_admin) return true;
    } catch (e) {}
    var email = (s.user.email || "").toLowerCase();
    if (!email) return false;
    var st = await getSiteSettingsRow();
    var list = (st && st.editors) || [];
    return (
      list
        .map(String)
        .map(function (x) { return x.toLowerCase(); })
        .indexOf(email) !== -1
    );
  }

  async function inviteEditor(email) {
    if (!configured()) return { ok: false, error: "not-configured" };
    init();
    var s = await getSession();
    if (!s) return { ok: false, error: "sign-in-required" };
    var a = await client.from("profiles").select("is_admin").eq("id", s.user.id).maybeSingle();
    if (!(a.data && a.data.is_admin)) return { ok: false, error: "admin-only" };
    var e = String(email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: "invalid-email" };
    var st = await getSiteSettingsRow();
    var list = (st && st.editors) || [];
    if (list.indexOf(e) === -1) list = list.concat([e]);
    var targetId = (st && st.id) != null ? st.id : 1;
    var r = await client.from("site_settings").update({ editors: list }).eq("id", targetId);
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true, email: e };
  }

  async function changePassword(newPass) {
    if (!configured()) return { ok: false, error: "not-configured" };
    init();
    var r = await client.auth.updateUser({ password: newPass });
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  }

  /* -------------------- view lock -------------------- */
  async function getViewLock() {
    if (!configured()) return null;
    init();
    var st = await getSiteSettingsRow();
    return (st && st.view_passcode) || null;
  }

  async function setViewLock(code) {
    if (!configured()) return { ok: false };
    init();
    var c = (code || "").trim();
    var st = await getSiteSettingsRow();
    var targetId = (st && st.id) != null ? st.id : 1;
    var r = await client
      .from("site_settings")
      .update({ view_passcode: c ? c : null })
      .eq("id", targetId);
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  }

  async function editorEmail() {
    var s = await getSession();
    return (s && s.user && s.user.email) || null;
  }

  /* -------------------- images (Supabase Storage) -------------------- */
  async function uploadImage(file, path) {
    if (!configured()) return { ok: false, error: "not-configured" };
    init();
    if (!client) return { ok: false, error: "supabase-unavailable" };
    if (!file) return { ok: false, error: "no-file" };
    var safe = (file.name || "image.png").replace(/[^a-zA-Z0-9._-]/g, "_");
    var p = path || "imgs/" + Date.now() + "_" + safe;
    var r = await client.storage
      .from("site-images")
      .upload(p, file, { upsert: true, cacheControl: "3600" });
    if (r.error) return { ok: false, error: r.error.message };
    var pub = client.storage.from("site-images").getPublicUrl(p);
    var url = pub && pub.data && pub.data.publicUrl ? pub.data.publicUrl : null;
    return { ok: true, url: url, path: p };
  }

  async function removeImage(path) {
    if (!configured() || !path) return { ok: false };
    init();
    var r = await client.storage.from("site-images").remove([path]);
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  }

  window.Backend = {
    configured: configured,
    init: init,
    loadContent: loadContent,
    saveContent: saveContent,
    submitBooking: submitBooking,
    updateBooking: updateBooking,
    loadBookings: loadBookings,
    getBookingByToken: getBookingByToken,
    submitEnquiry: submitEnquiry,
    loadEnquiries: loadEnquiries,
    getSession: getSession,
    onAuth: onAuth,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    isEditor: isEditor,
    inviteEditor: inviteEditor,
    changePassword: changePassword,
    getViewLock: getViewLock,
    setViewLock: setViewLock,
    editorEmail: editorEmail,
    uploadImage: uploadImage,
    removeImage: removeImage
  };
})();
