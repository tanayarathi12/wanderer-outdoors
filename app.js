/* ============================================================
   The Wanderer Outdoors — Single-Page App (SPA)
   - Modular full-page internal views (/treks, /winter-camps, etc.)
   - Dedicated Trip Detail pages (/treks/:slug or /trip/:id)
   - Visitor mode by default on every fresh visit & refresh
   - Private Control Room is served only from /admin/
   - Universal Book Now across all bookable categories
   - WhatsApp message generation & Supabase booking recording
   - Unique Booking IDs & Branded printable receipts
   - Real Google Reviews integration / verified link support
   - Blog reader & searchable FAQ accordions
   - In-place editable content in Admin mode
   - Persists via Supabase + localStorage
   ============================================================ */

(() => {
  'use strict';

  const STORAGE_KEY = 'wandererOutdoors.v2';
  const DEFAULT_STATE = window.WO_DEFAULTS;

  // --------------------------------------------------------------
  // State Initialization & Migration
  // --------------------------------------------------------------
  let state = loadState();
  let serverMode = false;
  let adminKey = null;          // signed-in editor email
  let activeView = 'home';      // current active view
  let currentTrip = null;       // trip for detail view
  let currentArticle = null;    // article for blog view
  let lastBookingRecord = null; // last submitted booking for receipt

  function deepClone(o){ return JSON.parse(JSON.stringify(o || {})); }

  function mergeWithDefaults(remote){
    const d = deepClone(DEFAULT_STATE);
    if(!remote || typeof remote !== 'object') return d;

    ['site', 'seo', 'brand', 'hero', 'contact', 'booking', 'footer', 'googleReviews', 'customTrip', 'buttonLinks'].forEach(k => {
      if(remote[k] && typeof remote[k] === 'object') Object.assign(d[k], remote[k]);
    });

    if(remote.views && Array.isArray(remote.views) && remote.views.length) {
      d.views = remote.views;
    }

    if(remote.theme && typeof remote.theme === 'object'){
      Object.assign(d.theme, remote.theme);
      if(remote.theme.heading) Object.assign(d.theme.heading, remote.theme.heading);
      if(remote.theme.body)    Object.assign(d.theme.body, remote.theme.body);
      if(remote.theme.sections) d.theme.sections = remote.theme.sections;
    }

    if(remote.highlights && typeof remote.highlights === 'object') {
      Object.assign(d.highlights, remote.highlights);
    }

    if(Array.isArray(remote.sections) && remote.sections.length){
      d.sections = remote.sections.map(sec => {
        const defSec = (DEFAULT_STATE.sections || []).find(s => s.key === sec.key || s.id === sec.id);
        if(sec.subsections === undefined && defSec && Array.isArray(defSec.subsections)){
          sec.subsections = deepClone(defSec.subsections);
        } else if(!Array.isArray(sec.subsections)){
          sec.subsections = [];
        }

        // NOTE: Default items are NOT auto-inserted here – doing so would undo user deletions.
        // Strip lingering built-in default IDs that the editor has permanently deleted:
        const PURGED_DEFAULT_IDS = new Set([
          'w_kedarkantha','w_brahmatal','w_deoriatal','w_kuari',
          'w_kids_manali','w_wildlife_ranthambore','w_intl_vietnam'
        ]);
        sec.items = (sec.items || [])
          .filter(it => !PURGED_DEFAULT_IDS.has(it.id))
          .map(it => window.WO_normalizeItem ? window.WO_normalizeItem(it) : it);
        return sec;
      });
    }

    if(Array.isArray(remote.extraSections)){
      d.extraSections = remote.extraSections.map(sec => {
        sec.items = (sec.items || []).map(it => window.WO_normalizeItem ? window.WO_normalizeItem(it) : it);
        return sec;
      });
    }

    if(Array.isArray(remote.blogs) && remote.blogs.length) d.blogs = remote.blogs;
    if(Array.isArray(remote.faqs) && remote.faqs.length)   d.faqs = remote.faqs;
    if(Array.isArray(remote.reviews) && remote.reviews.length) d.reviews = remote.reviews;
    if(remote.positions) d.positions = remote.positions;

    return d;
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return deepClone(DEFAULT_STATE);
      return mergeWithDefaults(JSON.parse(raw));
    }catch(e){
      console.warn('[App] Could not load saved state, using defaults.', e);
      return deepClone(DEFAULT_STATE);
    }
  }

  function saveState(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }catch(e){
      console.error('[App] Could not save to localStorage:', e);
    }
    if(serverMode && adminKey){
      setSyncStatus('saving');
      pushContent();
    }
  }

  async function fetchContent(){
    try{
      if(!window.Backend || !Backend.configured()) return null;
      return await Backend.loadContent();
    }catch(e){
      return null;
    }
  }

  let pushTimer = null;
  function pushContent(){
    if(!serverMode) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      if(!adminKey){ setSyncStatus('error'); return; }
      setSyncStatus('saving');
      const res = await Backend.saveContent(state);
      if(res && res.ok){
        setSyncStatus('saved');
      }else if(res && res.auth){
        setSyncStatus('error');
        promptPasscode(() => pushContent());
      }else{
        setSyncStatus('error');
      }
    }, 400);
  }

  function setSyncStatus(kind){
    const el = $('#syncStatus');
    if(!el) return;
    if(!serverMode){
      el.textContent = 'Offline copy';
      el.style.color = '#fbbf24';
      return;
    }
    if(kind === 'saving'){ el.textContent = 'Saving…'; el.style.color = '#fbbf24'; }
    else if(kind === 'saved'){ el.textContent = 'Saved to site ✓'; el.style.color = '#22c55e'; }
    else if(kind === 'error'){ el.textContent = 'Save failed'; el.style.color = '#f87171'; }
    else { el.textContent = ''; }
  }

  // --------------------------------------------------------------
  // DOM Helpers
  // --------------------------------------------------------------
  function $(sel, root=document){ return root.querySelector(sel); }
  function $$(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
  function escapeHtml(str){ return String(str||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function h(p){ return (p||'id') + '_' + Math.random().toString(36).slice(2, 9); }

  // Cryptographically secure booking reference (no Math.random for the ref).
  // 12 random bytes => 96 bits of entropy; collisions are infeasible.
  function generateBookingRef(){
    try {
      const yr = new Date().getFullYear();
      const arr = new Uint8Array(12);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      let s = '';
      for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
      return 'WO-' + yr + '-' + s.toUpperCase();
    } catch(e){
      // Fallback only if crypto is unavailable (exceedingly rare).
      return 'WO-' + new Date().getFullYear() + '-' + h('r').toUpperCase();
    }
  }

  // Cryptographically secure, unguessable receipt token (24 bytes => 192 bits).
  function generateReceiptToken(){
    try {
      const arr = new Uint8Array(24);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      let s = '';
      for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
      return s;
    } catch(e){
      return h('tk') + h('tk') + h('tk');
    }
  }

  // True if a string looks like an unguessable receipt token (long hex).
  function looksLikeToken(s){
    return typeof s === 'string' && /^[0-9a-f]{32,}$/i.test(s);
  }

  // --------------------------------------------------------------
  // Section & Item Lookups
  // --------------------------------------------------------------
  function allSections(){
    return [].concat(state.sections || [], state.extraSections || []);
  }

  function findSection(keyOrId){
    if(!keyOrId) return null;
    return allSections().find(s => s.key === keyOrId || s.id === keyOrId);
  }

  function bookTypeFor(sec){
    if(!sec) return 'Trek';
    if(sec.bookType) return sec.bookType;
    const map = {
      treks:'Trek', winter:'Winter Camp', summer:'Summer Camp',
      tours:'Tour', outings:'Outing', corporate:'Corporate Event'
    };
    if(map[sec.key]) return map[sec.key];
    const k = (sec.kicker || sec.title || '').toLowerCase();
    if(k.includes('trek')) return 'Trek';
    if(k.includes('winter')) return 'Winter Camp';
    if(k.includes('summer')) return 'Summer Camp';
    if(k.includes('tour')) return 'Tour';
    if(k.includes('outing')) return 'Outing';
    if(k.includes('corp')) return 'Corporate Event';
    return sec.kicker || 'Adventure';
  }

  function findTrip(identifier, preferredSectionKey){
    if(!identifier) return null;
    const sections = allSections();
    // 1. If preferredSectionKey is passed (e.g. 'winter' in #/winter/:slug), search that section first
    if(preferredSectionKey){
      const sec = sections.find(s => s.key === preferredSectionKey || s.id === preferredSectionKey);
      if(sec && Array.isArray(sec.items)){
        for(const item of sec.items){
          if(item.id === identifier || item.slug === identifier) return { item, sec };
        }
        const targetSlug = window.WO_slugify ? window.WO_slugify(identifier) : identifier.toLowerCase();
        for(const item of sec.items){
          const s = item.slug || (window.WO_slugify ? window.WO_slugify(item.name) : '');
          if(s === targetSlug) return { item, sec };
        }
      }
    }
    // 2. Search all sections by exact ID or exact slug
    for(const sec of sections){
      for(const item of (sec.items || [])){
        if(item.id === identifier || item.slug === identifier) {
          return { item, sec };
        }
      }
    }
    // 3. Search all sections by fuzzy slugified name
    const targetSlug = window.WO_slugify ? window.WO_slugify(identifier) : identifier.toLowerCase();
    for(const sec of sections){
      for(const item of (sec.items || [])){
        const s = item.slug || (window.WO_slugify ? window.WO_slugify(item.name) : '');
        if(s === targetSlug) return { item, sec };
      }
    }
    return null;
  }

  // --------------------------------------------------------------
  // Router (Client-side SPA with History API + Hash fallback)
  // --------------------------------------------------------------
  function parseRoute(){
    let hash = window.location.hash.slice(1);
    if(hash.startsWith('/')) hash = hash.slice(1);
    let path = hash;
    if(!path){
      // Check pathname if served with clean URL rewrite
      const p = window.location.pathname.replace(/^\/|\/$/g, '');
      if(p && !p.includes('.')) path = p;
    }
    return path || '';
  }

  function navigate(route, replace=false){
    const clean = String(route || '').replace(/^\/+/, '');
    const url = clean ? ('#/' + clean) : '#/';
    if(replace){
      history.replaceState({ route: clean }, '', url);
    }else{
      history.pushState({ route: clean }, '', url);
    }
    handleRoute();
  }
  window.navigate = navigate;

  function handleRoute(){
    const raw = parseRoute();
    const parts = raw.split('/').filter(Boolean);
    const viewName = parts[0] || 'home';

    window.scrollTo({ top: 0, behavior: 'instant' });

    // Blog article routes must be resolved before the generic section router.
    // Without this branch, /blog/:slug falls back to the blog listing, so cards
    // appear clickable but never open their full article.
    if(parts[0] === 'blog' && parts.length >= 2){
      let articleKey = '';
      try { articleKey = decodeURIComponent(parts.slice(1).join('/')); }
      catch(e) { articleKey = parts.slice(1).join('/'); }
      const slugifyArticle = value => window.WO_slugify ? window.WO_slugify(value) : String(value || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-');
      currentArticle = (state.blogs || []).find(b => b.published !== false && (
        String(b.slug || '') === articleKey || String(b.id || '') === articleKey || slugifyArticle(b.title) === articleKey
      )) || null;
      activeView = 'blog-article';
      renderActiveView();
      updateNavState('blog');
      return;
    }

    // Handle Trip Detail routes: e.g. /treks/:slug or /trip/:id
    if(parts.length >= 2){
      const tripMatch = findTrip(parts[1], parts[0]);
      if(tripMatch){
        currentTrip = tripMatch;
        activeView = 'trip-detail';
        renderActiveView();
        updateNavState(parts[0]);
        return;
      }
      // Receipt lookup route: /receipt/:token  (SECURE, unguessable token)
      // We deliberately do NOT expose the full bookings table to anonymous
      // visitors. The public link carries only an unguessable receipt_token,
      // resolved via Backend.getBookingByToken() (a SECURITY DEFINER function).
      // Legacy /receipt/:ref (no token) links cannot be resolved publicly and
      // show a friendly "contact us" notice instead.
      if(parts[0] === 'receipt' || parts[0] === 'receipts'){
        const tokenOrRef = parts[1];
        renderPublicReceipt(tokenOrRef);
        return;
      }
    }

    // Direct trip lookup if someone went to /trip-slug
    const directTrip = findTrip(viewName);
    if(directTrip && viewName !== 'treks' && viewName !== 'tours' && viewName !== 'winter-camps' && viewName !== 'summer-camps' && viewName !== 'outings' && viewName !== 'corporate'){
      currentTrip = directTrip;
      activeView = 'trip-detail';
      renderActiveView();
      updateNavState(directTrip.sec.key);
      return;
    }

    // Map route alias to view ID
    const routeMap = {
      '': 'home',
      'home': 'home',
      'treks': 'treks',
      'winter': 'winter',
      'winter-camps': 'winter',
      'summer': 'summer',
      'summer-camps': 'summer',
      'tours': 'tours',
      'outings': 'outings',
      'corporate': 'corporate',
      'corporate-retreats': 'corporate',
      'gallery': 'gallery',
      'highlights': 'gallery',
      'reviews': 'reviews',
      'testimonials': 'reviews',
      'blog': 'blog',
      'faq': 'faq',
      'faqs': 'faq',
      'contact': 'contact',
      'booking': 'booking'
    };

    activeView = routeMap[viewName] || 'home';
    renderActiveView();
    updateNavState(activeView);
  }

  function updateNavState(current){
    $$('.primary-nav a').forEach(a => {
      const href = a.getAttribute('href') || '';
      const navKey = a.dataset.nav;
      const isMatch = navKey === current || href.includes(current);
      a.classList.toggle('active-link', !!isMatch && current !== 'home');
    });
  }

  // --------------------------------------------------------------
  // Navigation Bar Rendering
  // --------------------------------------------------------------
  function renderNav(){
    const nav = $('#primaryNav');
    if(!nav) return;
    nav.innerHTML = '';

    const views = (state.views || DEFAULT_STATE.views).filter(v => v.enabled !== false && v.inNav !== false);
    views.forEach(v => {
      const a = document.createElement('a');
      a.href = '#' + (v.path ? (v.path.startsWith('/') ? v.path : '/' + v.path) : '/' + v.id);
      a.textContent = v.title || v.id;
      a.dataset.nav = v.id;
      if(v.id === 'booking') a.className = 'nav-book';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(v.path || v.id);
        $('.primary-nav').classList.remove('open');
      });
      nav.appendChild(a);
    });
  }

  // --------------------------------------------------------------
  // Views Rendering Engine
  // --------------------------------------------------------------
  function renderActiveView(){
    const container = $('#appMain');
    if(!container) return;
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'spa-view active';

    switch(activeView){
      case 'home':
        wrap.appendChild(buildHomeView());
        break;
      case 'treks':
      case 'winter':
      case 'summer':
      case 'tours':
      case 'outings':
      case 'corporate':
        wrap.appendChild(buildCategoryView(activeView));
        break;
      case 'trip-detail':
        wrap.appendChild(buildTripDetailView(currentTrip));
        break;
      case 'gallery':
        wrap.appendChild(buildGalleryView());
        break;
      case 'reviews':
        wrap.appendChild(buildReviewsView());
        break;
      case 'blog':
        wrap.appendChild(buildBlogListView());
        break;
      case 'blog-article':
        wrap.appendChild(buildBlogArticleView(currentArticle));
        break;
      case 'faq':
        wrap.appendChild(buildFaqView());
        break;
      case 'contact':
        wrap.appendChild(buildContactView());
        break;
      case 'booking':
        wrap.appendChild(buildDedicatedBookingView());
        break;
      default:
        // Check if it's an extra section
        const extraSec = allSections().find(s => s.key === activeView || s.id === activeView);
        if(extraSec){
          wrap.appendChild(buildCategoryView(extraSec.key || extraSec.id));
        }else{
          wrap.appendChild(buildHomeView());
        }
    }

    container.appendChild(wrap);

    // Wire editable content if admin mode is on
    if(document.body.classList.contains('admin-mode')){
      $$('[data-edit]', container).forEach(el => makeEditable(el));
    }
  }

  // --------------------------------------------------------------
  // 1. Home View
  // --------------------------------------------------------------
  function buildHomeView(){
    const home = document.createElement('div');
    home.className = 'view-home';

    // Hero Section
    const heroSec = document.createElement('section');
    heroSec.className = 'hero';
    heroSec.id = 'top';
    heroSec.innerHTML = `
      <div class="hero-overlay"></div>
      <div class="wrap hero-inner">
        <h1 data-edit="hero.title">${escapeHtml(state.hero.title)}</h1>
        <p data-edit="hero.subtitle">${escapeHtml(state.hero.subtitle)}</p>
        <div class="hero-actions">
          <a id="heroCta" href="${escapeHtml(state.hero.ctaHref || '#/treks')}" class="cta" data-edit="hero.ctaText">${escapeHtml(state.hero.ctaText || 'Plan an Adventure')}</a>
          <button class="admin-only btn-ghost" id="editHeroCtaUrlBtn" style="margin-left:10px;">URL</button>
          <a class="wa-hero" id="heroWa" href="${escapeHtml((state.buttonLinks && state.buttonLinks.homeWhatsApp) || ('https://wa.me/' + (state.contact.whatsapp||'917387778296').replace(/\D/g,'')))}" target="_blank" rel="noopener">
            <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 4C9.96 4 5.02 8.94 5.02 15.02c0 2.2.6 4.26 1.64 6.02L5 28l7.1-1.62a11 11 0 0 0 3.94.72h.01C22.12 27.1 27 22.15 27 16.08 27 9.98 22.1 4 16.04 4zm0 2.2c3.83 0 6.94 3.12 6.94 6.95 0 3.83-3.11 6.94-6.94 6.94-1.2 0-2.36-.3-3.37-.87l-.48-.27-4.03 1.03 1.08-3.93-.31-.5a6.9 6.9 0 0 1-1.06-3.7c0-3.83 3.11-6.65 7.17-6.65zM12.9 10.3c-.2 0-.5.07-.76.36-.27.28-1.02 1-.99 2.43.03 1.44 1.05 2.83 1.2 3.03.14.19 2.02 3.3 5.02 4.5 2.48.99 2.99.79 3.53.74.54-.05 1.75-.72 2-1.41.25-.69.25-1.28.18-1.4-.07-.13-.26-.2-.54-.35-.28-.14-1.65-.81-1.9-.9-.26-.09-.44-.14-.63.14-.19.28-.72.9-.89 1.08-.16.19-.33.21-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.94-.16-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.16.19-.28.28-.47.1-.19.05-.35-.02-.5-.07-.14-.62-1.55-.87-2.1-.22-.55-.45-.46-.62-.47l-.56-.01z"/></svg>
            <span>WhatsApp <strong>${escapeHtml((state.contact.whatsapp||'917387778296').replace(/\D/g,'').replace(/^91/,''))}</strong></span>
          </a>
        </div>
      </div>
      <button class="bg-replace admin-only" data-replace-bg="hero">Change hero background</button>
    `;
    applyHeroBg(heroSec);
    const heroCtaEl = heroSec.querySelector("#heroCta");
    if(heroCtaEl) heroCtaEl.addEventListener("click", function(e){ e.preventDefault(); openConfiguredDestination(state.hero.ctaHref || "#/treks"); });
    home.appendChild(heroSec);

    // Quick Category Discovery Pills
    const disc = document.createElement('div');
    disc.className = 'wrap';
    disc.style.cssText = 'padding:32px 24px 10px;';
    disc.innerHTML = `
      <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:12px;" class="cat-pill-row">
        <a href="#/treks" data-section-nav="treks" class="btn-ghost" style="flex:none;">⛰ Sahyadri & Himalayan Treks</a>
        <a href="#/winter-camps" data-section-nav="winter-camps" class="btn-ghost" style="flex:none;">❄ Winter Camps</a>
        <a href="#/summer-camps" data-section-nav="summer-camps" class="btn-ghost" style="flex:none;">🌸 Summer Camps</a>
        <a href="#/tours" data-section-nav="tours" class="btn-ghost" style="flex:none;">🚐 Plan a Custom Trip</a>
        <a href="#/outings" data-section-nav="outings" class="btn-ghost" style="flex:none;">🌿 Day Outings</a>
        <a href="#/corporate" data-section-nav="corporate" class="btn-ghost" style="flex:none;">🤝 Corporate Offsites</a>
      </div>
    `;
    $$('a', disc).forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      const key = a.dataset.sectionNav;
      const section = key ? findSection(key) : null;
      const destination = section && section.buttonLinks && section.buttonLinks.nav;
      openConfiguredDestination(destination || a.getAttribute('href'));
    }));
    home.appendChild(disc);

    // Featured Adventures Across Categories
    const featWrap = document.createElement('div');
    featWrap.className = 'wrap';
    featWrap.style.cssText = 'padding:40px 24px;';
    featWrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28px;flex-wrap:wrap;gap:14px;">
        <div>
          <span class="kicker" style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--ember);display:block;margin-bottom:6px;">Featured Adventures</span>
          <h2 style="font-size:clamp(26px,3.5vw,36px);margin:0;letter-spacing:-.5px;">Upcoming summits &amp; trails.</h2>
        </div>
        <a href="${escapeHtml((state.buttonLinks && state.buttonLinks.featuredTrips) || '#/treks')}" class="btn-ghost" id="viewAllTreksBtn">${escapeHtml((state.buttonLinks && state.buttonLinks.featuredTripsLabel) || 'View all treks & camps ▸')}</a>
      </div>
    `;
    const viewAllBtn = featWrap.querySelector('#viewAllTreksBtn');
    if(viewAllBtn) viewAllBtn.addEventListener('click', (e) => { e.preventDefault(); openConfiguredDestination((state.buttonLinks && state.buttonLinks.featuredTrips) || '#/treks'); });

    const grid = document.createElement('div');
    grid.className = 'trips-grid';

    // Gather top 6 featured trips across sections
    const sampleTrips = [];
    allSections().forEach(sec => {
      const sectionIdentity = [sec.key, sec.id, sec.title, sec.kicker, sec.bookType].filter(Boolean).join(' ').toLowerCase();
      if(sec.key === 'tours' || sec.id === 'tours' || /\btour(s)?\b|circuit tour|curated circuit/.test(sectionIdentity)) return; // Custom trips are enquiry-led, never fixed tour cards.
      (sec.items || []).slice(0, 2).forEach(it => sampleTrips.push({ item: it, sec }));
    });
    sampleTrips.slice(0, 6).forEach(({ item, sec }) => {
      grid.appendChild(buildTripCardEl(item, sec));
    });
    featWrap.appendChild(grid);
    home.appendChild(featWrap);

    // Highlights Teaser Section
    home.appendChild(buildHighlightsSectionEl());

    // Google Reviews & Testimonial Teaser Section
    home.appendChild(buildReviewsTeaserEl());

    // Quick Booking CTA Banner
    const ctaBanner = document.createElement('div');
    ctaBanner.className = 'wrap';
    ctaBanner.style.cssText = 'padding:20px 24px 60px;';
    const ctaTitle = (state.buttonLinks && state.buttonLinks.homeCTATitle) || 'Ready to explore the outdoors?';
    const ctaSubtitle = (state.buttonLinks && state.buttonLinks.homeCTASubtitle) || 'Speak directly with our instructors on WhatsApp or book your spot in under 2 minutes.';
    const ctaBtnLabel = (state.buttonLinks && state.buttonLinks.homeReserveLabel) || 'Reserve a Spot';
    ctaBanner.innerHTML = `
      <div style="background:var(--forest);color:#fff;border-radius:var(--radius);padding:44px 36px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:20px;box-shadow:var(--shadow-lg);">
        <div style="max-width:620px;">
          <h3 style="color:#fff;font-size:28px;margin:0 0 10px;">${escapeHtml(ctaTitle)}</h3>
          <p style="color:#d5e5db;margin:0;font-size:16px;">${escapeHtml(ctaSubtitle)}</p>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <button class="btn-primary" id="homeBookBtn" style="background:var(--ember);font-size:15px;padding:14px 28px;">${escapeHtml(ctaBtnLabel)}</button>
          <a class="btn-ghost light" href="https://wa.me/${escapeHtml((state.contact.whatsapp||'917387778296').replace(/\D/g,''))}" target="_blank" rel="noopener">WhatsApp Us</a>
        </div>
      </div>
    `;
    ctaBanner.querySelector('#homeBookBtn').addEventListener('click', (e) => { e.preventDefault(); openConfiguredDestination((state.buttonLinks && state.buttonLinks.homeReserve) || '#/contact'); });
    home.appendChild(ctaBanner);

    return home;
  }

  // --------------------------------------------------------------
  // 2. Category Views (Treks, Winter Camps, Summer Camps, Tours, etc.)
  // --------------------------------------------------------------
  function buildCategoryView(secKey){
    const sec = findSection(secKey);
    const view = document.createElement('div');
    view.className = 'view-category wrap';

    // Tours category is ALWAYS a custom-trip enquiry pathway, never fixed tour cards
    if(secKey === 'tours' || (sec && (sec.key === 'tours' || sec.id === 'tours' || /\btour(s)?\b|circuit tour|curated circuit/.test([sec.key, sec.id, sec.title, sec.kicker, sec.bookType].filter(Boolean).join(' ').toLowerCase())))) {
      view.appendChild(buildBreadcrumbsEl([
        { title: 'Home', path: '' },
        { title: (sec && (sec.title || sec.kicker)) || 'Curated Circuit Tours' }
      ]));
      const custom = document.createElement('section');
      custom.className = 'custom-trip-cta';
      const customCfg = state.customTrip || {};
      custom.innerHTML = `<div class="custom-trip-card" style="background:${escapeHtml(customCfg.background || '#1F4D36')};color:${escapeHtml(customCfg.text || '#ffffff')}"><span class="kicker">${escapeHtml(customCfg.kicker || 'Your journey, your way')}</span><h2>${escapeHtml(customCfg.title || 'Plan Your Trip With Us')}</h2><p>${escapeHtml(customCfg.description || 'Tell us where you want to go, when you want to travel, and what kind of experience you have in mind. We’ll help curate a trip around you.')}</p><a class="btn-primary" href="#/contact" id="customTripContactBtn" style="background:${escapeHtml(customCfg.buttonBackground || '#D9582B')};color:${escapeHtml(customCfg.buttonText || '#ffffff')}">${escapeHtml(customCfg.buttonTextLabel || 'Plan My Trip')}</a></div>`;
      custom.querySelector('#customTripContactBtn').addEventListener('click', function(e){ e.preventDefault(); const d=(customCfg.buttonUrl||'#/contact'); openConfiguredDestination(d); });
      view.appendChild(custom);
      return view;
    }

    if(!sec){
      view.innerHTML = `
        <div style="padding:80px 20px;text-align:center;">
          <h2>Section not found</h2>
          <p class="muted">This category may have been moved or removed.</p>
          <button class="btn-primary" onclick="window.history.back()">Go Back</button>
        </div>
      `;
      return view;
    }

    // Breadcrumbs
    view.appendChild(buildBreadcrumbsEl([
      { title: 'Home', path: '' },
      { title: sec.title || sec.kicker || sec.key }
    ]));

    // Header
    const secColors = sec.colors || {};
    if(secColors.background) view.style.backgroundColor = secColors.background;
    if(secColors.text) { view.style.color = secColors.text; view.style.setProperty('--sec-text', secColors.text); }
    if(secColors.heading) view.style.setProperty('--heading-color', secColors.heading);
    if(secColors.accent) { view.style.setProperty('--ember', secColors.accent); view.style.setProperty('--trip-button-bg', secColors.accent); }
    const head = document.createElement('div');
    head.className = 'category-header';
    if(secColors.heading) head.style.color = secColors.heading;
    if(secColors.text) head.style.setProperty('--body-color', secColors.text);
    if(secColors.accent) head.style.setProperty('--ember', secColors.accent);
    if(secColors.background) head.style.backgroundColor = secColors.background;
    head.innerHTML = `
      <span class="kicker" data-edit="sections.${sec.key}.kicker">${escapeHtml(sec.kicker || sec.key)}</span>
      <h1 data-edit="sections.${sec.key}.title">${escapeHtml(sec.title || '')}</h1>
      <p data-edit="sections.${sec.key}.intro">${escapeHtml(sec.intro || '')}</p>
      ${sec.buttonLinks && sec.buttonLinks.ctaEnabled ? `<a class="btn-primary section-custom-cta" href="#/${escapeHtml(sec.buttonLinks.cta || 'contact')}" style="background:${escapeHtml(secColors.accent || '#D9582B')}">${escapeHtml(sec.buttonLinks.ctaLabel || 'Enquire Now')}</a>` : ''}
    `;
    view.appendChild(head);
    const sectionCta = head.querySelector('.section-custom-cta');
    if(sectionCta) sectionCta.addEventListener('click', function(e){ e.preventDefault(); openConfiguredDestination((sec.buttonLinks && sec.buttonLinks.cta) || '#/contact'); });

    // Tours category is a custom-trip enquiry pathway, not a grid of fixed packages.
    // Match the route and the actual section metadata to handle older saved content too.
    const secIdentity = [secKey, sec.key, sec.id, sec.title, sec.kicker, sec.bookType].filter(Boolean).join(' ').toLowerCase();
    if(secKey === 'tours' || sec.key === 'tours' || sec.id === 'tours' || /\btour(s)?\b|circuit tour|curated circuit/.test(secIdentity)) {
      const custom = document.createElement('section');
      custom.className = 'custom-trip-cta';
      const customCfg = state.customTrip || {};
      custom.innerHTML = `<div class="custom-trip-card" style="background:${escapeHtml(customCfg.background || '#1F4D36')};color:${escapeHtml(customCfg.text || '#ffffff')}"><span class="kicker">${escapeHtml(customCfg.kicker || 'Your journey, your way')}</span><h2>${escapeHtml(customCfg.title || 'Plan Your Trip With Us')}</h2><p>${escapeHtml(customCfg.description || 'Tell us where you want to go, when you want to travel, and what kind of experience you have in mind. We’ll help curate a trip around you.')}</p><a class="btn-primary" href="#/contact" id="customTripContactBtn" style="background:${escapeHtml(customCfg.buttonBackground || '#D9582B')};color:${escapeHtml(customCfg.buttonText || '#ffffff')}">${escapeHtml(customCfg.buttonTextLabel || 'Plan My Trip')}</a></div>`;
      custom.querySelector('#customTripContactBtn').addEventListener('click', function(e){ e.preventDefault(); const d=(customCfg.buttonUrl||'#/contact'); openConfiguredDestination(d); });
      view.appendChild(custom);
      return view;
    }

    // Subsections Filter Tabs (Interactive & Editable)
    let activeSubsection = 'all';
    const validSubsections = (sec.subsections || []).map(s => String(s || '').trim()).filter(Boolean);
    let subTabsBar = null;

    if (validSubsections.length > 0) {
      subTabsBar = document.createElement('div');
      subTabsBar.className = 'category-subsections-bar';

      function renderSubTabs() {
        subTabsBar.innerHTML = '';
        const allBtn = document.createElement('button');
        allBtn.className = 'subsec-tab-btn' + (activeSubsection === 'all' ? ' active' : '');
        allBtn.textContent = 'All (' + (sec.items || []).length + ')';
        allBtn.addEventListener('click', () => {
          activeSubsection = 'all';
          renderSubTabs();
          const sInp = view.querySelector('#categorySearchInput');
          renderCards(sInp ? sInp.value : '');
        });
        subTabsBar.appendChild(allBtn);

        validSubsections.forEach(subName => {
          const count = (sec.items || []).filter(it => (it.subsection || '').toLowerCase() === subName.toLowerCase()).length;
          const btn = document.createElement('button');
          btn.className = 'subsec-tab-btn' + (activeSubsection.toLowerCase() === subName.toLowerCase() ? ' active' : '');
          btn.textContent = subName + ' (' + count + ')';
          btn.addEventListener('click', () => {
            activeSubsection = subName;
            renderSubTabs();
            const sInp = view.querySelector('#categorySearchInput');
            renderCards(sInp ? sInp.value : '');
          });
          subTabsBar.appendChild(btn);
        });
      }

      renderSubTabs();
      view.appendChild(subTabsBar);
    }

    // Search and filter input
    const filterBar = document.createElement('div');
    filterBar.className = 'filter-bar';
    filterBar.innerHTML = `
      <input type="text" class="filter-search" placeholder="Search ${escapeHtml(sec.title || 'trips')} by name, date or cost…" id="categorySearchInput" />
      <span class="muted" style="font-size:13px;" id="itemCountLabel">${(sec.items || []).length} adventures available</span>
    `;
    view.appendChild(filterBar);

    // Trips Grid
    const grid = document.createElement('div');
    grid.className = 'trips-grid';
    grid.id = 'categoryTripsGrid';

    function renderCards(filterText=''){
      grid.innerHTML = '';
      const q = filterText.toLowerCase().trim();
      const items = (sec.items || []).filter(it => {
        if(activeSubsection !== 'all'){
          if((it.subsection || '').toLowerCase() !== activeSubsection.toLowerCase()){
            return false;
          }
        }
        if(!q) return true;
        return (it.name || '').toLowerCase().includes(q) ||
               (it.dates || '').toLowerCase().includes(q) ||
               (it.subsection || '').toLowerCase().includes(q) ||
               (it.batches || []).some(b => String(b).toLowerCase().includes(q)) ||
               (it.cost || '').toLowerCase().includes(q) ||
               (it.desc || '').toLowerCase().includes(q);
      });
      const countLabel = view.querySelector('#itemCountLabel');
      if(countLabel){
        countLabel.textContent = items.length + ' adventure' + (items.length === 1 ? '' : 's') + ' available';
      }
      if(!items.length){
        grid.innerHTML = `<p class="muted" style="grid-column:1/-1;padding:40px;text-align:center;">No matching adventures found in this category.</p>`;
        return;
      }
      items.forEach(it => {
        grid.appendChild(buildTripCardEl(it, sec));
      });
    }

    renderCards();
    const searchInp = filterBar.querySelector('#categorySearchInput');
    searchInp.addEventListener('input', (e) => renderCards(e.target.value));

    view.appendChild(grid);
    return view;
  }

  function openConfiguredDestination(destination){
    const raw = String(destination || '').trim();
    if(!raw) return false;
    if(raw.startsWith('#/')) { navigate(raw.slice(2)); return true; }
    if(raw.startsWith('/')) { navigate(raw.slice(1)); return true; }
    if(/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw) || /^tel:/i.test(raw) || /^https:\/\/wa\.me\//i.test(raw)) { window.open(raw, '_blank', 'noopener'); return true; }
    navigate(raw.replace(/^#?\/?/, '')); return true;
  }

  // --------------------------------------------------------------
  // 3. Trip Card Element (used in Home & Category views)
  // --------------------------------------------------------------
  function buildTripCardEl(item, sec){
    const card = document.createElement('div');
    card.className = 'trip-card';
    card.dataset.itemId = item.id;
    const itemColors = item.colors || {};
    if(itemColors.background) card.style.backgroundColor = itemColors.background;
    if(itemColors.text) card.style.color = itemColors.text;
    if(itemColors.heading) card.style.setProperty('--trip-heading-color', itemColors.heading);
    if(itemColors.buttonBackground) card.style.setProperty('--trip-button-bg', itemColors.buttonBackground);
    if(itemColors.buttonText) card.style.setProperty('--trip-button-text', itemColors.buttonText);

    const coverUrl = (item.coverImage && item.coverImage.url)
      ? item.coverImage.url
      : (sec.gallery && sec.gallery[0] ? (typeof sec.gallery[0] === 'string' ? sec.gallery[0] : sec.gallery[0].url) : '');

    const badgeText = item.days || (sec.bookType || bookTypeFor(sec));
    const slug = item.slug || (window.WO_slugify ? window.WO_slugify(item.name) : item.id);
    const detailRoute = (sec.key || 'treks') + '/' + slug;

    card.innerHTML = `
      <div class="trip-card-media ${item.imageFit === 'contain' ? 'fit-contain' : ''}" style="background-image:url('${escapeHtml(coverUrl)}');">
        ${badgeText ? `<span class="trip-badge">${escapeHtml(badgeText)}</span>` : ''}
      </div>
      <div class="trip-card-body">
        <h3>${escapeHtml(item.name || 'Untitled')}</h3>
        <div class="trip-card-meta">
          ${item.dates ? `<span>📅 ${escapeHtml(item.dates)}</span>` : ''}
          ${item.days ? `<span>⏱ ${escapeHtml(item.days)}</span>` : ''}
          ${item.subsection ? `<span class="trip-subsec-badge">🏷️ ${escapeHtml(item.subsection)}</span>` : ''}
        </div>
        ${(() => {
          const cardBatches = getEffectiveBatches(item);
          if(!cardBatches.length) return '';
          return `
          <div class="trip-card-batches">
            <small>⚡ Upcoming Batches:</small>
            <span>${escapeHtml(cardBatches.slice(0, 2).join(' · '))}${cardBatches.length > 2 ? ' +' + (cardBatches.length - 2) + ' more' : ''}</span>
          </div>`;
        })()}
        ${item.desc ? `<p class="trip-card-desc">${escapeHtml(item.desc)}</p>` : ''}
        <div class="trip-card-footer">
          <div class="trip-card-price">
            <strong>₹${escapeHtml(item.cost || 'On request')}</strong>
            <small>per person</small>
          </div>
          <div class="trip-card-actions">
            <button class="btn-ghost mini" data-action="view-trip">Details</button>
            <button class="book-now mini" data-action="book-card-item">Book Now</button>
          </div>
        </div>
      </div>
    `;

    const cardBody = card.querySelector('.trip-card-body');
    if(itemColors.background && cardBody) cardBody.style.backgroundColor = itemColors.background;
    if(itemColors.text && cardBody) cardBody.style.color = itemColors.text;
    const detailsBtn = card.querySelector('[data-action="view-trip"]');
    const bookBtn = card.querySelector('[data-action="book-card-item"]');
    if(itemColors.buttonBackground){ detailsBtn.style.backgroundColor=itemColors.buttonBackground; bookBtn.style.backgroundColor=itemColors.buttonBackground; }
    if(itemColors.buttonText){ detailsBtn.style.color=itemColors.buttonText; bookBtn.style.color=itemColors.buttonText; }
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if(e.target.closest('button') || e.target.closest('a')) return;
      const dest = (item.buttonLinks && item.buttonLinks.details) || '';
      if(dest) openConfiguredDestination(dest); else navigate(detailRoute);
    });
    detailsBtn.addEventListener('click', () => {
      const dest = (item.buttonLinks && item.buttonLinks.details) || '';
      if(dest) openConfiguredDestination(dest); else navigate(detailRoute);
    });
    bookBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dest = (item.buttonLinks && item.buttonLinks.book) || '';
      if(dest) openConfiguredDestination(dest); else bookThis(sec.key, item.id, item);
    });

    return card;
  }

  // --------------------------------------------------------------
  // 4. Dedicated Trip Detail View (NO EMPTY BLOCKS)
  // --------------------------------------------------------------
  function buildTripDetailView(tripObj){
    const view = document.createElement('div');
    view.className = 'trip-detail-wrap wrap';

    if(!tripObj || !tripObj.item){
      view.innerHTML = `
        <div style="padding:80px 20px;text-align:center;">
          <h2>Adventure Not Found</h2>
          <p class="muted">The requested trip could not be found or has been moved.</p>
          <button class="btn-primary" onclick="window.history.back()">Back</button>
        </div>
      `;
      return view;
    }

    const item = tripObj.item;
    const sec  = tripObj.sec;
    const vis  = item.visibility || {};

    // Breadcrumbs
    view.appendChild(buildBreadcrumbsEl([
      { title: 'Home', path: '' },
      { title: sec.title || sec.kicker || sec.key, path: sec.key },
      { title: item.name }
    ]));

    // Trip Hero Banner
    const coverUrl = (item.coverImage && item.coverImage.url)
      ? item.coverImage.url
      : (sec.gallery && sec.gallery[0] ? (typeof sec.gallery[0] === 'string' ? sec.gallery[0] : sec.gallery[0].url) : '');

    const hero = document.createElement('div');
    hero.className = 'trip-hero' + (item.imageFit === 'contain' ? ' fit-contain' : '');
    if(coverUrl){
      hero.style.backgroundImage = `url('${coverUrl}')`;
      hero.style.cursor = 'pointer';
      hero.title = 'Click to view full photo';
      hero.addEventListener('click', (e) => {
        if(e.target.closest('button') || e.target.closest('a')) return;
        if(typeof openLightbox === 'function') openLightbox(coverUrl);
      });
    }
    hero.innerHTML = `
      <div class="trip-hero-overlay"></div>
      <div class="trip-hero-content">
        <span class="kicker">${escapeHtml(sec.kicker || bookTypeFor(sec))}</span>
        <h1>${escapeHtml(item.name)}</h1>
        <div class="trip-pills-bar">
          ${item.cost ? `<span>💰 ₹${escapeHtml(item.cost)}</span>` : ''}
          ${item.days ? `<span>⏱ ${escapeHtml(item.days)}</span>` : ''}
          ${item.dates ? `<span>📅 ${escapeHtml(item.dates)}</span>` : ''}
          ${item.subsection ? `<span>🏷️ ${escapeHtml(item.subsection)}</span>` : ''}
          ${item.pickup ? `<span>📍 ${escapeHtml(item.pickup)}</span>` : ''}
        </div>
      </div>
    `;
    view.appendChild(hero);

    // Main 2-column layout (Left: content blocks, Right: sticky booking card)
    const grid = document.createElement('div');
    grid.className = 'trip-main-grid';

    // Left Column: Content Blocks
    const leftCol = document.createElement('div');
    leftCol.className = 'trip-content-col';

    // Gallery Block (NO EMPTY BLOCKS)
    const galleryImgs = (item.gallery && item.gallery.length)
      ? item.gallery.map(g => (typeof g === 'string' ? g : g.url)).filter(Boolean)
      : [];
    if(vis.gallery !== false && galleryImgs.length > 0){
      const galBlock = document.createElement('div');
      galBlock.className = 'trip-block';
      galBlock.innerHTML = `<h3>📸 Photo Gallery</h3>`;
      const galGrid = document.createElement('div');
      galGrid.className = 'gallery';
      galleryImgs.forEach((src, idx) => {
        const ph = document.createElement('div');
        ph.className = 'ph';
        ph.style.backgroundImage = `url('${src}')`;
        ph.addEventListener('click', () => openLightbox(src, galleryImgs));
        galGrid.appendChild(ph);
      });
      galBlock.appendChild(galGrid);
      leftCol.appendChild(galBlock);
    }

    // Description Block (NO EMPTY BLOCKS)
    if(vis.description !== false && item.desc && item.desc.trim()){
      const descBlock = document.createElement('div');
      descBlock.className = 'trip-block';
      descBlock.innerHTML = `
        <h3>🏔 Overview</h3>
        <p>${escapeHtml(item.desc)}</p>
      `;
      leftCol.appendChild(descBlock);
    }

    // Upcoming Batches & Schedule Block
    const batches = getEffectiveBatches(item);
    if(batches.length > 0){
      const batchBlock = document.createElement('div');
      batchBlock.className = 'trip-block';
      batchBlock.innerHTML = `
        <h3>📅 Upcoming Departure Batches</h3>
        <p class="muted" style="font-size:13.5px;margin-bottom:14px;">Select from our scheduled departure dates below to reserve your spot.</p>
        <div class="batch-list-grid">
          ${batches.map(b => `
            <div class="batch-row" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg-soft,#f7f5f0);border-radius:10px;border:1px solid var(--line);margin-bottom:8px;gap:12px;flex-wrap:wrap;">
              <div>
                <strong style="color:var(--forest,#1F4D36);font-size:14px;">📅 ${escapeHtml(b)}</strong>
                ${item.pickup ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">⏱ ${escapeHtml(item.days || 'Guided adventure')} · 📍 ${escapeHtml(item.pickup)}</div>` : (item.days ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">⏱ ${escapeHtml(item.days)}</div>` : '')}
              </div>
              <button class="btn-primary mini book-batch-direct-btn" data-batch="${escapeHtml(b)}" style="padding:7px 16px;font-size:12.5px;">Book This Batch ▸</button>
            </div>
          `).join('')}
        </div>
      `;
      batchBlock.querySelectorAll('.book-batch-direct-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const bVal = btn.dataset.batch;
          bookThis(sec.key, item.id, item, bVal);
        });
      });
      leftCol.appendChild(batchBlock);
    }

    // Highlights Block (NO EMPTY BLOCKS)
    const hls = Array.isArray(item.highlights) ? item.highlights.filter(Boolean) : [];
    if(vis.highlights !== false && hls.length > 0){
      const hlBlock = document.createElement('div');
      hlBlock.className = 'trip-block';
      hlBlock.innerHTML = `
        <h3>✨ Trip Highlights</h3>
        <ul class="highlights-list">
          ${hls.map(h => `<li>${escapeHtml(h)}</li>`).join('')}
        </ul>
      `;
      leftCol.appendChild(hlBlock);
    }

    // Itinerary Block (NO EMPTY BLOCKS)
    const itin = Array.isArray(item.itinerary) ? item.itinerary.filter(it => it && (it.title || it.desc)) : [];
    if(vis.itinerary !== false && itin.length > 0){
      const itinBlock = document.createElement('div');
      itinBlock.className = 'trip-block';
      itinBlock.innerHTML = `
        <h3>🗺 Detailed Itinerary</h3>
        <div class="itinerary-list">
          ${itin.map(d => `
            <div class="itinerary-item">
              <span class="day-tag">${escapeHtml(d.day || 'Day')}</span>
              <h4>${escapeHtml(d.title || '')}</h4>
              <p>${escapeHtml(d.desc || '')}</p>
            </div>
          `).join('')}
        </div>
      `;
      leftCol.appendChild(itinBlock);
    }

    // Inclusions & Exclusions Block (NO EMPTY BLOCKS)
    const incs = Array.isArray(item.inclusions) ? item.inclusions.filter(Boolean) : [];
    const excs = Array.isArray(item.exclusions) ? item.exclusions.filter(Boolean) : [];
    const hasInc = vis.inclusions !== false && incs.length > 0;
    const hasExc = vis.exclusions !== false && excs.length > 0;
    if(hasInc || hasExc){
      const incBlock = document.createElement('div');
      incBlock.className = 'trip-block';
      incBlock.innerHTML = `
        <h3>📋 Inclusions &amp; Exclusions</h3>
        <div class="incl-excl-grid">
          ${hasInc ? `
            <div class="incl-box">
              <h4>Included in Package</h4>
              <ul>${incs.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
            </div>
          ` : ''}
          ${hasExc ? `
            <div class="excl-box">
              <h4>Not Included</h4>
              <ul>${excs.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
            </div>
          ` : ''}
        </div>
      `;
      leftCol.appendChild(incBlock);
    }

    // Things to Carry Block (NO EMPTY BLOCKS)
    const gear = Array.isArray(item.thingsToCarry) ? item.thingsToCarry.filter(Boolean) : [];
    if(vis.thingsToCarry !== false && gear.length > 0){
      const carryBlock = document.createElement('div');
      carryBlock.className = 'trip-block';
      carryBlock.innerHTML = `
        <h3>🎒 Things to Carry</h3>
        <div class="carry-grid">
          ${gear.map(g => `<span class="carry-pill">${escapeHtml(g)}</span>`).join('')}
        </div>
      `;
      leftCol.appendChild(carryBlock);
    }

    // Trip FAQs Block (NO EMPTY BLOCKS)
    const faqs = Array.isArray(item.faqs) ? item.faqs.filter(f => f && (f.q || f.a)) : [];
    if(vis.faq !== false && faqs.length > 0){
      const faqBlock = document.createElement('div');
      faqBlock.className = 'trip-block';
      faqBlock.innerHTML = `
        <h3>❓ Frequently Asked Questions</h3>
        <div class="faq-wrap">
          ${faqs.map(f => `
            <details class="faq-card">
              <summary>${escapeHtml(f.q)}</summary>
              <div class="faq-answer">${escapeHtml(f.a)}</div>
            </details>
          `).join('')}
        </div>
      `;
      leftCol.appendChild(faqBlock);
    }



    // Payment Info Block (NO EMPTY BLOCKS)
    if(vis.payment !== false){
      const payBlock = document.createElement('div');
      payBlock.className = 'trip-block';
      // Use the item's configured payment settings, falling back to global booking config.
      const itemPay = item.payment || {};
      const globalBk = state.booking || {};
      const payUpiId = itemPay.upiId || globalBk.upiId || '7387778296@upi';
      const payInstructions = itemPay.instructions || globalBk.instructions || 'Bookings are accepted via UPI, Google Pay, PhonePe or Bank Transfer. Verification is completed by our coordinators on WhatsApp within 24 hours.';
      const payQr = itemPay.qrImage || globalBk.qrImage || '';

      payBlock.innerHTML = `
        <h3>💳 Payment &amp; Confirmation</h3>
        <p>${escapeHtml(payInstructions)}</p>
        <div style="background:var(--bg-soft);padding:14px 18px;border-radius:10px;font-size:14px;border:1px dashed var(--line);margin-top:10px;">
          <div><strong>UPI ID:</strong> <code>${escapeHtml(payUpiId)}</code></div>
          <div style="margin-top:4px;"><strong>Coordinator Phone:</strong> +91 ${escapeHtml((state.contact.whatsapp||'7387778296').replace(/\D/g,''))}</div>
          ${payQr ? `<div style="margin-top:10px;text-align:center;"><img src="${escapeHtml(payQr)}" alt="UPI QR Code" class="payment-qr-image" style="width:min(100%, 220px);height:auto;aspect-ratio:1/1;max-width:220px;object-fit:contain;background:#fff;padding:8px;border-radius:10px;border:1px solid #ddd;display:block;margin-inline:auto;" /></div>` : ''}
        </div>
      `;
      leftCol.appendChild(payBlock);
    }

    grid.appendChild(leftCol);

    // Right Column: Sticky Booking Sidebar
    const rightCol = document.createElement('div');
    rightCol.className = 'trip-sidebar';

    if(vis.booking !== false){
      const bookCard = document.createElement('div');
      bookCard.className = 'trip-book-card';
      bookCard.innerHTML = `
        <div class="price-row">
          <div>
            <div style="font-size:12px;color:var(--muted);text-transform:uppercase;font-weight:700;">Price per seat</div>
            <div class="cost">₹${escapeHtml(item.cost || 'On request')} <small>INR</small></div>
          </div>
          <span class="receipt-status-tag status-paid" style="font-size:11px;">Verified Guide</span>
        </div>
        <div style="margin-bottom:18px;font-size:13.5px;color:var(--muted);">
          <div>📅 <strong>Dates:</strong> ${escapeHtml(item.dates || 'Regular batches')}</div>
          ${item.subsection ? `<div style="margin-top:6px;">🏷️ <strong>Category:</strong> ${escapeHtml(item.subsection)}</div>` : ''}
          ${(batches && batches.length > 0) ? `
            <div style="margin-top:10px;">
              <label for="detailBatchSelect" style="display:block;font-size:11.5px;font-weight:700;color:var(--forest,#1F4D36);text-transform:uppercase;margin-bottom:4px;">Select Preferred Batch:</label>
              <select id="detailBatchSelect" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;color:var(--text);font-family:inherit;">
                ${batches.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}
              </select>
            </div>
          ` : ''}
          <div style="margin-top:8px;">⏱ <strong>Duration:</strong> ${escapeHtml(item.days || 'Guided trip')}</div>
          ${item.pickup ? `<div style="margin-top:4px;">📍 <strong>Pick-up / Meeting Point:</strong> ${escapeHtml(item.pickup)}</div>` : ''}
        </div>
        <button class="btn-primary trip-book-cta" id="detailBookBtn">Book This Adventure ▸</button>
        <div class="trip-sidebar-wa">
          Or <a href="https://wa.me/${escapeHtml((state.contact.whatsapp||'917387778296').replace(/\D/g,''))}?text=${encodeURIComponent('Hi, I am interested in ' + item.name + ' (' + (item.dates||'') + '). Please share details.')}" target="_blank" rel="noopener" style="color:#128c3e;font-weight:700;">Chat on WhatsApp</a>
        </div>
      `;
      bookCard.querySelector('#detailBookBtn').addEventListener('click', () => {
        const batchSelect = bookCard.querySelector('#detailBatchSelect');
        const selectedBatch = batchSelect ? batchSelect.value : '';
        bookThis(sec.key, item.id, item, selectedBatch);
      });
      rightCol.appendChild(bookCard);
    }

    grid.appendChild(rightCol);
    view.appendChild(grid);
    return view;
  }

  // --------------------------------------------------------------
  // 5. Gallery & Highlights View
  // --------------------------------------------------------------
  function buildGalleryView(){
    const view = document.createElement('div');
    view.className = 'view-gallery wrap';
    view.appendChild(buildBreadcrumbsEl([
      { title: 'Home', path: '' },
      { title: 'Highlights & Gallery' }
    ]));
    view.appendChild(buildHighlightsSectionEl());
    return view;
  }

  function buildHighlightsSectionEl(){
    const sec = document.createElement('section');
    sec.className = 'highlights';
    sec.id = 'highlights';
    sec.innerHTML = `
      <div class="wrap">
        <span class="kicker light" data-edit="highlights.kicker">${escapeHtml(state.highlights.kicker || 'Highlights')}</span>
        <h2 data-edit="highlights.title">${escapeHtml(state.highlights.title || 'Trips on film.')}</h2>
        <p data-edit="highlights.subtitle">${escapeHtml(state.highlights.subtitle || 'A taste of the trails, summits and sunsets our travellers experience.')}</p>
        <div class="video-grid" id="videoGrid"></div>
        <button class="btn-ghost light admin-only" id="addVideoBtn" style="margin-top:16px;">+ Add highlight</button>
      </div>
    `;

    const grid = sec.querySelector('#videoGrid');
    (state.highlights.items || []).forEach((hl, idx) => {
      const c = document.createElement('div');
      c.className = 'vc';
      c.dataset.idx = idx;

      if(hl.type === 'ig' && hl.code){
        const iframe = document.createElement('iframe');
        iframe.src = `https://www.instagram.com/p/${hl.code}/embed/`;
        iframe.allowTransparency = true;
        c.appendChild(iframe);
      } else if(hl.type === 'yt' && hl.videoId){
        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube.com/embed/${hl.videoId}`;
        iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
        c.appendChild(iframe);
      } else if(hl.type === 'video' && hl.src){
        const v = document.createElement('video');
        v.src = hl.src;
        v.controls = true;
        c.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.className = 'vc-img';
        img.src = hl.src || PH.trek;
        img.alt = hl.caption || '';
        c.appendChild(img);
        const play = document.createElement('div');
        play.className = 'vc-play';
        play.textContent = '▶';
        c.appendChild(play);
      }

      if(hl.caption){
        const cap = document.createElement('div');
        cap.className = 'vc-caption';
        cap.textContent = hl.caption;
        c.appendChild(cap);
      }

      c.addEventListener('click', (e) => {
        if(document.body.classList.contains('admin-mode')){
          if(confirm('Remove this highlight?')){
            state.highlights.items.splice(idx, 1);
            saveState();
            renderActiveView();
          }
          return;
        }
        openLightbox(hl.src || hl);
      });
      grid.appendChild(c);
    });

    const addBtn = sec.querySelector('#addVideoBtn');
    if(addBtn) addBtn.addEventListener('click', () => addHighlight());
    return sec;
  }

  function addHighlight(){
    openModal({
      title:'Add highlight',
      fields:[
        { key:'type', label:'Type (photo / video / yt / ig)', placeholder:'photo' },
        { key:'src',  label:'Image / Video URL', placeholder:'https://…' },
        { key:'videoId', label:'YouTube Video ID (if type=yt)', placeholder:'dQw4w9WgXcQ' },
        { key:'code', label:'Instagram shortcode (if type=ig)', placeholder:'Cxxxxxx' },
        { key:'caption', label:'Caption' }
      ],
      onSave:(vals)=>{
        const item = {
          id: h('hl'),
          type: vals.type || 'photo',
          caption: vals.caption || ''
        };
        if(item.type === 'photo') item.src = vals.src;
        else if(item.type === 'video') item.src = vals.src;
        else if(item.type === 'yt') item.videoId = vals.videoId;
        else if(item.type === 'ig') item.code = vals.code;
        (state.highlights.items = state.highlights.items || []).push(item);
        saveState();
        renderActiveView();
      }
    });
  }

  // --------------------------------------------------------------
  // 6. Reviews View & Google Reviews Integration
  // --------------------------------------------------------------
  function buildReviewsView(){
    const view = document.createElement('div');
    view.className = 'view-reviews wrap';
    view.appendChild(buildBreadcrumbsEl([
      { title: 'Home', path: '' },
      { title: 'Traveller Reviews' }
    ]));

    // Header — reviews view has no specific section config; use empty colors object as safe default
    const secColors = {};
    const head = document.createElement('div');
    head.className = 'category-header';
    head.innerHTML = `
      <span class="kicker">Verified Feedback</span>
      <h1>What our travellers say.</h1>
      <p>Stories from summit climbs, valley crossings and winter night camps with The Wanderer Outdoors.</p>
    `;
    view.appendChild(head);

    // Google Reviews Integration Banner
    view.appendChild(buildGoogleReviewsBannerEl());

    // Approved Customer Testimonials Grid (manual, clearly labelled)
    const manualWrap = document.createElement('div');
    if((state.reviews || []).length || g_showManual()){
      const sub = document.createElement('h3');
      sub.style.cssText = 'font-size:20px;margin:8px 0 4px;';
      sub.textContent = 'Verified Customer Testimonials';
      manualWrap.appendChild(sub);
    }
    const revGrid = document.createElement('div');
    revGrid.className = 'review-grid';
    revGrid.style.cssText = 'margin:18px 0 40px;';

    const revs = (state.reviews || []).filter(r => r && (r.text || r.name));
    revs.forEach(rv => {
      const card = document.createElement('div');
      card.className = 'review-card';
      if(rv.photo){
        const im = document.createElement('img');
        im.className = 'review-photo';
        im.src = rv.photo;
        im.alt = rv.name || '';
        card.appendChild(im);
      }
      const p = document.createElement('p');
      p.className = 'review-text';
      p.textContent = '“' + (rv.text || '') + '”';
      card.appendChild(p);
      const by = document.createElement('div');
      by.className = 'review-by';
      by.innerHTML = `<strong>${escapeHtml(rv.name||'Explorer')}</strong> <span class="muted">${escapeHtml(rv.role ? '· ' + rv.role : '')}</span>`;
      card.appendChild(by);
      revGrid.appendChild(card);
    });
    manualWrap.appendChild(revGrid);
    view.appendChild(manualWrap);

    // Optional LIVE Google Reviews section (server-proxied, never exposes a key)
    const g = state.googleReviews || {};
    if(g.enabled && g.method === 'places' && g.placeId){
      const liveWrap = document.createElement('div');
      liveWrap.className = 'google-live-reviews';
      liveWrap.style.cssText = 'margin:10px 0 60px;';
      liveWrap.innerHTML = `
        <h3 style="font-size:20px;margin:0 0 4px;">Google Reviews</h3>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span class="google-stars" style="font-size:18px;color:#EA4335;">★★★★★</span>
          <span class="muted" id="gCount">loading…</span>
        </div>
        <div id="gReviewsGrid" class="review-grid" style="margin:0;"></div>
        <div id="gReviewsState" class="muted" style="margin-top:12px;font-size:13px;line-height:1.5;"></div>`;
      view.appendChild(liveWrap);
      setTimeout(() => loadGoogleReviewsInto(liveWrap), 40);
    }

    return view;
  }

  function g_showManual(){
    const g = state.googleReviews || {};
    return g.showManual !== false;
  }

  // Fetches live Google reviews from the server proxy (/api/google-reviews).
  // The Google API key is NEVER sent to the browser — it lives in the server
  // environment (.env). We handle loading / empty / error / unavailable states
  // honestly and always fall back to the manual testimonials + Google link.
  function loadGoogleReviewsInto(wrap){
    if(!wrap) return;
    const g = state.googleReviews || {};
    const grid = wrap.querySelector('#gReviewsGrid');
    const stateEl = wrap.querySelector('#gReviewsState');
    const countEl = wrap.querySelector('#gCount');
    if(!g.placeId){
      if(countEl) countEl.textContent = '';
      if(stateEl) stateEl.textContent = 'Google reviews are not configured yet.';
      return;
    }
    const limit = g.limit || 5;
    fetch('/api/google-reviews?placeId=' + encodeURIComponent(g.placeId) + '&limit=' + encodeURIComponent(limit))
      .then(r => {
        const ct = r.headers && r.headers.get ? r.headers.get('content-type') : '';
        if(!r.ok || !ct || ct.indexOf('application/json') === -1) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        const reviews = (data && data.reviews) || [];
        if(countEl) countEl.textContent = (data.rating ? data.rating + ' · ' : '') + reviews.length + ' shown';
        if(!reviews.length){
          if(stateEl) stateEl.textContent = 'No Google reviews to display right now — but you can leave one from the button above.';
          return;
        }
        reviews.forEach(rv => {
          const c = document.createElement('div');
          c.className = 'review-card';
          const stars = rv.rating ? '★ '.repeat(Math.max(1, Math.min(5, rv.rating))) : '';
          c.innerHTML = `
            <p class="review-text">“${escapeHtml(rv.text || '')}”</p>
            <div class="review-by">
              <strong>${escapeHtml(rv.author_name || 'Google User')}</strong>
              <span class="muted">${stars ? escapeHtml(stars.trim()) + ' · ' : ''}Google</span>
            </div>`;
          grid.appendChild(c);
        });
        if(stateEl) stateEl.textContent = 'Reviews sourced live from Google' + (g.attribution ? ' · ' + escapeHtml(g.attribution) : '') + '.';
      })
      .catch(err => {
        if(countEl) countEl.textContent = 'unavailable';
        if(stateEl) stateEl.textContent = 'Live Google reviews are temporarily unavailable (the server proxy may not be deployed or the Place ID may be incorrect). Your manual testimonials above remain visible. (' + (err && err.message ? err.message : 'network error') + ')';
      });
  }

  function buildGoogleReviewsBannerEl(){
    const g = state.googleReviews || {};
    const banner = document.createElement('div');
    banner.className = 'google-reviews-banner';
    const placeId = g.placeId || '';
    const reviewUrl = g.reviewUrl || (placeId ? `https://search.google.com/local/writereview?placeid=${placeId}` : 'https://www.google.com/maps/search/The+Wanderer+Outdoors');

    const scoreHtml = g.rating
      ? `<div style="display:flex;align-items:center;gap:10px;">
            <span class="google-score">${escapeHtml(g.rating)}</span>
            <span class="google-stars">★★★★★</span>
          </div>`
      : `<div class="google-stars" style="font-size:22px;">★★★★★</div>`;

    banner.innerHTML = `
      <div class="google-reviews-badge">
        <svg viewBox="0 0 24 24" width="36" height="36" style="flex:none;"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
        <div>
          ${scoreHtml}
          <div class="google-caption">${g.rating ? 'Google Business Rating' : 'Reviews on Google'}</div>
        </div>
      </div>
      <div>
        <a href="${escapeHtml(reviewUrl)}" target="_blank" rel="noopener" class="btn-ghost" style="font-weight:700;">⭐ Review Us on Google</a>
      </div>
    `;
    return banner;
  }

  function buildReviewsTeaserEl(){
    const sec = document.createElement('section');
    sec.className = 'reviews';
    sec.style.cssText = 'padding:60px 0;background:var(--bg-soft);';
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <div>
          <span class="kicker">Testimonials</span>
          <h2 style="margin:0;font-size:clamp(26px,3.5vw,36px);">Real stories from the trails.</h2>
        </div>
        <a href="#/reviews" class="btn-ghost" id="viewAllReviewsBtn">See all reviews ▸</a>
      </div>
    `;
    const btn = wrap.querySelector('#viewAllReviewsBtn');
    if(btn) btn.addEventListener('click', (e) => { e.preventDefault(); navigate('reviews'); });

    const grid = document.createElement('div');
    grid.className = 'review-grid';
    (state.reviews || []).slice(0, 3).forEach(rv => {
      const c = document.createElement('div');
      c.className = 'review-card';
      c.innerHTML = `
        <p class="review-text">“${escapeHtml(rv.text || '')}”</p>
        <div class="review-by">
          <strong>${escapeHtml(rv.name || 'Explorer')}</strong>
          <span class="muted">${escapeHtml(rv.role ? '· ' + rv.role : '')}</span>
        </div>
      `;
      grid.appendChild(c);
    });
    wrap.appendChild(grid);
    sec.appendChild(wrap);
    return sec;
  }

  // --------------------------------------------------------------
  // 7. Blog System
  // --------------------------------------------------------------
  function buildBlogListView(){
    const view = document.createElement('div');
    view.className = 'view-blog wrap';
    view.appendChild(buildBreadcrumbsEl([
      { title: 'Home', path: '' },
      { title: 'Blog & Trail Guides' }
    ]));

    const secColors = {};
    const head = document.createElement('div');
    head.className = 'category-header';
    head.innerHTML = `
      <span class="kicker">Mountain Journal</span>
      <h1>Trail Guides &amp; Outdoor Stories</h1>
      <p>Practical trekking tips, gear packing lists, monsoon safety and Himalayan trail insights.</p>
    `;
    view.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'blog-grid';
    (state.blogs || []).filter(b => b.published !== false).forEach(b => {
      const card = document.createElement('div');
      card.className = 'blog-card';
      card.innerHTML = `
        <div class="blog-card-media" style="background-image:url('${escapeHtml((b.coverImage && b.coverImage.url ? b.coverImage.url : b.coverImage) || PH.trek)}');"></div>
        <div class="blog-card-body">
          <span class="blog-tag">${escapeHtml(b.category || 'Trail Guide')}</span>
          <h3>${escapeHtml(b.title)}</h3>
          <p>${escapeHtml(b.excerpt || '')}</p>
          <div class="blog-meta">
            <span>⏱ ${escapeHtml(b.readingTime || '4 min read')}</span>
            <span>📅 ${escapeHtml(b.date || '')}</span>
          </div>
        </div>
      `;
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => navigate('blog/' + (b.slug || b.id)));
      grid.appendChild(card);
    });
    view.appendChild(grid);
    return view;
  }

  function buildBlogArticleView(article){
    const view = document.createElement('div');
    view.className = 'view-blog-article wrap';

    if(!article){
      view.innerHTML = `<p class="muted" style="padding:60px;text-align:center;">Article not found.</p>`;
      return view;
    }

    view.appendChild(buildBreadcrumbsEl([
      { title: 'Home', path: '' },
      { title: 'Blog', path: 'blog' },
      { title: article.title }
    ]));

    const art = document.createElement('article');
    art.className = 'blog-article';
    art.innerHTML = `
      <div style="margin-bottom:20px;">
        <span class="blog-tag">${escapeHtml(article.category || 'Adventure Guide')}</span>
        <h1 style="font-size:clamp(28px,4.5vw,44px);margin:10px 0 14px;letter-spacing:-.5px;line-height:1.2;">${escapeHtml(article.title)}</h1>
        <div style="font-size:13.5px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap;">
          <span>By <strong>${escapeHtml(article.author || 'The Wanderer Outdoors')}</strong></span>
          <span>📅 ${escapeHtml(article.date || '')}</span>
          <span>⏱ ${escapeHtml(article.readingTime || '5 min read')}</span>
        </div>
      </div>
      ${article.excerpt ? `<p class="blog-article-excerpt" style="font-size:17px;line-height:1.7;color:var(--muted);margin:0 0 22px;">${escapeHtml(article.excerpt)}</p>` : ''}
      ${article.coverImage ? `<div class="blog-article-hero" style="background-image:url('${escapeHtml(article.coverImage && article.coverImage.url ? article.coverImage.url : article.coverImage)}');"></div>` : ''}
      <div class="blog-article-body">
        ${formatSimpleMarkdown(article.content || '')}
      </div>
      <div style="margin-top:40px;padding-top:24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <button class="btn-ghost" id="blogBackBtn">${escapeHtml((state.buttonLinks && state.buttonLinks.blogBackLabel) || '← Back to Articles')}</button>
        <button class="btn-primary" id="blogCtaBtn">${escapeHtml((state.buttonLinks && state.buttonLinks.blogCtaLabel) || 'Plan a Trip with Us')}</button>
      </div>
    `;
    art.querySelector('#blogBackBtn').addEventListener('click', () => window.history.back());
    art.querySelector('#blogCtaBtn').addEventListener('click', (e) => {
      e.preventDefault();
      openConfiguredDestination((state.buttonLinks && state.buttonLinks.blogCtaHref) || '#/contact');
    });
    view.appendChild(art);
    return view;
  }

  function formatSimpleMarkdown(md){
    if(!md) return '';
    // Escape first; support the simple Markdown commonly entered in Control Room.
    const lines = escapeHtml(String(md)).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let paragraph = [];
    let list = [];
    const flushParagraph = () => {
      if(paragraph.length){
        out.push('<p>' + paragraph.join('<br>') + '</p>');
        paragraph = [];
      }
    };
    const flushList = () => {
      if(list.length){ out.push('<ul>' + list.map(item => '<li>' + item + '</li>').join('') + '</ul>'); list = []; }
    };
    lines.forEach(line => {
      const trimmed = line.trim();
      if(!trimmed){ flushParagraph(); flushList(); return; }
      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      const bullet = trimmed.match(/^[-*]\s+(.+)$/);
      if(heading){
        flushParagraph(); flushList();
        const level = Math.min(heading[1].length + 1, 4);
        out.push('<h' + level + '>' + heading[2] + '</h' + level + '>');
      } else if(bullet){
        flushParagraph(); list.push(bullet[1]);
      } else {
        flushList(); paragraph.push(trimmed);
      }
    });
    flushParagraph(); flushList();
    return out.join('\n').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  // --------------------------------------------------------------
  // 8. FAQ View
  // --------------------------------------------------------------
  function buildFaqView(){
    const view = document.createElement('div');
    view.className = 'view-faq wrap';
    view.appendChild(buildBreadcrumbsEl([
      { title: 'Home', path: '' },
      { title: 'Frequently Asked Questions' }
    ]));

    const secColors = {};
    const head = document.createElement('div');
    head.className = 'category-header';
    head.innerHTML = `
      <span class="kicker">Help &amp; Guidelines</span>
      <h1>Frequently Asked Questions</h1>
      <p>Everything you need to know about preparation, booking, safety, and payments.</p>
    `;
    view.appendChild(head);

    const faqWrap = document.createElement('div');
    faqWrap.style.cssText = 'max-width:820px;margin:0 auto 60px;';

    const faqs = state.faqs || DEFAULT_STATE.faqs;
    faqs.forEach(f => {
      const card = document.createElement('details');
      card.className = 'faq-card';
      card.innerHTML = `
        <summary>${escapeHtml(f.q)}</summary>
        <div class="faq-answer">${escapeHtml(f.a)}</div>
      `;
      faqWrap.appendChild(card);
    });
    view.appendChild(faqWrap);
    return view;
  }

  // --------------------------------------------------------------
  // 9. Contact View
  // --------------------------------------------------------------
  function buildContactView(){
    const view = document.createElement('div');
    view.className = 'view-contact wrap';
    view.appendChild(buildBreadcrumbsEl([
      { title: 'Home', path: '' },
      { title: 'Contact' }
    ]));

    const c = state.contact || DEFAULT_STATE.contact;
    const wa = (c.whatsapp || '917387778296').replace(/\D/g,'');

    const sec = document.createElement('section');
    sec.className = 'contact';
    sec.id = 'contact';
    sec.innerHTML = `
      <div class="wrap contact-grid">
        <div>
          <span class="kicker" data-edit="contact.kicker">${escapeHtml(c.kicker)}</span>
          <h2 data-edit="contact.title">${escapeHtml(c.title)}</h2>
          <p data-edit="contact.intro">${escapeHtml(c.intro)}</p>
        </div>
        <div class="contact-info">
          <p><strong>Phone / WhatsApp:</strong> <a class="wa-inline" href="https://wa.me/${wa}" target="_blank" rel="noopener"><span data-edit="contact.phone">${escapeHtml(c.phone)}</span></a></p>
          <p><strong>Email:</strong> <span data-edit="contact.email">${escapeHtml(c.email)}</span></p>
          <p><strong>Instagram:</strong> <a href="${escapeHtml(c.instagramUrl || 'https://www.instagram.com/the_wanderer_outdoors/')}" target="_blank" rel="noopener"><span data-edit="contact.instagram">${escapeHtml(c.instagram)}</span></a></p>
          <p><strong>Based in:</strong> <span data-edit="contact.city">${escapeHtml(c.city)}</span></p>
          <p style="margin-top:20px;">
            <a class="wa-btn wa-big" href="https://wa.me/${wa}" target="_blank" rel="noopener">
              <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 4C9.96 4 5.02 8.94 5.02 15.02c0 2.2.6 4.26 1.64 6.02L5 28l7.1-1.62a11 11 0 0 0 3.94.72h.01C22.12 27.1 27 22.15 27 16.08 27 9.98 22.1 4 16.04 4zm0 2.2c3.83 0 6.94 3.12 6.94 6.95 0 3.83-3.11 6.94-6.94 6.94-1.2 0-2.36-.3-3.37-.87l-.48-.27-4.03 1.03 1.08-3.93-.31-.5a6.9 6.9 0 0 1-1.06-3.7c0-3.83 3.11-6.65 7.17-6.65zM12.9 10.3c-.2 0-.5.07-.76.36-.27.28-1.02 1-.99 2.43.03 1.44 1.05 2.83 1.2 3.03.14.19 2.02 3.3 5.02 4.5 2.48.99 2.99.79 3.53.74.54-.05 1.75-.72 2-1.41.25-.69.25-1.28.18-1.4-.07-.13-.26-.2-.54-.35-.28-.14-1.65-.81-1.9-.9-.26-.09-.44-.14-.63.14-.19.28-.72.9-.89 1.08-.16.19-.33.21-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.94-.16-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.16.19-.28.28-.47.1-.19.05-.35-.02-.5-.07-.14-.62-1.55-.87-2.1-.22-.55-.45-.46-.62-.47l-.56-.01z"/></svg>
              <span>Chat on WhatsApp — ${escapeHtml(wa.replace(/^91/,''))}</span>
            </a>
          </p>
          <form id="generalEnquiryForm" style="margin-top:24px;display:grid;gap:12px;max-width:560px;">
            <h3 style="margin:0;">Send us an enquiry</h3>
            <label>Your name<input name="name" autocomplete="name" required maxlength="120" style="display:block;width:100%;padding:12px;border:1px solid #cbd5cc;border-radius:8px;"></label>
            <label>Email<input name="email" type="email" autocomplete="email" maxlength="200" style="display:block;width:100%;padding:12px;border:1px solid #cbd5cc;border-radius:8px;"></label>
            <label>Phone / WhatsApp<input name="phone" type="tel" autocomplete="tel" maxlength="40" style="display:block;width:100%;padding:12px;border:1px solid #cbd5cc;border-radius:8px;"></label>
            <label>Subject<input name="subject" maxlength="160" style="display:block;width:100%;padding:12px;border:1px solid #cbd5cc;border-radius:8px;"></label>
            <label>How can we help?<textarea name="message" required maxlength="5000" rows="4" style="display:block;width:100%;padding:12px;border:1px solid #cbd5cc;border-radius:8px;"></textarea></label>
            <button type="submit" class="btn-primary" style="justify-self:start;">${escapeHtml((state.buttonLinks && state.buttonLinks.contactSubmitLabel) || 'Submit enquiry')}</button>
            <p id="generalEnquiryStatus" role="status" aria-live="polite" style="margin:0;"></p>
          </form>
        </div>
      </div>
    `;
    const enquiryForm = sec.querySelector('#generalEnquiryForm');
    enquiryForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const statusEl = sec.querySelector('#generalEnquiryStatus');
      const submitBtn = enquiryForm.querySelector('button[type="submit"]');
      const fd = new FormData(enquiryForm);
      const payload = Object.fromEntries(fd.entries());
      if (!payload.email && !payload.phone) {
        statusEl.textContent = 'Please add an email address or phone number.';
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      statusEl.textContent = '';
      try {
        if (!window.Backend || !Backend.submitEnquiry) throw new Error('Enquiry service is not available.');
        const result = await Backend.submitEnquiry(payload);
        if (!result.ok) throw new Error(result.error || 'Could not save your enquiry.');
        enquiryForm.reset();
        const redir = (state.buttonLinks && state.buttonLinks.contactSubmitRedirect) || '';
        if(redir){
          statusEl.textContent = 'Thank you! Redirecting…';
          setTimeout(() => openConfiguredDestination(redir), 1000);
        } else {
          statusEl.textContent = 'Thank you! Your enquiry has been submitted.';
        }
      } catch (err) {
        statusEl.textContent = 'Could not submit: ' + (err.message || 'Please try WhatsApp instead.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = (state.buttonLinks && state.buttonLinks.contactSubmitLabel) || 'Submit enquiry';
      }
    });
    view.appendChild(sec);
    return view;
  }

  // --------------------------------------------------------------
  // 10. Dedicated Booking View
  // --------------------------------------------------------------
  function buildDedicatedBookingView(){
    const view = document.createElement('div');
    view.className = 'view-booking wrap';
    view.appendChild(buildBreadcrumbsEl([
      { title: 'Home', path: '' },
      { title: 'Book Your Adventure' }
    ]));

    const master = document.getElementById('bookingFormMaster');
    if(master){
      const sourceEl = master.content ? master.content.firstElementChild : master.firstElementChild;
      if(sourceEl){
        const clone = sourceEl.cloneNode(true);
        clone.id = 'booking_active';
        view.appendChild(clone);
        wireBookingForm(clone);
      }
    }
    return view;
  }

  // Breadcrumbs Generator
  function buildBreadcrumbsEl(crumbs){
    const nav = document.createElement('nav');
    nav.className = 'breadcrumbs';
    crumbs.forEach((c, idx) => {
      if(idx > 0){
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '>';
        nav.appendChild(sep);
      }
      if(c.path !== undefined && idx < crumbs.length - 1){
        const a = document.createElement('a');
        a.href = '#' + (c.path ? '/' + c.path : '/');
        a.textContent = c.title;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(c.path || '');
        });
        nav.appendChild(a);
      } else {
        const span = document.createElement('span');
        span.textContent = c.title;
        nav.appendChild(span);
      }
    });
    return nav;
  }

  // --------------------------------------------------------------
  // UNIVERSAL "BOOK NOW" HANDLER (Requirement 2: Fix Book Now everywhere)
  // --------------------------------------------------------------
  window.bookThis = function(secKey, itemId, itemData, preferredBatch){
    // Resolve section and item
    let targetSec = findSection(secKey);
    let targetItem = itemData || null;

    if(!targetItem && targetSec){
      targetItem = (targetSec.items || []).find(x => x.id === itemId);
    }

    if(!targetItem){
      // Global search across all sections
      for(const s of allSections()){
        const it = (s.items || []).find(x => x.id === itemId || x.slug === itemId);
        if(it){
          targetSec = s;
          targetItem = it;
          break;
        }
      }
    }

    const typeStr = targetSec ? bookTypeFor(targetSec) : 'Trek';
    const pkgId   = targetItem ? (targetItem.id || targetItem.name) : (itemId || '');
    const pkgName = targetItem ? targetItem.name : '';

    // Switch view to booking
    navigate('booking');

    // After DOM updates, populate dropdowns and select the item
    setTimeout(() => {
      // Use scoped selectors to avoid matching the hidden master booking form
      const _bkRoot = document.getElementById('booking_active') || document.querySelector('#appMain section.booking') || document;
      const typeSel = _bkRoot.querySelector('#bkType') || document.querySelector('#appMain #bkType');
      const pkgSel  = _bkRoot.querySelector('#bkPkg')  || document.querySelector('#appMain #bkPkg');

      if(typeSel){
        populateBookingTypes(typeSel);
        // Ensure type option exists
        if(!Array.prototype.some.call(typeSel.options, o => o.value === typeStr)){
          const opt = document.createElement('option');
          opt.value = typeStr; opt.textContent = typeStr;
          typeSel.appendChild(opt);
        }
        typeSel.value = typeStr;
      }

      if(pkgSel){
        populatePackages(typeSel, pkgSel);
        // Ensure item package option exists
        if(pkgId && !Array.prototype.some.call(pkgSel.options, o => o.value === pkgId)){
          const opt = document.createElement('option');
          opt.value = pkgId;
          opt.textContent = pkgName ? `${pkgName}${targetItem && targetItem.cost ? ' — ₹' + targetItem.cost : ''}` : pkgId;
          pkgSel.appendChild(opt);
        }
        if(pkgId) pkgSel.value = pkgId;
      }

      // Immediately refresh payment rules and batch options for selected adventure
      const activeBookingRoot = document.getElementById('booking_active') || document.querySelector('#appMain section.booking');
      const formEl = activeBookingRoot ? activeBookingRoot.querySelector('#bookingForm') : document.querySelector('#appMain #bookingForm');
      if(formEl){
        updatePaymentOptionsForSelectedPackage(formEl);
        updateBatchOptionsForSelectedPackage(formEl, preferredBatch);
      }

      // Smooth scroll & highlight
      const formCard = document.getElementById('booking_active') || document.getElementById('bookingCard') || document.querySelector('#appMain section.booking');
      if(formCard){
        formCard.scrollIntoView({ behavior:'smooth', block:'start' });
        [typeSel, pkgSel].forEach(el => {
          if(!el) return;
          el.style.transition = 'box-shadow .3s';
          el.style.boxShadow = '0 0 0 4px rgba(217,88,43,.45)';
          setTimeout(() => { el.style.boxShadow = ''; }, 1400);
        });
      }
    }, 120);
  };

  function populateBookingTypes(sel){
    if(!sel) sel = $('#bkType');
    if(!sel) return;
    const types = [];
    allSections().forEach(sec => {
      const t = bookTypeFor(sec);
      if(t && !types.includes(t)) types.push(t);
    });
    const prev = sel.value;
    sel.innerHTML = '<option value="">Select adventure type</option>';
    types.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
    if(prev && types.includes(prev)) sel.value = prev;
  }

  function populatePackages(typeSel, pkgSel){
    if(!typeSel) typeSel = $('#bkType');
    if(!pkgSel)  pkgSel  = $('#bkPkg');
    if(!typeSel || !pkgSel) return;
    const type = typeSel.value;
    const prev = pkgSel.value;
    pkgSel.innerHTML = '<option value="">' + (type ? 'Select specific package' : 'Choose adventure type first') + '</option>';
    if(!type) return;

    allSections().forEach(sec => {
      if(bookTypeFor(sec) !== type) return;
      (sec.items || []).forEach(it => {
        const o = document.createElement('option');
        o.value = it.id;
        let lbl = it.name || 'Untitled';
        if(it.cost)  lbl += ' — ₹' + it.cost;
        if(it.dates) lbl += ' · ' + it.dates;
        o.textContent = lbl;
        pkgSel.appendChild(o);
      });
    });
    if(prev && Array.prototype.some.call(pkgSel.options, o => o.value === prev)) pkgSel.value = prev;
  }

  function getSelectedItemData(pkgId){
    if(!pkgId) return null;
    for(const s of allSections()){
      for(const it of (s.items || [])){
        if(it.id === pkgId || it.name === pkgId) return it;
      }
    }
    return null;
  }

  function updatePaymentOptionsForSelectedPackage(form){
    if(!form) return;
    const pkgSel = form.querySelector('#bkPkg');
    const pkgId = pkgSel ? pkgSel.value : '';
    const item = getSelectedItemData(pkgId);

    const upiLabel = form.querySelector('#payChoiceUpiLabel');
    const cashLabel = form.querySelector('#payChoiceCashLabel');
    const upiRadio = form.querySelector('input[name="payMethod"][value="UPI"]');
    const cashRadio = form.querySelector('input[name="payMethod"][value="Cash"]');
    const upiBox = form.querySelector('#upiDetailBox');
    const cashBox = form.querySelector('#cashDetailBox');

    const upiQrImg = form.querySelector('#upiQrImg');
    const upiIdDisplay = form.querySelector('#upiIdDisplay');
    const upiPayLinkBtn = form.querySelector('#upiPayLinkBtn');
    const upiLinkWrap = form.querySelector('#upiLinkWrap');
    const upiInstructions = form.querySelector('#upiCustomInstructions');
    const upiAmountNote = form.querySelector('#upiAmountNote');

    if(!upiLabel || !cashLabel) return;

    // Default configuration if item does not specify (inheriting from global booking config if present)
    const globalBooking = state.booking || {};
    const pay = (item && item.payment) ? item.payment : {
      cashEnabled: globalBooking.cashEnabled !== undefined ? !!globalBooking.cashEnabled : true,
      upiEnabled: globalBooking.upiEnabled !== undefined ? !!globalBooking.upiEnabled : true,
      upiId: globalBooking.upiId || '7387778296@upi',
      qrImage: globalBooking.qrImage || '',
      paymentLink: globalBooking.paymentLink || '',
      instructions: globalBooking.instructions || '',
      amount: ''
    };

    const cashEnabled = pay.cashEnabled !== false;
    const upiEnabled = pay.upiEnabled !== false;

    // Show/hide radio labels
    upiLabel.style.display = upiEnabled ? 'inline-flex' : 'none';
    cashLabel.style.display = cashEnabled ? 'inline-flex' : 'none';

    // Auto-select valid option if current selection disabled
    if(!upiEnabled && upiRadio && upiRadio.checked && cashEnabled && cashRadio){
      cashRadio.checked = true;
    } else if(!cashEnabled && cashRadio && cashRadio.checked && upiEnabled && upiRadio){
      upiRadio.checked = true;
    }

    // Populate UPI details
    const upiIdVal = pay.upiId || '7387778296@upi';
    if(upiIdDisplay) upiIdDisplay.textContent = upiIdVal;

    const amt = pay.amount || (item && item.cost ? item.cost : '');
    if(upiAmountNote){
      upiAmountNote.textContent = amt ? `Amount: ₹${amt}` : '';
      upiAmountNote.style.display = amt ? 'block' : 'none';
    }

    const effectiveQr = pay.qrImage || (state.booking && state.booking.qrImage) || '';
    if(upiQrImg){
      if(effectiveQr){
        upiQrImg.src = effectiveQr;
        upiQrImg.style.display = 'block';
      } else {
        upiQrImg.style.display = 'none';
      }
    }

    if(upiPayLinkBtn && upiLinkWrap){
      const link = pay.paymentLink || (pay.upiId ? `upi://pay?pa=${encodeURIComponent(upiIdVal)}&pn=${encodeURIComponent(state.brand.name||'The Wanderer Outdoors')}${amt ? '&am=' + encodeURIComponent(amt) : ''}&cu=INR` : '');
      if(link){
        upiPayLinkBtn.href = link;
        upiLinkWrap.style.display = 'block';
      } else {
        upiLinkWrap.style.display = 'none';
      }
    }

    if(upiInstructions){
      upiInstructions.textContent = pay.instructions || 'Transfer via UPI / QR and enter your transaction/UTR reference below. Our coordinator will verify and issue the confirmed receipt.';
    }

    // Toggle box visibility
    const isUpi = upiRadio && upiRadio.checked;
    if(upiBox) upiBox.style.display = (upiEnabled && isUpi) ? 'block' : 'none';
    if(cashBox) cashBox.style.display = (cashEnabled && !isUpi) ? 'block' : 'none';
  }

  // Returns the batches array for an item, falling back to item.dates string split
  function getEffectiveBatches(item){
    if(!item) return [];
    if(Array.isArray(item.batches) && item.batches.length > 0){
      return item.batches.filter(Boolean);
    }
    // Fallback: if batches is a newline/comma-separated string
    if(typeof item.batches === 'string' && item.batches.trim()){
      return item.batches.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    }
    // Legacy: item.dates may contain batch info as multi-line text
    if(typeof item.dates === 'string' && item.dates.trim() && item.dates.includes('\n')){
      return item.dates.split('\n').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  function updateBatchOptionsForSelectedPackage(form, preselectBatch){
    if(!form) return;
    const pkgSel = form.querySelector('#bkPkg');
    const pkgId = pkgSel ? pkgSel.value : '';
    const item = getSelectedItemData(pkgId);
    const batchSel = form.querySelector('#bkBatch');
    const dateInput = form.querySelector('#bkDate');
    const dateLabel = form.querySelector('#bkDateLabel');
    if(!batchSel || !dateInput) return;

    const batches = getEffectiveBatches(item);

    if(batches.length > 0){
      batchSel.style.display = 'block';
      if(dateLabel) dateLabel.innerHTML = 'Preferred Batch / Departure Date<span class="req">*</span>';
      
      const prevVal = preselectBatch || batchSel.value;
      batchSel.innerHTML = '<option value="">-- Choose your preferred batch --</option>';
      batches.forEach(b => {
        const o = document.createElement('option');
        o.value = b;
        o.textContent = b;
        batchSel.appendChild(o);
      });
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.textContent = '📅 Choose a custom / other date…';
      batchSel.appendChild(customOpt);

      if(prevVal && Array.prototype.some.call(batchSel.options, o => o.value === prevVal)){
        batchSel.value = prevVal;
      }

      if(batchSel.value === '__custom__'){
        dateInput.style.display = 'block';
      } else {
        dateInput.style.display = 'none';
      }
    } else {
      batchSel.style.display = 'none';
      dateInput.style.display = 'block';
      if(dateLabel) dateLabel.innerHTML = 'Preferred date<span class="req">*</span>';
    }
  }

  // --------------------------------------------------------------
  // Booking Form Wiring & Submission Logic
  // --------------------------------------------------------------
  function wireBookingForm(root=document){
    const form = root.querySelector('#bookingForm');
    if(!form) return;
    const typeSel = root.querySelector('#bkType');
    const pkgSel  = root.querySelector('#bkPkg');

    // Ensure the payment block body is visible (CSS hides it by default for an
    // accordion effect that was never wired — we force-open it so the customer
    // can always see payment options).
    const payBlock = root.querySelector('#payBlock');
    if(payBlock) payBlock.classList.add('open');

    // Also add a click toggle on the heading for UX (optional accordion).
    const payHead = root.querySelector('.pay-head');
    if(payHead && payBlock){
      payHead.style.cursor = 'pointer';
      payHead.addEventListener('click', function(e){
        // Don't toggle if clicking inside the body.
        if(e.target.closest('.pay-body')) return;
        payBlock.classList.toggle('open');
      });
    }

    populateBookingTypes(typeSel);
    populatePackages(typeSel, pkgSel);

    const batchSel = root.querySelector('#bkBatch');
    const dateInput = root.querySelector('#bkDate');
    if(batchSel && dateInput){
      batchSel.addEventListener('change', () => {
        if(batchSel.value === '__custom__'){
          dateInput.style.display = 'block';
          dateInput.focus();
        } else {
          dateInput.style.display = 'none';
        }
      });
    }

    if(typeSel){
      typeSel.addEventListener('change', () => {
        populatePackages(typeSel, pkgSel);
        updatePaymentOptionsForSelectedPackage(form);
        updateBatchOptionsForSelectedPackage(form);
      });
    }

    if(pkgSel){
      pkgSel.addEventListener('change', () => {
        updatePaymentOptionsForSelectedPackage(form);
        updateBatchOptionsForSelectedPackage(form);
      });
    }

    // Pay method radio change
    const radios = form.querySelectorAll('input[name="payMethod"]');
    radios.forEach(r => {
      r.addEventListener('change', () => updatePaymentOptionsForSelectedPackage(form));
    });

    updatePaymentOptionsForSelectedPackage(form);
    updateBatchOptionsForSelectedPackage(form);
    form.addEventListener('submit', handleBookingSubmit);
  }

  function validateBooking(form){
    const errs = {};
    const v = name => {
      const el = form.querySelector(`[name="${name}"]`);
      return el ? String(el.value).trim() : '';
    };

    const name = v('fullName');
    if(!name) errs.fullName = 'Please enter your full name.';
    else if(name.length < 2) errs.fullName = 'Name looks too short.';

    const age = v('age');
    if(!age) errs.age = 'Please enter your age.';
    else {
      const n = Number(age);
      if(!isFinite(n) || n < 1 || n > 120) errs.age = 'Enter a valid age (1–120).';
    }

    const email = v('email');
    if(!email) errs.email = 'Please enter your email.';
    else if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errs.email = 'Enter a valid email address.';

    const phone = v('phone');
    const digits = phone.replace(/\D/g, '');
    if(!phone) errs.phone = 'Please enter your mobile phone number.';
    else if(digits.length < 10 || digits.length > 15) errs.phone = 'Enter a valid 10-digit mobile number.';

    const batchSel = form.querySelector('#bkBatch');
    const isBatchActive = batchSel && batchSel.style.display !== 'none';
    const batchVal = isBatchActive ? batchSel.value : '';

    if(isBatchActive && batchVal !== '__custom__'){
      if(!batchVal) errs.date = 'Please choose your preferred batch.';
    } else {
      const date = v('date');
      if(!date) errs.date = 'Choose your preferred date.';
      else {
        const d = new Date(date + 'T00:00:00');
        const today = new Date(); today.setHours(0,0,0,0);
        if(isNaN(d.getTime())) errs.date = 'Date looks invalid.';
        else if(d < today) errs.date = 'Please pick today or a future date.';
      }
    }

    const people = v('people');
    if(!people) errs.people = 'Enter participant count.';
    else {
      const n = Number(people);
      if(!isFinite(n) || n < 1 || n > 100) errs.people = 'Enter between 1 and 100 people.';
    }

    if(!v('type')) errs.type = 'Select an adventure category.';
    if(!v('pkg'))  errs.pkg  = 'Select a specific package.';

    return errs;
  }

  function showFormErrors(form, errs){
    $$('.field', form).forEach(f => {
      f.classList.remove('invalid');
      const e = f.querySelector('.err'); if(e) e.textContent = '';
    });
    Object.keys(errs).forEach(k => {
      const f = form.querySelector(`.field[data-field="${k}"]`);
      if(!f) return;
      f.classList.add('invalid');
      const e = f.querySelector('.err'); if(e) e.textContent = errs[k];
    });
  }

  async function handleBookingSubmit(e){
    e.preventDefault();
    const form = e.target;

    // Prevent duplicate submissions (double-click, Enter key spam).
    if(form._submitting) return;
    form._submitting = true;
    const submitBtn = form.querySelector('#confirmBookingBtn');
    if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

    const errs = validateBooking(form);
    if(Object.keys(errs).length){
      showFormErrors(form, errs);
      const first = form.querySelector('.field.invalid');
      if(first) first.scrollIntoView({ behavior:'smooth', block:'center' });
      form._submitting = false;
      if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = 'Confirm Booking'; }
      return;
    }

    // Collect booking data
    const v = name => { const el = form.querySelector(`[name="${name}"]`); return el ? String(el.value).trim() : ''; };
    const typeSel = form.querySelector('#bkType');
    const pkgSel  = form.querySelector('#bkPkg');
    const typeText = (typeSel && typeSel.selectedOptions[0]) ? typeSel.selectedOptions[0].textContent : '';
    const pkgText  = (pkgSel && pkgSel.selectedOptions[0]) ? pkgSel.selectedOptions[0].textContent : '';

    const batchSel = form.querySelector('#bkBatch');
    const isBatchActive = batchSel && batchSel.style.display !== 'none';
    const batchVal = isBatchActive ? batchSel.value : '';

    let dateFormatted = '';
    let rawTravelDate = '';
    if(isBatchActive && batchVal && batchVal !== '__custom__'){
      dateFormatted = batchVal;
      rawTravelDate = batchVal;
    } else {
      const dateVal = v('date');
      rawTravelDate = dateVal;
      dateFormatted = dateVal;
      if(dateVal){
        const d = new Date(dateVal + 'T00:00:00');
        if(!isNaN(d.getTime())) dateFormatted = d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
      }
    }

    // Payment Method & Status Determination (Requirements 1, 2, 3)
    const payMethodEl = form.querySelector('input[name="payMethod"]:checked');
    const isUpi = payMethodEl && payMethodEl.value === 'UPI';
    const txnRefInput = form.querySelector('#bkTxnRef');
    const txnRef = txnRefInput ? txnRefInput.value.trim() : '';

    let payText = '';
    let payStatus = '';
    if(isUpi){
      payText = 'UPI / Online Transfer' + (txnRef ? ' (UTR: ' + txnRef + ')' : '');
      payStatus = 'Verification Required';
    } else {
      payText = 'Cash (payable on trip day)';
      payStatus = 'Pending';
    }

    // Unique Booking Reference — cryptographically secure (no Math.random).
    // 96 bits of entropy; collisions are computationally infeasible.
    const bookingRef = generateBookingRef();
    // Unguessable token that powers the secure public "view receipt online" link.
    const receiptToken = generateReceiptToken();

    // Determine the amount due for this specific package (per-trip setting).
    const selItem = getSelectedItemData(pkgSel ? pkgSel.value : '');
    const amountDue = (selItem && selItem.payment && selItem.payment.amount)
      ? selItem.payment.amount
      : (selItem && selItem.cost ? selItem.cost : '');

    const bookingData = {
      ref: bookingRef,
      booking_id: bookingRef,
      receipt_token: receiptToken,
      name: v('fullName'),
      age: v('age'),
      email: v('email'),
      phone: v('phone'),
      date: dateFormatted,
      travel_date: rawTravelDate,
      batch: (isBatchActive && batchVal !== '__custom__') ? batchVal : '',
      people: v('people'),
      type: typeText,
      trip_kind: typeText,
      package: pkgText,
      trip_title: pkgText,
      notes: v('notes'),
      payment: payText,
      payment_status: payStatus,
      status: 'new',
      txn_ref: txnRef,
      amount: amountDue,
      source: 'web'
    };

    lastBookingRecord = bookingData;

    // WhatsApp Message with full details and reference
    const lines = [
      '*New Booking — The Wanderer Outdoors*',
      'Booking Reference: ' + bookingRef,
      '',
      '*' + (bookingData.package || 'Adventure Booking') + '*',
      bookingData.type ? 'Category: ' + bookingData.type : '',
      '',
      'Traveller Name: ' + bookingData.name,
      'Age: ' + bookingData.age,
      'Email: ' + bookingData.email,
      'Phone: ' + bookingData.phone,
      'Travel Date: ' + bookingData.date,
      'Participants: ' + bookingData.people,
      'Payment Choice: ' + (isUpi ? 'UPI Transfer (Verification Pending)' : 'Cash (Due on trip day)'),
      txnRef ? 'Transaction Reference / UTR: ' + txnRef : '',
      'Status: ' + (isUpi ? 'PAYMENT VERIFICATION PENDING' : 'PAYMENT PENDING — CASH PAYMENT DUE'),
      '',
      'Sent from wandereroutdoors.in'
    ].filter(Boolean);

    if(bookingData.notes) lines.push('', 'Notes: ' + bookingData.notes);

    const waNum = (state.contact.whatsapp || '917387778296').replace(/\D/g, '');
    const waUrl = 'https://wa.me/' + waNum + '?text=' + encodeURIComponent(lines.join('\n'));

    // Do not launch WhatsApp automatically. First show the confirmation and
    // receipt options; the customer can explicitly choose WhatsApp afterward.
    const waWin = null;

    // Save to Supabase
    let saveOk = false;
    let saveErr = '';
    if(window.Backend && Backend.configured()){
      try{
        const r = await Backend.submitBooking(bookingData);
        saveOk = !!(r && r.ok);
        if(!saveOk) saveErr = (r && r.error) || 'Submission error';
      }catch(err){
        saveOk = false;
        saveErr = err.message;
      }
    }

    // Show Success Card
    showBookingSuccess(form, bookingData, waUrl, !!waWin, saveOk, saveErr);

    // Reset submit lock so future submissions work.
    form._submitting = false;
    if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = (state.buttonLinks && state.buttonLinks.bookingSubmitLabel) || 'Confirm Booking'; }
  }

  function showBookingSuccess(form, b, waUrl, waOpened, saveOk, saveErr){
    const card = form.closest('.booking-card');
    if(!card) return;
    form.style.display = 'none';

    const old = card.querySelector('#bookingSuccess');
    if(old) old.remove();

    const box = document.createElement('div');
    box.className = 'success-card';
    box.id = 'bookingSuccess';
    box.innerHTML = `
      <div class="tick">${saveOk || (!window.Backend || !Backend.configured()) ? '&#10003;' : '⚠️'}</div>
      <h3>${saveOk || (!window.Backend || !Backend.configured()) ? 'Booking Confirmed!' : 'Booking Recorded with Notice'}</h3>
      <p>${saveOk || (!window.Backend || !Backend.configured())
        ? (waOpened
            ? 'We’ve opened WhatsApp with your booking details ready — press <strong>Send</strong> in the chat to connect directly with our trek coordinators.'
            : 'Your booking has been recorded! Tap below to send your details to our team on WhatsApp.')
        : 'Your booking details could not be saved to the database (' + escapeHtml(saveErr) + '). However, your details are prepared below — please send them directly on WhatsApp so our coordinators can reserve your slot.'}</p>
      <div class="success-summary">
        <div><span>Booking Reference</span><span style="color:var(--ember);font-weight:700;">${escapeHtml(b.ref)}</span></div>
        <div><span>Name</span><span>${escapeHtml(b.name)}</span></div>
        <div><span>Adventure</span><span>${escapeHtml(b.package)}</span></div>
        <div><span>Travel Date</span><span>${escapeHtml(b.date)}</span></div>
        <div><span>Participants</span><span>${escapeHtml(b.people)} person(s)</span></div>
        <div><span>Payment</span><span>${escapeHtml(b.payment)}</span></div>
      </div>
      <div class="success-actions">
        <button class="btn-primary" id="showReceiptBtn" style="background:var(--forest);font-size:15px;padding:14px 22px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;">
          <span>📄 View / Download Receipt &amp; Share on WhatsApp (${(state.contact.whatsapp||'7387778296').replace(/\D/g,'').replace(/^91/,'')})</span>
        </button>
        <a class="wa-btn" href="${escapeHtml(waUrl)}" target="_blank" rel="noopener" style="font-size:14px;padding:12px 20px;">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16.04 4C9.96 4 5.02 8.94 5.02 15.02c0 2.2.6 4.26 1.64 6.02L5 28l7.1-1.62a11 11 0 0 0 3.94.72h.01C22.12 27.1 27 22.15 27 16.08 27 9.98 22.1 4 16.04 4zm0 2.2c3.83 0 6.94 3.12 6.94 6.95 0 3.83-3.11 6.94-6.94 6.94-1.2 0-2.36-.3-3.37-.87l-.48-.27-4.03 1.03 1.08-3.93-.31-.5a6.9 6.9 0 0 1-1.06-3.7c0-3.83 3.11-6.65 7.17-6.65zM12.9 10.3c-.2 0-.5.07-.76.36-.27.28-1.02 1-.99 2.43.03 1.44 1.05 2.83 1.2 3.03.14.19 2.02 3.3 5.02 4.5 2.48.99 2.99.79 3.53.74.54-.05 1.75-.72 2-1.41.25-.69.25-1.28.18-1.4-.07-.13-.26-.2-.54-.35-.28-.14-1.65-.81-1.9-.9-.26-.09-.44-.14-.63.14-.19.28-.72.9-.89 1.08-.16.19-.33.21-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.94-.16-.28-.02-.43.12-.57.13-.13.28-.33.42-.5.14-.16.19-.28.28-.47.1-.19.05-.35-.02-.5-.07-.14-.62-1.55-.87-2.1-.22-.55-.45-.46-.62-.47l-.56-.01z"/></svg>
          <span>Share directly on WhatsApp</span>
        </a>
        ${!saveOk && window.Backend && Backend.configured() ? '<button class="btn-primary" id="retrySaveBtn">↻ Retry Save to Database</button>' : ''}
        <button class="btn-ghost" id="bookAnotherTripBtn">Book another trip</button>
      </div>
      <p class="saved-note" style="${saveOk ? 'color:#15803d;' : 'color:#b91c1c;'}">${saveOk ? 'Saved to site database ✓' : (saveErr ? 'Database notice: ' + escapeHtml(saveErr) : 'Ready to confirm on WhatsApp.')}</p>
    `;
    card.appendChild(box);
    box.scrollIntoView({ behavior:'smooth', block:'center' });
    // Automatically open the receipt modal so travellers can view, download PDF, or share
    setTimeout(() => { openReceiptModal(b); }, 450);

    box.querySelector('#showReceiptBtn').addEventListener('click', () => openReceiptModal(b));
    var retryBtn = box.querySelector('#retrySaveBtn');
    if(retryBtn){
      retryBtn.addEventListener('click', async () => {
        retryBtn.disabled = true; retryBtn.textContent = 'Retrying…';
        try {
          const r = await Backend.submitBooking(b);
          if(r && r.ok){
            toast('Booking saved to database ✓');
            box.remove();
            showBookingSuccess(form, Object.assign({}, b, {receipt_token: r.token || b.receipt_token}), waUrl, false, true, '');
          } else {
            retryBtn.disabled = false; retryBtn.textContent = '↻ Retry Save to Database';
            toast('Save failed: ' + ((r && r.error) || 'unknown'), false);
          }
        } catch(err){
          retryBtn.disabled = false; retryBtn.textContent = '↻ Retry Save to Database';
          toast('Save failed: ' + err.message, false);
        }
      });
    }
    box.querySelector('#bookAnotherTripBtn').addEventListener('click', () => {
      box.remove();
      form.style.display = '';
      form.reset();
      populateBookingTypes(form.querySelector('#bkType'));
      populatePackages(form.querySelector('#bkType'), form.querySelector('#bkPkg'));
      updatePaymentOptionsForSelectedPackage(form);
    });
  }

  // --------------------------------------------------------------
  // Receipt helpers, real PDF generation & secure public receipt
  // --------------------------------------------------------------
  let currentReceiptBooking = null;

  // Decide the exact status badge + note text per the booking's payment state.
  function receiptStatusInfo(b){
    const pStat = (b.payment_status || '').toLowerCase();
    const payDesc = (b.payment || '').toLowerCase();
    if(pStat === 'paid' || payDesc.includes('paid')){
      return {
        text: 'PAID',
        cls: 'receipt-status-tag status-paid',
        note: 'This receipt confirms that payment has been verified and received by The Wanderer Outdoors. Your seat is confirmed.'
      };
    }
    if(payDesc.includes('cash') || (!payDesc.includes('upi') && !b.txn_ref)){
      return {
        text: 'PAYMENT PENDING — CASH PAYMENT DUE',
        cls: 'receipt-status-tag status-pending',
        note: 'This acknowledgement confirms your reservation with The Wanderer Outdoors. Cash payment is due on the trip day to the lead coordinator.'
      };
    }
    return {
      text: 'PAYMENT VERIFICATION PENDING — NOT YET CONFIRMED AS PAID',
      cls: 'receipt-status-tag status-verif',
      note: 'This acknowledgement confirms that your UPI/online transfer details were submitted. Payment is awaiting verification by our coordinator before final seat confirmation.'
    };
  }

  // Plain-text WhatsApp message for a receipt (real values, no placeholders).
  function receiptWhatsAppText(b){
    const s = receiptStatusInfo(b);
    const lines = [
      '*The Wanderer Outdoors — Booking Receipt*',
      'Reference: ' + (b.ref || ''),
      'Traveller: ' + (b.name || ''),
      'Adventure: ' + (b.package || ''),
      'Category: ' + (b.type || ''),
      'Travel Date: ' + (b.date || ''),
      'Participants: ' + (b.people || '') + ' person(s)',
      'Amount Due: ' + (b.amount ? '₹' + b.amount : 'As quoted'),
      'Payment: ' + (b.payment || ''),
      'Payment Status: ' + s.text
    ];
    const token = b.receipt_token || '';
    const originUrl = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? ((state && state.seo && state.seo.canonicalUrl) ? state.seo.canonicalUrl.replace(/\/$/, '') : 'https://www.wandereroutdoors.in')
      : location.origin;
    if(token) lines.push('View receipt online: ' + originUrl + '/#/receipt/' + token);
    return lines.join('\n');
  }

  function downloadBlob(file){
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch(e){ return false; }
  }

  // Generate a branded, real PDF receipt via jsPDF. Returns the jsPDF doc or null.
  function buildReceiptPDF(b){
    if(!window.jspdf || !window.jspdf.jsPDF) return null;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const M = 48;
    let y = 56;

    // Header band
    doc.setFillColor(31, 77, 54); doc.rect(0, 0, W, 96, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    doc.text('The Wanderer Outdoors', M, 46);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Live · Travel · Explore · wandereroutdoors.in', M, 64);
    doc.text('+91 7387778296 · hello@wandereroutdoors.in', M, 80);
    doc.setTextColor(20, 31, 27);

    y = 132;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('BOOKING RECEIPT', M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Issued: ' + new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }), W - M, y, { align: 'right' });
    y += 14;
    doc.setDrawColor(220); doc.line(M, y, W - M, y);
    y += 24;

    const s = receiptStatusInfo(b);
    const rows = [
      ['Booking Reference', b.ref || ''],
      ['Traveller Name', b.name || 'Explorer'],
      ['Phone & Email', (b.phone || '') + (b.email ? ' · ' + b.email : '')],
      ['Adventure / Package', b.package || 'Outdoor Adventure'],
      ['Category', b.type || 'Trek'],
      ['Travel Date', b.date || 'TBD'],
      ['Participants', (b.people || '1') + ' person(s)'],
      ['Amount Due', b.amount ? '₹' + b.amount : 'As quoted'],
      ['Payment Method', b.payment || 'Pending'],
      ['Transaction Ref', b.txn_ref || '—'],
      ['Booking Date', b.received_at ? new Date(b.received_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—']
    ];
    doc.setFontSize(10);
    rows.forEach(r => {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 90, 90);
      doc.text(r[0], M, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 31, 27);
      doc.text(String(r[1]), M + 170, y);
      y += 22;
    });

    // Status badge
    y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    let badgeColor = [192, 78, 31]; // pending / cash default
    if(s.cls.includes('status-paid')) badgeColor = [31, 120, 70];
    else if(s.cls.includes('status-verif')) badgeColor = [180, 120, 20];
    doc.setTextColor(badgeColor[0], badgeColor[1], badgeColor[2]);
    doc.text('Payment Status: ' + s.text, M, y);
    doc.setTextColor(20, 31, 27);
    y += 22;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const noteLines = doc.splitTextToSize(s.note, W - 2 * M);
    doc.text(noteLines, M, y);
    y += noteLines.length * 12 + 18;

    // Footer
    doc.setDrawColor(220); doc.line(M, y, W - M, y);
    y += 16;
    doc.setFontSize(8); doc.setTextColor(120, 120, 120);
    doc.text('This is a computer-generated acknowledgement. Seats are confirmed only after payment verification by The Wanderer Outdoors.', M, y, { maxWidth: W - 2 * M });
    return doc;
  }

  function receiptPDFFile(b){
    const doc = buildReceiptPDF(b);
    if(!doc) return null;
    const blob = doc.output('blob');
    return new File([blob], 'WO-Receipt-' + (b.ref || 'BOOKING') + '.pdf', { type: 'application/pdf' });
  }

  // WhatsApp share — ATTEMPT FILE ATTACHMENT FIRST (real PDF), then fallback
  // to downloading the PDF + opening a prefilled WhatsApp message. We never claim
  // the message was sent if the user cancels or the share is unsupported.
  async function shareReceiptPDF(b){
    const file = receiptPDFFile(b);
    const num = (state.contact.whatsapp || '917387778296').replace(/\D/g, '');
    const text = receiptWhatsAppText(b);
    if(file && navigator.canShare && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })){
      try {
        await navigator.share({ files: [file], text: text });
        return { shared: true };
      } catch(err){
        if(err && err.name === 'AbortError') return { cancelled: true };
        // otherwise fall through to the download + wa.me fallback
      }
    }
    if(file) downloadBlob(file);
    const waUrl = 'https://wa.me/' + num + '?text=' + encodeURIComponent(text);
    try { window.open(waUrl, '_blank'); } catch(e){ location.href = waUrl; }
    return { fallback: true };
  }

  function receiptUnavailableEl(msg){
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.style.cssText = 'padding:90px 0;text-align:center;';
    wrap.innerHTML = `<div class="receipt-unavailable" style="max-width:560px;margin:0 auto;background:var(--bg-soft);border:1px solid var(--line);border-radius:14px;padding:36px;">
      <div style="font-size:40px;">🧾</div>
      <h2 style="margin:10px 0 8px;">Receipt not available</h2>
      <p class="muted" style="line-height:1.6;">${escapeHtml(msg || '')}</p>
      <a class="btn-primary" href="https://wa.me/${(state.contact.whatsapp||'917387778296').replace(/\D/g,'')}" target="_blank" rel="noopener" style="display:inline-block;margin-top:14px;text-decoration:none;">Chat on WhatsApp</a>
    </div>`;
    return wrap;
  }

  // Convert the actual Supabase bookings row into the receipt view's display shape.
  // The live schema stores payment/amount/token metadata in special_req rather than
  // dedicated columns, so the public receipt must decode that field after lookup.
  function normalizeReceiptRecord(row){
    if(!row) return null;
    const meta = String(row.special_req || '');
    const metaValue = label => {
      const re = new RegExp('(?:^|\\|\\s*)' + label + ':\\s*([^|]+)', 'i');
      const m = meta.match(re);
      return m ? m[1].trim() : '';
    };
    return Object.assign({}, row, {
      ref: row.ref || row.booking_ref || '',
      receipt_token: row.receipt_token || metaValue('ReceiptToken'),
      package: row.package || row.trip_title || 'Outdoor Adventure',
      type: row.type || row.trip_kind || 'Adventure',
      date: row.date || row.travel_date || 'TBD',
      amount: row.amount || metaValue('Amount'),
      payment: row.payment || metaValue('Payment') || 'Pending',
      txn_ref: row.txn_ref || metaValue('Transaction reference'),
      received_at: row.received_at || row.created_at || '',
      payment_status: row.payment_status || 'pending'
    });
  }

  // Public, shareable receipt page resolved by unguessable token (SECURE).
  function renderPublicReceipt(token){
    const main = $('#appMain');
    if(!main) return;
    if(!window.Backend || !Backend.configured()){
      main.innerHTML = '';
      main.appendChild(receiptUnavailableEl('Receipt lookup is currently unavailable because the site database is not connected. Please contact us with your booking reference and we will resend your receipt.'));
      return;
    }
    main.innerHTML = '<div class="wrap" style="padding:80px 0;text-align:center;color:var(--muted);">Loading your booking receipt…</div>';
    Backend.getBookingByToken(token).then(b => {
      main.innerHTML = '';
      b = normalizeReceiptRecord(b);
      if(b && b.ref){
        main.appendChild(buildReceiptView(b, { public: true }));
      } else {
        main.appendChild(receiptUnavailableEl('We could not find a receipt for this link. The link may be incorrect or expired. Please contact us with your booking reference — ' + (state.contact.whatsapp || '7387778296') + '.'));
      }
    }).catch(() => {
      main.innerHTML = '';
      main.appendChild(receiptUnavailableEl('Something went wrong while loading your receipt. Please try again or contact us on WhatsApp.'));
    });
  }

  // Full-page branded receipt (used for shared links). Reuses the same status
  // logic and PDF / share helpers as the in-session modal.
  function buildReceiptView(b, opts){
    const s = receiptStatusInfo(b);
    const sec = document.createElement('section');
    sec.className = 'view-receipt wrap';
    sec.style.cssText = 'padding:60px 0;';
    const token = b.receipt_token || '';
    const onlineUrl = token ? (location.origin + '/#/receipt/' + token) : '';
    sec.innerHTML = `
      <div class="receipt-sheet" id="publicReceiptSheet" style="max-width:680px;margin:0 auto;">
        <div class="receipt-header">
          <div class="receipt-brand">
            <strong>The Wanderer Outdoors</strong>
            <small>Live · Travel · Explore · wandereroutdoors.in</small>
            <div style="font-size:12px;color:var(--muted);margin-top:4px;">+91 7387778296 · hello@wandereroutdoors.in</div>
          </div>
          <div class="receipt-meta">
            <span style="font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;color:var(--muted);">Booking Receipt</span>
            <strong>${escapeHtml(b.ref || '')}</strong>
            <div style="font-size:12px;margin-top:2px;">Issued: ${new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</div>
          </div>
        </div>
        <table class="receipt-table"><tbody>
          <tr><th>Traveller Name</th><td>${escapeHtml(b.name || 'Explorer')}</td></tr>
          <tr><th>Phone &amp; Email</th><td>${escapeHtml((b.phone || '') + (b.email ? ' · ' + b.email : ''))}</td></tr>
          <tr><th>Adventure / Package</th><td style="font-weight:700;color:var(--forest);">${escapeHtml(b.package || 'Outdoor Adventure')}</td></tr>
          <tr><th>Category</th><td>${escapeHtml(b.type || 'Trek')}</td></tr>
          <tr><th>Travel Date</th><td>${escapeHtml(b.date || 'TBD')}</td></tr>
          <tr><th>Participants</th><td>${escapeHtml((b.people || '1') + ' person(s)')}</td></tr>
          <tr><th>Amount Due</th><td>${b.amount ? '₹' + escapeHtml(b.amount) : 'As quoted'}</td></tr>
          <tr><th>Payment Method</th><td>${escapeHtml(b.payment || 'Pending')}</td></tr>
          ${b.txn_ref ? `<tr><th>Transaction Ref</th><td>${escapeHtml(b.txn_ref)}</td></tr>` : ''}
          <tr><th>Booking Date</th><td>${b.received_at ? escapeHtml(new Date(b.received_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })) : '—'}</td></tr>
          <tr><th>Payment Status</th><td><span class="receipt-status-tag ${s.cls.replace('receipt-status-tag ','')}">${escapeHtml(s.text)}</span></td></tr>
        </tbody></table>
        <div class="receipt-note">
          <strong>Important Booking Acknowledgement:</strong>
          <span>${escapeHtml(s.note)}</span>
        </div>
        <div class="receipt-actions">
          <button class="btn-ghost" id="pubReceiptDownloadPdf">⬇ Download PDF</button>
          <button class="btn-ghost" id="pubReceiptSharePdf">💬 Share PDF on WhatsApp</button>
          <button class="btn-ghost" id="pubReceiptPrint">🖨 Print</button>
        </div>
        ${onlineUrl ? `<p class="muted" style="font-size:12px;margin-top:14px;">Saved this link to view your receipt anytime: <code style="word-break:break-all;">${escapeHtml(onlineUrl)}</code></p>` : ''}
      </div>`;

    currentReceiptBooking = b;
    const dl = sec.querySelector('#pubReceiptDownloadPdf');
    const sh = sec.querySelector('#pubReceiptSharePdf');
    const pr = sec.querySelector('#pubReceiptPrint');
    if(dl) dl.addEventListener('click', () => {
      const f = receiptPDFFile(b);
      if(f) downloadBlob(f); else window.print();
    });
    if(sh) sh.addEventListener('click', () => { shareReceiptPDF(b); });
    if(pr) pr.addEventListener('click', () => window.print());
    return sec;
  }

  // --------------------------------------------------------------
  // Receipt Modal System (Requirement 3)
  // --------------------------------------------------------------
  function openReceiptModal(b){
    if(!b) b = lastBookingRecord;
    if(!b) return;
    const modal = $('#receiptModal');
    if(!modal) return;

    currentReceiptBooking = b;

    $('#rcptRef').textContent     = b.ref || 'WO-REF';
    $('#rcptDate').textContent    = 'Issued: ' + new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
    $('#rcptName').textContent    = b.name || 'Explorer';
    $('#rcptContact').textContent = (b.phone || '') + (b.email ? ' · ' + b.email : '');
    $('#rcptPackage').textContent = b.package || 'Outdoor Adventure';
    $('#rcptType').textContent    = b.type || 'Trek';
    $('#rcptTripDate').textContent= b.date || 'TBD';
    $('#rcptPeople').textContent  = (b.people || '1') + ' person(s)';
    $('#rcptPay').textContent     = b.payment || 'Pending';

    // Transaction Ref Row
    const txnRow = $('#rcptTxnRow');
    const txnEl = $('#rcptTxn');
    if(txnRow && txnEl){
      if(b.txn_ref){
        txnRow.style.display = '';
        txnEl.textContent = b.txn_ref;
      } else {
        txnRow.style.display = 'none';
      }
    }

    // Exact badge + note per specification (Requirement 3)
    const statusEl = $('#rcptStatus');
    const noteTextEl = $('#rcptNoteText');
    const s = receiptStatusInfo(b);
    if(statusEl){ statusEl.className = s.cls; statusEl.textContent = s.text; }
    if(noteTextEl) noteTextEl.textContent = s.note;

    // WhatsApp Share Button — uses the secure token link when available.
    const waShareBtn = $('#receiptWaBtn');
    if(waShareBtn){
      const waMsg = receiptWhatsAppText(b);
      const waNum = (state.contact.whatsapp || '917387778296').replace(/\D/g, '');
      waShareBtn.href = `https://wa.me/${waNum}?text=${encodeURIComponent(waMsg)}`;
    }

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeReceiptModal(){
    const modal = $('#receiptModal');
    if(modal){
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function wireReceiptModal(){
    const modal = $('#receiptModal');
    if(!modal) return;
    const closeBtn = $('#receiptCloseBtn');
    const doneBtn  = $('#receiptDoneBtn');
    const printBtn = $('#receiptPrintBtn');
    const dlBtn    = $('#receiptDownloadPdfBtn');
    const shareBtn = $('#receiptSharePdfBtn');

    if(closeBtn) closeBtn.addEventListener('click', closeReceiptModal);
    if(doneBtn)  doneBtn.addEventListener('click', closeReceiptModal);
    if(printBtn) printBtn.addEventListener('click', () => window.print());
    if(dlBtn) dlBtn.addEventListener('click', () => {
      const f = receiptPDFFile(currentReceiptBooking);
      if(f) downloadBlob(f); else window.print();
    });
    if(shareBtn) shareBtn.addEventListener('click', () => { shareReceiptPDF(currentReceiptBooking); });
    modal.addEventListener('click', (e) => {
      if(e.target === modal) closeReceiptModal();
    });
  }

  // --------------------------------------------------------------
  // VISITOR MODE BY DEFAULT & BOTTOM EDIT AUTHENTICATION
  // (Requirement 1: Visitor mode by default)
  // --------------------------------------------------------------
  function setAdminMode(active){
    document.body.classList.toggle('admin-mode', !!active);
    const bar = $('#adminBar');
    if(bar) bar.style.display = active ? 'block' : 'none';

    // Toggle editable attributes on text
    $$('[data-edit]').forEach(el => {
      if(active){
        el.setAttribute('contenteditable', 'plaintext-only');
      }else{
        el.removeAttribute('contenteditable');
      }
    });

    if(active){
      setSyncStatus('saved');
    }
  }

  async function enterAdminFromClick(){
    // No public-page editor or offline bypass. The private Control Room is /admin/.
    window.location.href = '/admin/';
  }

  function promptPasscode(onSuccess){
    openModal({
      title: 'Editor Sign-in',
      fields: [
        { key:'email',    label:'Editor email',    type:'email' },
        { key:'password', label:'Password',        type:'password' }
      ],
      onSave: async (vals) => {
        const email = (vals.email || '').trim();
        const pass  = vals.password || '';
        if(!email || !pass){ alert('Please enter your email and password.'); return; }
        try{
          let r = await Backend.signIn(email, pass);
          if(r && r.ok){
            adminKey = email;
            onSuccess();
            return;
          }
          alert('Sign-in failed. Please verify your email and password in Supabase.');
          promptPasscode(onSuccess);
        }catch(err){
          alert('Could not authenticate: ' + err.message);
        }
      }
    });
  }

  function wireAdminMode(){
    // Deliberately no public footer Edit button. Editors use the authenticated /admin/ Control Room.

    // Exit admin button
    const exitBtn = $('#exitAdminBtn');
    if(exitBtn){
      exitBtn.addEventListener('click', () => {
        setAdminMode(false);
      });
    }

    // Theme panel button
    const themeBtn = $('#themeBtn');
    if(themeBtn) themeBtn.addEventListener('click', openThemePanel);

    // Bookings button
    const bkBtn = $('#bookingsBtn');
    if(bkBtn) bkBtn.addEventListener('click', openBookingsPanel);

    // Sync button
    const syncBtn = $('#syncBtn');
    if(syncBtn) syncBtn.addEventListener('click', () => {
      saveState();
      alert('Site saved & synced successfully!');
    });

    // Site lock
    const lockBtn = $('#lockBtn');
    if(lockBtn) lockBtn.addEventListener('click', toggleSiteLock);

    // Invite editor
    const inviteBtn = $('#inviteBtn');
    if(inviteBtn) inviteBtn.addEventListener('click', createInvite);

    // Change passcode
    const passBtn = $('#passcodeBtn');
    if(passBtn) passBtn.addEventListener('click', changePasscode);

    // Export & import JSON
    const expBtn = $('#exportJsonBtn');
    if(expBtn) expBtn.addEventListener('click', exportJson);
    const impBtn = $('#importJsonBtn');
    if(impBtn) impBtn.addEventListener('click', importJson);
  }

  // --------------------------------------------------------------
  // In-Place Text Editing (Admin Mode)
  // --------------------------------------------------------------
  function makeEditable(el){
    if(el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('blur', () => {
      const path = el.getAttribute('data-edit');
      const val = el.innerText.trim();
      setByPath(path, val);
      saveState();
    });
    el.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && el.getAttribute('contenteditable')){
        e.preventDefault();
        el.blur();
      }
    });
  }

  function setByPath(path, value){
    if(!path) return;
    const parts = path.split('.');
    let obj = state;
    for(let i=0; i<parts.length-1; i++){
      const k = parts[i];
      if(obj[k] == null) obj[k] = {};
      obj = obj[k];
    }
    obj[parts[parts.length-1]] = value;
  }

  // --------------------------------------------------------------
  // Hero Background & Theme Application (Requirement 5)
  // --------------------------------------------------------------
  function applyHeroBg(heroEl){
    const bgUrl = state.hero.bg || "https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?w=1800&q=70";
    document.documentElement.style.setProperty('--hero-bg-image', `url("${bgUrl}")`);
    if(!heroEl) heroEl = $('.hero');
    if(heroEl){
      heroEl.style.setProperty('--hero-bg-image', `url("${bgUrl}")`);
    }
  }

  function applyTheme(){
    const t = state.theme || {};
    const root = document.documentElement;
    if(t.pageBg) root.style.setProperty('--bg', t.pageBg);
    if(t.pageText) root.style.setProperty('--text', t.pageText);
    if(t.accent) root.style.setProperty('--ember', t.accent);
    if(t.accent2) root.style.setProperty('--forest', t.accent2);
    if(t.sectionBg) root.style.setProperty('--bg-soft', t.sectionBg);
    if(t.footerBg) root.style.setProperty('--footer-bg', t.footerBg);
    if(t.footerText) root.style.setProperty('--footer-text', t.footerText);
    if(t.heading && t.heading.font){
      root.style.setProperty('--font-heading', window.WO_fontStack ? window.WO_fontStack(t.heading.font) : 'sans-serif');
    }

    // Page background image support
    if(t.pageBgImage){
      document.body.style.backgroundImage = `url("${t.pageBgImage}")`;
      document.body.style.backgroundAttachment = 'fixed';
      document.body.style.backgroundSize = 'cover';
    } else {
      document.body.style.backgroundImage = '';
    }

    // Always re-apply hero bg to sync with state
    applyHeroBg();

    // Re-apply dynamic SEO meta tags from state
    applySEO();
  }

  function applySEO(){
    const s = state.seo || {};
    if(s.title){
      document.title = s.title;
      const tEl = document.querySelector('title[data-edit="site.title"]');
      if(tEl) tEl.textContent = s.title;
    }
    if(s.metaDescription){
      let m = document.querySelector('meta[name="description"]');
      if(m) m.setAttribute('content', s.metaDescription);
    }
    if(s.canonicalUrl){
      let c = document.getElementById('canonical');
      if(c) c.setAttribute('href', s.canonicalUrl);
    }
    if(s.ogTitle){
      let og = document.querySelector('meta[property="og:title"]');
      if(og) og.setAttribute('content', s.ogTitle);
      let tw = document.querySelector('meta[name="twitter:title"]');
      if(tw) tw.setAttribute('content', s.ogTitle);
    }
    if(s.ogDescription){
      let og = document.querySelector('meta[property="og:description"]');
      if(og) og.setAttribute('content', s.ogDescription);
      let tw = document.querySelector('meta[name="twitter:description"]');
      if(tw) tw.setAttribute('content', s.ogDescription);
    }
    if(s.ogImage){
      let og = document.querySelector('meta[property="og:image"]');
      if(og) og.setAttribute('content', s.ogImage);
      let tw = document.querySelector('meta[name="twitter:image"]');
      if(tw) tw.setAttribute('content', s.ogImage);
    }
    if(s.robots){
      let rob = document.querySelector('meta[name="robots"]');
      if(rob) rob.setAttribute('content', s.robots);
    }
    if(s.keywords){
      let kw = document.querySelector('meta[name="keywords"]');
      if(!kw){
        kw = document.createElement('meta');
        kw.name = 'keywords';
        document.head.appendChild(kw);
      }
      kw.setAttribute('content', s.keywords);
    }
  }

  // --------------------------------------------------------------
  // Lightbox Viewer
  // --------------------------------------------------------------
  let lbList = [];
  let lbIdx = 0;

  function openLightbox(target, list){
    if(list && Array.isArray(list)){
      lbList = list.slice();
    } else {
      lbList = (state.highlights.items || []).map(h => h.src || h).filter(Boolean);
    }
    lbIdx = lbList.indexOf(target);
    if(lbIdx === -1) lbIdx = 0;
    showLightbox();
  }

  function showLightbox(){
    const lb = $('#lightbox');
    if(!lb || !lbList.length) return;
    const item = lbList[lbIdx];
    const content = lb.querySelector('.lb-content');
    content.innerHTML = '';

    const src = typeof item === 'string' ? item : (item.src || '');
    if(src){
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      content.appendChild(img);
    }

    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
  }

  function closeLightbox(){
    const lb = $('#lightbox');
    if(!lb) return;
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
  }

  function lbNav(dir){
    if(!lbList.length) return;
    lbIdx = (lbIdx + dir + lbList.length) % lbList.length;
    showLightbox();
  }

  function wireLightbox(){
    const lb = $('#lightbox');
    if(!lb) return;
    lb.querySelector('.lb-close').addEventListener('click', closeLightbox);
    lb.querySelector('.lb-prev').addEventListener('click', () => lbNav(-1));
    lb.querySelector('.lb-next').addEventListener('click', () => lbNav(1));
    lb.addEventListener('click', (e) => { if(e.target === lb) closeLightbox(); });
    document.addEventListener('keydown', (e) => {
      if(!lb.classList.contains('open')) return;
      if(e.key === 'Escape') closeLightbox();
      if(e.key === 'ArrowLeft') lbNav(-1);
      if(e.key === 'ArrowRight') lbNav(1);
    });
  }

  // --------------------------------------------------------------
  // Modal Helpers
  // --------------------------------------------------------------
  let modalSaveCb = null;
  function openModal(opts){
    const m = $('#modal');
    if(!m) return;
    $('#modalTitle').textContent = opts.title || 'Edit';
    const body = $('#modalBody');
    body.innerHTML = '';

    (opts.fields || []).forEach(f => {
      const row = document.createElement('div');
      row.className = 'field';
      row.style.marginBottom = '12px';
      const label = document.createElement('label');
      label.textContent = f.label || f.key;
      row.appendChild(label);

      let inp;
      if(f.textarea){
        inp = document.createElement('textarea');
        inp.rows = 3;
      } else {
        inp = document.createElement('input');
        inp.type = f.type || 'text';
      }
      inp.name = f.key;
      inp.value = f.value || '';
      inp.placeholder = f.placeholder || '';
      row.appendChild(inp);
      body.appendChild(row);
    });

    modalSaveCb = opts.onSave;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
  }

  function closeModal(){
    const m = $('#modal');
    if(m){
      m.classList.remove('open');
      m.setAttribute('aria-hidden', 'true');
    }
  }

  function saveModal(){
    const body = $('#modalBody');
    if(!body) return;
    const vals = {};
    $$('input, textarea, select', body).forEach(el => {
      if(el.name) vals[el.name] = el.value;
    });
    closeModal();
    if(typeof modalSaveCb === 'function') modalSaveCb(vals);
  }

  function wireModal(){
    const m = $('#modal');
    if(!m) return;
    $('#modalCancel').addEventListener('click', closeModal);
    $('#modalOk').addEventListener('click', saveModal);
    m.addEventListener('click', (e) => { if(e.target === m) closeModal(); });
  }

  // --------------------------------------------------------------
  // Theme & Bookings Panels
  // --------------------------------------------------------------
  function openThemePanel(){
    const p = $('#themePanel'), s = $('#tpScrim');
    if(p) p.classList.add('open');
    if(s) s.classList.add('open');
  }
  function closeThemePanel(){
    const p = $('#themePanel'), s = $('#tpScrim');
    if(p) p.classList.remove('open');
    if(s) s.classList.remove('open');
  }
  function openBookingsPanel(){
    const p = $('#bkPanel'), s = $('#bkpScrim');
    if(p) p.classList.add('open');
    if(s) s.classList.add('open');
    loadBookingsList();
  }
  function closeBookingsPanel(){
    const p = $('#bkPanel'), s = $('#bkpScrim');
    if(p) p.classList.remove('open');
    if(s) s.classList.remove('open');
  }

  async function loadBookingsList(){
    const body = $('#bkpBody');
    if(!body) return;
    body.innerHTML = '<p class="muted">Loading enquiries…</p>';
    if(!window.Backend || !Backend.configured()){
      body.innerHTML = '<p class="muted">Connect Supabase to inspect database bookings.</p>';
      return;
    }
    const rows = await Backend.loadBookings();
    if(!rows.length){
      body.innerHTML = '<p class="muted">No booking enquiries recorded yet.</p>';
      return;
    }
    body.innerHTML = '';
    rows.forEach(r => {
      const it = document.createElement('div');
      it.className = 'bk-item';
      it.innerHTML = `
        <div class="bk-top">
          <strong>${escapeHtml(r.name || 'Anonymous')}</strong>
          <span class="bk-ref">${escapeHtml(r.ref || '')}</span>
        </div>
        <div class="bk-when">📅 ${escapeHtml(r.date || '')} · ⏱ ${escapeHtml(r.package || '')}</div>
        <div class="bk-rows">
          <div><span>Phone</span><span>${escapeHtml(r.phone || '')}</span></div>
          <div><span>Email</span><span>${escapeHtml(r.email || '')}</span></div>
          <div><span>Participants</span><span>${escapeHtml(r.people || '1')}</span></div>
          <div><span>Payment</span><span>${escapeHtml(r.payment || '')}</span></div>
        </div>
      `;
      body.appendChild(it);
    });
  }

  // --------------------------------------------------------------
  // Admin Features (Lock, Invite, JSON)
  // --------------------------------------------------------------
  async function toggleSiteLock(){
    if(!window.Backend || !Backend.configured()) return;
    const cur = await Backend.getViewLock();
    let newCode;
    if(cur){
      if(!confirm('Unlock site for public visitors?')) return;
      newCode = '';
    }else{
      const c = prompt('Set viewing passcode for visitors:', 'preview2026');
      if(c === null) return;
      newCode = c.trim();
    }
    await Backend.setViewLock(newCode);
    alert(newCode ? 'Site locked. Passcode: ' + newCode : 'Site is now unlocked.');
  }

  async function createInvite(){
    const email = prompt('Invite editor email address:');
    if(!email) return;
    const r = await Backend.inviteEditor(email.trim());
    if(r && r.ok) alert('Invited ' + r.email);
    else alert('Could not invite: ' + ((r && r.error) || 'unknown error'));
  }

  function changePasscode(){
    const pass = prompt('Enter new account password (at least 6 characters):');
    if(!pass || pass.length < 6) return;
    Backend.changePassword(pass).then(r => {
      if(r && r.ok) alert('Password updated successfully.');
      else alert('Could not update password.');
    });
  }

  function exportJson(){
    const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wanderer-outdoors-content.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson(){
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0]; if(!f) return;
      const r = new FileReader();
      r.onload = () => {
        try{
          state = mergeWithDefaults(JSON.parse(r.result));
          saveState();
          renderNav();
          renderActiveView();
          alert('Content imported successfully.');
        }catch(e){ alert('Import error: ' + e.message); }
      };
      r.readAsText(f);
    });
    inp.click();
  }

  // --------------------------------------------------------------
  // Application Boot (DOMContentLoaded)
  // --------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check Supabase connection
    if(window.Backend && Backend.configured()){
      serverMode = true;
      try{
        const sess = await Backend.getSession();
        if(sess && await Backend.isEditor()){
          adminKey = sess.user.email;
        }
      }catch(e){}
    }

    // 2. Fetch remote content
    const remote = await fetchContent();
    if(remote !== null && Object.keys(remote).length > 0){
      state = mergeWithDefaults(remote);
      setSyncStatus('saved');
    }else{
      state = loadState();
      setSyncStatus();
    }

    // 3. Apply global theme & branding
    document.title = state.site.title || 'The Wanderer Outdoors';
    $('[data-edit="site.title"]') && ($('[data-edit="site.title"]').textContent = state.site.title);
    $('#brandLogo') && ($('#brandLogo').src = state.brand.logo || 'assets/logo.png');
    $('[data-edit="brand.name"]') && ($('[data-edit="brand.name"]').textContent = state.brand.name);
    $('[data-edit="brand.tagline"]') && ($('[data-edit="brand.tagline"]').textContent = state.brand.tagline);
    $('#year') && ($('#year').textContent = state.footer.copyYear || new Date().getFullYear());
    const footerWa = document.querySelector('.footer a[href^="https://wa.me/"]');
    if(footerWa) footerWa.href = (state.buttonLinks && state.buttonLinks.footerWhatsApp) || 'https://wa.me/917387778296';
    const footerMail = document.querySelector('.footer a[href^="mailto:"]');
    if(footerMail) footerMail.href = (state.buttonLinks && state.buttonLinks.footerEmail) || 'mailto:hello@wandereroutdoors.in';
    applyTheme();

    // Floating WhatsApp
    const floatWa = document.querySelector('.wa-float');
    if(floatWa) floatWa.href = (state.buttonLinks && state.buttonLinks.floatingWhatsApp) || ('https://wa.me/' + (state.contact.whatsapp||'917387778296').replace(/\D/g,''));

    // 4. Render Dynamic Primary Navigation
    renderNav();

    // 5. Wire App Shell events
    $('#navToggle') && $('#navToggle').addEventListener('click', () => {
      $('.primary-nav').classList.toggle('open');
    });

    wireAdminMode();
    wireLightbox();
    wireModal();
    wireReceiptModal();

    $('#tpClose') && $('#tpClose').addEventListener('click', closeThemePanel);
    $('#tpDone')  && $('#tpDone').addEventListener('click', closeThemePanel);
    $('#bkpClose')&& $('#bkpClose').addEventListener('click', closeBookingsPanel);
    $('#bkpDone') && $('#bkpDone').addEventListener('click', closeBookingsPanel);

    // 6. Router initialization
    window.addEventListener('popstate', handleRoute);
    window.addEventListener('hashchange', handleRoute);
    handleRoute();

    // Public pages are always visitor-only. Editing happens exclusively in /admin/.
    setAdminMode(false);
  });

})();
