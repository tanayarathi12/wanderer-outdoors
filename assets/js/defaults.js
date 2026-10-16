/* ============================================================
   The Wanderer Outdoors — shared default content
   ------------------------------------------------------------
   A single source of truth for the DEFAULT site state, used by
   both the public SPA (app.js) and the Control Room (admin/).

   Exposes on window:
     WO_DEFAULTS         -> the default state object
     WO_FONT_OPTIONS     -> font choices
     WO_THEME_PRESETS    -> colour presets
     WO_fontStack(v)     -> css font stack for a font key
     WO_newId(prefix)    -> unique id generator
     WO_normalizeItem(it)-> ensures trip item has all modern fields
   ============================================================ */
(function () {
  "use strict";

  // Curated Unsplash photo URLs (open license) – starter gallery placeholders.
  var PH = {
    snow:    'https://images.unsplash.com/photo-1483728642387-6c3bdd6c94e3?w=900&q=70',
    snow2:   'https://images.unsplash.com/photo-1517299321609-52687d1bc55a?w=900&q=70',
    snow3:   'https://images.unsplash.com/photo-1548776207-1864199501-49e36ce1fcd2?w=900&q=70',
    summer:  'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=900&q=70',
    summer2: 'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=900&q=70',
    summer3: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=900&q=70',
    trek:    'https://images.unsplash.com/photo-1551632811-561732d1e306?w=900&q=70',
    trek2:   'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?w=900&q=70',
    trek3:   'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=900&q=70',
    tour:    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=900&q=70',
    tour2:   'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=900&q=70',
    tour3:   'https://images.unsplash.com/photo-1524492412937-b28074a11478?w=900&q=70',
    outing:  'https://images.unsplash.com/photo-1533630359083-4aeafdcb85bf?w=900&q=70',
    outing2: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=900&q=70',
    outing3: 'https://images.unsplash.com/photo-1492447166138-50c3889fccb1?w=900&q=70',
    corp:    'https://images.unsplash.com/photo-1521737852567-6949f3f9f2b5?w=900&q=70',
    corp2:   'https://images.unsplash.com/photo-1543269865-cbf427effbad?w=900&q=70',
    corp3:   'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=900&q=70'
  };

  function h(prefix){ return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9); }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Safe normalization of trip items for backwards compatibility
  function normalizeItem(it) {
    if (!it || typeof it !== 'object') it = {};
    var id = it.id || h('i');
    var name = it.name || 'Untitled Adventure';
    var slug = it.slug || slugify(name) || ('item-' + id);

    // Normalize cover image
    var cover = { url: '', path: '' };
    if (typeof it.coverImage === 'string') {
      cover.url = it.coverImage;
    } else if (it.coverImage && typeof it.coverImage === 'object') {
      cover.url = it.coverImage.url || '';
      cover.path = it.coverImage.path || '';
    }

    // Normalize gallery
    var gallery = [];
    if (Array.isArray(it.gallery)) {
      gallery = it.gallery.map(function (g) {
        if (typeof g === 'string') return { url: g, path: '' };
        if (g && typeof g === 'object') return { url: g.url || '', path: g.path || '' };
        return { url: '', path: '' };
      }).filter(function (g) { return !!g.url; });
    }

    // Normalize visibility toggles
    var vis = it.visibility || {};
    var defaultVis = {
      description: it.desc ? true : false,
      highlights: (Array.isArray(it.highlights) && it.highlights.length) ? true : false,
      itinerary: (Array.isArray(it.itinerary) && it.itinerary.length) ? true : false,
      inclusions: (Array.isArray(it.inclusions) && it.inclusions.length) ? true : false,
      exclusions: (Array.isArray(it.exclusions) && it.exclusions.length) ? true : false,
      thingsToCarry: (Array.isArray(it.thingsToCarry) && it.thingsToCarry.length) ? true : false,
      faq: (Array.isArray(it.faqs) && it.faqs.length) ? true : false,
      gallery: gallery.length ? true : false,
      payment: true,
      booking: true
    };
    var finalVis = Object.assign({}, defaultVis, vis);

    // Normalize payment configuration per-item
    var pay = it.payment || {};
    var finalPay = {
      cashEnabled: (pay.cashEnabled !== undefined) ? !!pay.cashEnabled : true,
      upiEnabled: (pay.upiEnabled !== undefined) ? !!pay.upiEnabled : true,
      upiId: pay.upiId || '7387778296@upi',
      qrImage: pay.qrImage || '',
      paymentLink: pay.paymentLink || pay.link || '',
      instructions: pay.instructions || '',
      amount: pay.amount || ''
    };

    return {
      id: id,
      name: name,
      slug: slug,
      cost: it.cost || '',
      dates: it.dates || '',
      days: it.days || '',
      coverImage: cover,
      gallery: gallery,
      desc: it.desc || '',
      highlights: Array.isArray(it.highlights) ? it.highlights : (it.highlights ? [String(it.highlights)] : []),
      itinerary: Array.isArray(it.itinerary) ? it.itinerary : [],
      inclusions: Array.isArray(it.inclusions) ? it.inclusions : [],
      exclusions: Array.isArray(it.exclusions) ? it.exclusions : [],
      thingsToCarry: Array.isArray(it.thingsToCarry) ? it.thingsToCarry : [],
      faqs: Array.isArray(it.faqs) ? it.faqs : [],
      visibility: finalVis,
      payment: finalPay
    };
  }

  // 13 Views for modular SPA architecture
  var DEFAULT_VIEWS = [
    { id: 'home', title: 'Home', path: '/', inNav: false, enabled: true },
    { id: 'treks', title: 'Treks', path: '/treks', inNav: true, enabled: true, kicker: 'Sahyadri & Himalayan Treks' },
    { id: 'winter', title: 'Winter Camps', path: '/winter-camps', inNav: true, enabled: true, kicker: 'Snow & Stargazing' },
    { id: 'summer', title: 'Summer Camps', path: '/summer-camps', inNav: true, enabled: true, kicker: 'Alpine Meadows' },
    { id: 'tours', title: 'Tours', path: '/tours', inNav: true, enabled: true, kicker: 'Curated Circuits' },
    { id: 'outings', title: 'Outings', path: '/outings', inNav: true, enabled: true, kicker: 'Day Escapes' },
    { id: 'corporate', title: 'Corporate', path: '/corporate', inNav: true, enabled: true, kicker: 'Team Offsites' },
    { id: 'gallery', title: 'Highlights', path: '/gallery', inNav: true, enabled: true, kicker: 'Trips on Film' },
    { id: 'reviews', title: 'Reviews', path: '/reviews', inNav: true, enabled: true, kicker: 'Traveller Stories' },
    { id: 'blog', title: 'Blog', path: '/blog', inNav: true, enabled: true, kicker: 'Trail Guides' },
    { id: 'faq', title: 'FAQ', path: '/faq', inNav: true, enabled: true, kicker: 'Help & Safety' },
    { id: 'contact', title: 'Contact', path: '/contact', inNav: true, enabled: true, kicker: 'Get in Touch' },
    { id: 'booking', title: 'Book Now', path: '/booking', inNav: true, enabled: true, kicker: 'Reserve Spot' }
  ];

  var DEFAULT_STATE = {
    buttonLinks: {
      // Hero section
      heroCta: '#/treks',
      heroCtaLabel: 'Plan an Adventure',
      // Home CTA Banner ("Ready to explore the outdoors?")
      homeCTATitle: 'Ready to explore the outdoors?',
      homeCTASubtitle: 'Speak directly with our instructors on WhatsApp or book your spot in under 2 minutes.',
      homeReserveLabel: 'Reserve a Spot',
      homeReserve: '#/contact',
      homeWhatsApp: 'https://wa.me/917387778296',
      // Home featured trips "View all" button
      featuredTrips: '#/treks',
      featuredTripsLabel: 'View all treks & camps ▸',
      // Blog Article action buttons
      blogCtaLabel: 'Plan a Trip with Us',
      blogCtaHref: '#/contact',
      blogBackLabel: '← Back to Articles',
      // Contact Us & Enquiry form buttons
      contactSubmitLabel: 'Submit enquiry',
      contactSubmitRedirect: '',
      // Booking flow
      bookingSubmitLabel: 'Confirm Booking',
      bookAnotherLabel: 'Book another trip',
      // Floating WhatsApp
      floatingWhatsApp: 'https://wa.me/917387778296',
      // Footer
      footerWhatsApp: 'https://wa.me/917387778296',
      footerEmail: 'mailto:hello@wandereroutdoors.in',
      footerInstagram: 'https://www.instagram.com/the_wanderer_outdoors/'
    },
    site: {
      title: 'The Wanderer Outdoors'
    },
    seo: {
      title: 'The Wanderer Outdoors — Live. Travel. Explore.',
      metaDescription: 'Adventure and outdoor activities — winter & summer camps, treks, tours, outings and corporate events across the Indian Himalayas and Sahyadris.',
      canonicalUrl: 'https://www.wandereroutdoors.in/',
      ogTitle: 'The Wanderer Outdoors — Live. Travel. Explore.',
      ogDescription: 'Hand-crafted Himalayan & Sahyadri treks, winter & summer camps, tours, day outings and corporate offsites.',
      ogImage: 'https://www.wandereroutdoors.in/assets/logo.png',
      keywords: 'Himalayan treks, Sahyadri treks, winter camps, summer camps, adventure tours, day outings, corporate offsites, The Wanderer Outdoors',
      robots: 'index, follow'
    },
    brand: {
      name: 'The Wanderer Outdoors',
      tagline: 'Adventure · Treks · Outdoors',
      logo: 'assets/logo.png'
    },
    hero: {
      title: 'Find your next summit.',
      subtitle: 'Hand-crafted winter camps, summer camps, treks, tours, day outings and corporate retreats across the Indian Himalayas and beyond.',
      ctaText: 'Plan an Adventure',
      ctaHref: '/treks',
      bg: ''
    },
    views: DEFAULT_VIEWS,
    contact: {
      kicker: 'Contact',
      title: "Let's plan your adventure.",
      intro: "Tell us what kind of trip you're dreaming of — we'll get back within 24 hours.",
      phone: '+91 7387778296',
      email: 'hello@wandereroutdoors.in',
      instagram: '@the_wanderer_outdoors',
      instagramUrl: 'https://www.instagram.com/the_wanderer_outdoors/',
      city: 'Maharashtra, India',
      whatsapp: '917387778296'
    },
    booking: {
      kicker: 'Book Your Adventure',
      title: 'Reserve your spot.',
      intro: "Fill in the details and we'll confirm your booking on WhatsApp within 24 hours.",
      whatsapp: '917387778296'
    },
    theme: {
      preset: 'light',
      pageBg: '#FAF7F2',
      pageBgImage: '',
      pageText: '#1A1F1B',
      accent: '#D9582B',
      accent2: '#1F4D36',
      sectionBg: '#F1ECE3',
      footerBg: '#F1ECE3',
      footerText: '#1A1F1B',
      heading: { font: 'system', size: 40, weight: 700, color: '' },
      body:    { font: 'system', size: 16, weight: 400, color: '' },
      sections: {}
    },
    customTrip: { kicker: 'Your journey, your way', title: 'Plan Your Trip With Us', description: 'Tell us where you want to go, when you want to travel, and what kind of experience you have in mind. We’ll help curate a trip around you.', buttonTextLabel: 'Plan My Trip', buttonUrl: '#/contact', background: '#1F4D36', text: '#FFFFFF', buttonBackground: '#D9582B', buttonText: '#FFFFFF' },
    footer: {
      copyYear: new Date().getFullYear(),
      tagline: 'Crafted for explorers.'
    },
    googleReviews: {
      enabled: false,
      method: 'places',          // 'places' = live via server proxy, or 'manual' = link only
      placeId: '',
      limit: 5,
      showManual: true,          // show curated customer testimonials alongside live Google reviews
      rating: '',                // OPTIONAL honest badge number; leave blank to hide the score
      attribution: 'Google',
      reviewUrl: '',
      displayMode: 'latest'
    },
    highlights: {
      kicker: 'Highlights',
      title: 'Trips on film.',
      subtitle: 'A taste of the trails, summits and sunsets our travellers experience.',
      items: [
        { id: h('hl'), type: 'photo', src: PH.snow, caption: 'Frozen peaks at sunrise' },
        { id: h('hl'), type: 'photo', src: PH.trek2, caption: 'The trail to Hampta Pass' },
        { id: h('hl'), type: 'photo', src: PH.summer3, caption: 'Above the clouds' }
      ]
    },
    sections: [
      {
        key: 'treks', id: 'treks', kicker: 'Monsoon & Himalayan Treks', title: 'Himalayan & Sahyadri treks for every level.',
        intro: 'From lush waterfall day-hikes in the Western Ghats to challenging Himalayan summit climbs — led by experienced mountain guides.',
        bg: '', bookType: 'Trek',
        gallery: [PH.trek, PH.trek2, PH.trek3],
        items: [
          normalizeItem({
            id: 't_devkund', name: 'Devkund Waterfall Trek', cost: '1,399', dates: '20th Sept (Sunday)', days: '1 day',
            coverImage: { url: PH.trek, path: '' },
            desc: 'A mesmerizing forest trek through the Bhira village trail leading to the azure pool of Devkund Waterfall.',
            highlights: ['Bhira dam backwaters', 'Dense forest trail', 'Natural plunge pool', 'Breakfast & authentic Maharashtrian lunch'],
            itinerary: [
              { day: 'Day 1', title: 'The Trail & Waterfall', desc: '5:00 AM Departure from Pune. 8:30 AM Reach base village, breakfast. 9:15 AM Trek starts through dense canopy and stream crossings. 12:00 PM Reach Devkund Waterfall. 1:30 PM Return trek, authentic lunch at base. 8:00 PM Reach Pune.' }
            ],
            inclusions: ['Private transport Pune to Pune', 'Breakfast & Lunch', 'Forest entry permits', 'Certified trek leaders & first aid'],
            exclusions: ['Personal expenses', 'Packaged mineral water', 'Anything not mentioned in inclusions'],
            thingsToCarry: ['Good grip trekking shoes', 'Extra pair of clothes', 'Raincoat/poncho', '2 liters water', 'Dry snacks'],
            faqs: [
              { q: 'Is swimming allowed?', a: 'Swimming is strictly prohibited in Devkund pool for safety reasons.' },
              { q: 'Is this suitable for beginners?', a: 'Yes! It is an easy to moderate flat trail suitable for beginners and families.' }
            ],
            visibility: { description: true, highlights: true, itinerary: true, inclusions: true, exclusions: true, thingsToCarry: true, faq: true, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 't_rajgad', name: 'Rajgad Fort Trek — Special Flowering Season', cost: '1,399', dates: '2nd Oct 2026', days: '1 day',
            coverImage: { url: PH.trek2, path: '' },
            desc: 'Explore the King of Forts during peak wildflower bloom. Walk through Padmavati Machee, Suvela Machi and enjoy breathtaking Sahyadri views.',
            highlights: ['Historic Capital of the Maratha Empire', 'Suvela Machi nedhe (needle hole rock)', 'Wildflower carpet', 'Authentic rustic lunch'],
            itinerary: [
              { day: 'Day 1', title: 'Ascent to the Royal Citadel', desc: '5:30 AM Pune departure. 8:00 AM Gunjavane base village breakfast. 8:30 AM Start ascent via Chor Darwaja. 11:30 AM Reach Padmavati temple, explore Suvela Machi. 2:00 PM Descend, hearty village lunch. 7:30 PM Return to Pune.' }
            ],
            inclusions: ['Transport from Pune', 'Breakfast & hot local lunch', 'Expert trek leadership', 'First aid support'],
            exclusions: ['Personal expenses', 'Emergency evacuation'],
            thingsToCarry: ['Trek shoes with firm grip', 'Water bottle (minimum 2L)', 'Sun cap & rain jacket'],
            faqs: [
              { q: 'How tough is the climb?', a: 'Rajgad has a moderate gradient with rock-cut steps near Chor Darwaja.' }
            ],
            visibility: { description: true, highlights: true, itinerary: true, inclusions: true, exclusions: true, thingsToCarry: true, faq: true, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 't_andharban', name: 'Andharban Dark Forest Trail', cost: '1,299', dates: 'Every Weekend', days: '1 day',
            coverImage: { url: PH.trek3, path: '' },
            desc: 'A legendary 13km descent through the dense, misty canopy of Tamhini Ghat overlooking the Kundalika Valley.',
            highlights: ['13km shaded canopy descent', 'Kundalika valley viewpoint', 'Misty stream crossings'],
            inclusions: ['Private bus transport', 'Breakfast & village lunch', 'Forest entry tickets', 'Trek leads'],
            exclusions: ['Personal snacks', 'Insurance'],
            thingsToCarry: ['Trekking shoes with rubber sole', 'Poncho/windcheater', 'Dry bag for electronics'],
            visibility: { description: true, highlights: true, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 't_nanemachi', name: 'Nanemachi Waterfall Trek', cost: '1,399', dates: 'Saturdays', days: '1 day',
            coverImage: { url: PH.trek, path: '' },
            desc: 'A hidden turquoise blue natural waterfall nestled inside Mahad forest.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 't_harishchandragad', name: 'Harishchandragad & Konkan Kada', cost: '1,499', dates: 'Weekends', days: '1 day',
            coverImage: { url: PH.trek2, path: '' },
            desc: 'Witness the iconic semicircular cliff of Konkan Kada and ancient Kedareshwar cave.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 't_aadrai', name: 'Aadrai Jungle Trek', cost: '1,599', dates: 'Sundays', days: '1 day',
            coverImage: { url: PH.trek3, path: '' },
            desc: 'Trek into one of the most untouched and pristine jungle trails in Malshej Ghat.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          })
        ]
      },
      {
        key: 'winter', id: 'winter', kicker: 'Winter Camps', title: 'Snow, stars & bonfires.',
        intro: 'Multi-day guided camps in snow-clad Himalayan meadows, with shelter, meals, gear and trained leaders.',
        bg: '', bookType: 'Winter Camp',
        gallery: [PH.snow, PH.snow2, PH.snow3],
        items: [
          normalizeItem({
            id: 'w_kedarkantha', name: 'Kedarkantha Winter Summit Trek', cost: '6,999', dates: 'Dec – Feb', days: '6 days',
            coverImage: { url: PH.snow, path: '' },
            desc: 'The classic winter summit trek of Uttarakhand with 360-degree snow peaks and enchanting pine clearings.',
            highlights: ['12,500 ft summit sunrise', 'Juda Ka Talab frozen lake campsite', 'Snow-covered pine forests'],
            inclusions: ['Sankri to Sankri stay & meals', 'Camping tents & sleeping bags', 'Crampons / microspikes', 'Certified mountain guide'],
            exclusions: ['Transport to Sankri', 'Rucksack offloading', 'Personal gear'],
            thingsToCarry: ['Waterproof trek boots', 'Puffer jacket & fleece layers', 'Thermal inners', 'UV sunglasses'],
            visibility: { description: true, highlights: true, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 'w_brahmatal', name: 'Brahmatal Winter Trek', cost: '7,499', dates: 'Dec – Mar', days: '6 days',
            coverImage: { url: PH.snow2, path: '' },
            desc: 'Frozen alpine lake trek offering majestic panoramas of Mt. Trishul and Mt. Nanda Ghunti.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 'w_deoriatal', name: 'Deoriatal – Chandrashila Winter Camp', cost: '5,499', dates: 'Dec – Mar', days: '5 days',
            coverImage: { url: PH.snow3, path: '' },
            desc: 'Camp by the emerald waters of Deoria Tal and summit to Tungnath, the highest Shiva temple in the world.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 'w_kuari', name: 'Kuari Pass Winter Trek', cost: '8,999', dates: 'Jan – Mar', days: '7 days',
            coverImage: { url: PH.snow, path: '' },
            desc: 'The historic Curzon trail with up-close views of Nanda Devi, Kamet and Dronagiri.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          })
        ]
      },
      {
        key: 'summer', id: 'summer', kicker: 'Summer Camps', title: 'Meadows in bloom.',
        intro: 'Multi-day summer camps in alpine meadows — guided hikes, campfires, and stargazing under open skies.',
        bg: '', bookType: 'Summer Camp',
        gallery: [PH.summer, PH.summer2, PH.summer3],
        items: [
          normalizeItem({
            id: 's_hampta', name: 'Hampta Pass Summer Trek', cost: '6,999', dates: 'Jun – Sep', days: '5 days',
            coverImage: { url: PH.summer, path: '' },
            desc: 'A dramatic pass crossing from the lush green valleys of Kullu to the stark desert landscapes of Lahaul.',
            highlights: ['Crossover trek experience', 'Chandratal high-altitude moon lake', 'Shea Goru river crossing'],
            inclusions: ['Manali to Manali', 'Tents & meals', 'Mountaineering equipment', 'Permits'],
            visibility: { description: true, highlights: true, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 's_valley', name: 'Valley of Flowers & Hemkund Sahib', cost: '7,999', dates: 'Jul – Sep', days: '6 days',
            coverImage: { url: PH.summer2, path: '' },
            desc: 'UNESCO World Heritage botanical paradise bursting with rare Himalayan flora.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 's_bhrigu', name: 'Bhrigu Lake Alpine Meadow Trek', cost: '5,999', dates: 'May – Oct', days: '4 days',
            coverImage: { url: PH.summer3, path: '' },
            desc: 'High-altitude sacred lake nestled amidst sprawling rolling meadows above Manali.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          })
        ]
      },
      {
        key: 'tours', id: 'tours', kicker: 'Circuit Tours', title: 'Curated multi-day tours.',
        intro: 'All-inclusive circuit tours with stays, transfers, meals and a trip leader — just show up.',
        bg: '', bookType: 'Tour',
        gallery: [PH.tour, PH.tour2, PH.tour3],
        items: [
          normalizeItem({
            id: 'o_kaas', name: 'Kaas Pathar Valley of Flowers Camp', cost: '4,500', dates: '10–11 Oct 2026', days: '2 days',
            coverImage: { url: PH.tour, path: '' },
            desc: 'Experience the UNESCO natural heritage plateau carpeted in vibrant post-monsoon blooms, combined with lakeside camping at Koyna backwaters.',
            highlights: ['Kaas plateau endemic flowering', 'Koyna dam backwater campsite', 'Thoseghar waterfalls & Chalkewadi wind plateau', 'Comfortable family-friendly stays'],
            inclusions: ['Comfortable transfers ex-Pune', 'Lakeside tented stay', 'All meals & evening tea', 'Kaas plateau entry fee'],
            exclusions: ['Personal expenses', 'Boating charges'],
            thingsToCarry: ['Camera', 'Comfortable walking shoes', 'Light sweater for evening'],
            visibility: { description: true, highlights: true, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 'o_spiti', name: 'Spiti Valley Complete Circuit Tour', cost: '19,999', dates: 'May – Oct', days: '7 days',
            coverImage: { url: PH.tour2, path: '' },
            desc: 'Traverse the middle land between Tibet and India. Visit centuries-old monasteries, Chandratal lake and the world\'s highest post office.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 'o_hampi', name: 'Badami – Hampi Heritage Explorer', cost: '15,500', dates: '23–25 Oct 2026', days: '3 days',
            coverImage: { url: PH.tour3, path: '' },
            desc: 'Journey through the boulder-strewn ruins of the Vijayanagara Empire, Vittala Stone Chariot, and coracle rides on Tungabhadra.',
            highlights: ['Sanapur coracle ride', 'Vittala temple & stone chariot', 'Royal enclosure sunset', 'Stay & food for kids below 6 free'],
            inclusions: ['Pune to Pune travel', 'AC resort stay', 'Breakfast and dinner', 'Local historian guide'],
            visibility: { description: true, highlights: true, itinerary: false, inclusions: true, exclusions: true, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          })
        ]
      },
      {
        key: 'outings', id: 'outings', kicker: 'Day Outings', title: 'Weekend getaways & day trips.',
        intro: 'Short escapes from the city — perfect for beginners, friend groups and family weekends.',
        bg: '', bookType: 'Outing',
        gallery: [PH.outing, PH.outing2, PH.outing3],
        items: [
          normalizeItem({
            id: 'u_ganapati', name: 'Pune Ganapati Darshan — Heritage Walk', cost: '500', dates: '18 & 19 Sept 2026', days: '1 day',
            coverImage: { url: PH.outing, path: '' },
            desc: 'Darshan • Dhol • Pune Vibes • Bappa’s Blessings. Guided traditional walk across Manache Ganpati and Shreemant Dagdusheth Halwai.',
            highlights: ['5 Manache Ganpati darshan', 'Dagdusheth Halwai temple', 'Traditional Puneri dhol tasha beats', 'Curated historic stories'],
            visibility: { description: true, highlights: true, itinerary: false, inclusions: true, exclusions: false, thingsToCarry: false, faq: false, gallery: true, payment: true, booking: true }
          }),
          normalizeItem({
            id: 'u_paragliding', name: 'Bir Billing Paragliding & Camping', cost: '2,499', dates: 'Year-round', days: '2 days',
            coverImage: { url: PH.outing2, path: '' },
            desc: 'Soar like a bird from world\'s second highest paragliding takeoff point with certified pilots.',
            visibility: { description: true, highlights: false, itinerary: false, inclusions: true, exclusions: false, thingsToCarry: true, faq: false, gallery: true, payment: true, booking: true }
          })
        ]
      },
      {
        key: 'corporate', id: 'corporate', kicker: 'Corporate Retreats', title: 'Offsites that build teams.',
        intro: 'Custom programs for teams — adventure activities, leadership games, evening bonfires and full logistics.',
        bg: '', bookType: 'Corporate Event',
        gallery: [PH.corp, PH.corp2, PH.corp3],
        items: [
          normalizeItem({
            id: 'c_team', name: 'Custom Team Adventure Retreat', cost: 'On request', dates: 'Custom dates', days: '2–4 days',
            coverImage: { url: PH.corp, path: '' },
            desc: 'Bespoke offsites crafted for companies (past clients include 100+ Microsoft team group, corporate leadership retreats).',
            highlights: ['Outdoor team bonding challenges', 'Bonfire networking nights', 'Complete end-to-end travel & stay logistics'],
            inclusions: ['Custom transport', 'Curated stay & meals', 'Professional experiential instructors'],
            visibility: { description: true, highlights: true, itinerary: false, inclusions: true, exclusions: false, thingsToCarry: false, faq: false, gallery: true, payment: true, booking: true }
          })
        ]
      }
    ],
    blogs: [
      {
        id: 'b_monsoon_guide',
        slug: 'monsoon-trekking-sahayadri-safety-guide',
        title: 'Monsoon Trekking in the Sahyadris: Complete Safety & Gear Guide',
        excerpt: 'Everything you need to know about navigating slippery ridges, waterfall crossings, and choosing the right footwear for Maharashtra monsoons.',
        coverImage: PH.trek,
        date: '2026-07-15',
        author: 'The Wanderer Outdoors Team',
        category: 'Trek Guide',
        readingTime: '5 min read',
        published: true,
        content: `
### Why the Sahyadris Come Alive in Monsoon

From June through September, the Western Ghats transform into an emerald wonderland. Clouds descend onto jagged ramparts, thousand-foot waterfalls cascade from plateaus, and moss coats ancient Maratha bastions.

However, monsoon trekking requires respect for mountain dynamics:

1. **Footwear is Your Lifeline**: Never wear flat-soled sneakers or running shoes. Opt for specialized rubber trekking shoes with deep treads that grip wet rock.
2. **Watch the Streams**: Flash floods can swell river crossings within minutes. Always cross in human chains under your trek lead's supervision.
3. **Keep Electronics Dry**: Triple-wrap phones, powerbanks and keys in zip-lock bags inside a waterproof dry sack.
4. **Leave No Trace**: Always carry all plastic, wrapper, and food waste back to the city. Respect local village ecology.
        `
      },
      {
        id: 'b_winter_prep',
        slug: 'how-to-prepare-for-your-first-winter-himalayan-trek',
        title: 'How to Prepare for Your First Winter Himalayan Trek',
        excerpt: 'Demystifying sub-zero camping, layering principles, and altitude acclimatization for beginners.',
        coverImage: PH.snow,
        date: '2026-11-20',
        author: 'The Wanderer Outdoors Team',
        category: 'Winter Camps',
        readingTime: '6 min read',
        published: true,
        content: `
### The 3-Layer System for Sub-Zero Warmth

Winter in Uttarakhand and Himachal brings crystalline night skies and knee-deep powdery snow. To stay cozy in -10°C, master the three-layer rule:

- **Base Layer**: Thermal polyester or merino wool inners that wick sweat away from skin.
- **Mid Layer**: High-loft fleece or down jacket that traps warm air.
- **Outer Shell**: Windproof and waterproof breathable jacket that blocks icy blizzards.

Stay hydrated with warm water, avoid cotton, and never sleep with your face inside your sleeping bag (breath moisture creates frost inside!).
        `
      }
    ],
    faqs: [
      { id: 'faq_1', category: 'General', q: 'How do I book a trek or camp with The Wanderer Outdoors?', a: 'You can click "Book Now" on any adventure, fill out your details, and submit. You will instantly receive a WhatsApp confirmation link with pre-filled details to chat directly with our team, and our staff will confirm your slot within 24 hours.' },
      { id: 'faq_2', category: 'General', q: 'Are all treks guided by experienced leads?', a: 'Yes! Every trek is accompanied by certified mountaineers, local guides with deep terrain knowledge, and trained first aid responders.' },
      { id: 'faq_3', category: 'Treks', q: 'What is included in Sahyadri day treks?', a: 'Our weekend Sahyadri day treks typically include round-trip transport from Pune, breakfast, authentic village lunch, forest entry permits, and trek guidance.' },
      { id: 'faq_4', category: 'Safety', q: 'Is there a medical kit on every trek?', a: 'Yes, our trek leaders carry a comprehensive first-aid kit with crepe bandages, antiseptic, pain relievers, and emergency contact protocols.' },
      { id: 'faq_5', category: 'Payment', q: 'How does payment verification work?', a: 'You can choose to pay now via UPI / QR code or pay on trip day. When paying via UPI, your booking is recorded as "VERIFICATION REQUIRED" until verified by our coordinator on WhatsApp.' }
    ],
    reviews: [
      { id: 'rv_1', name: 'Tanmay Joshi', role: 'Devkund Waterfall Trekker', text: 'Unforgettable experience! The team took immense care during the stream crossings and the authentic local village lunch was delicious. Highly recommend The Wanderer Outdoors!', photo: '' },
      { id: 'rv_2', name: 'Sneha Kulkarni', role: 'Kedarkantha Winter Summit', text: 'Summiting Kedarkantha with Wanderer Outdoors was the highlight of my winter. Superb tent equipment, warm food at 10,000 ft, and safety was always top priority.', photo: '' },
      { id: 'rv_3', name: 'Rohan Deshmukh', role: 'Rajgad Fort Trek', text: 'Loved the historical insights from our trek leader and the sunrise over Suvela Machi. Everything was well planned and on schedule.', photo: '' }
    ],
    extraSections: [],
    positions: {}
  };

  var FONT_OPTIONS = [
    { value: 'system',    label: 'System default',   stack: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif' },
    { value: 'serif',     label: 'Classic serif',    stack: 'Georgia,"Times New Roman",Times,serif' },
    { value: 'slab',      label: 'Bold slab',        stack: '"Rockwell","Bookman Old Style",Georgia,serif' },
    { value: 'mono',      label: 'Technical mono',   stack: '"SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace' },
    { value: 'soft',      label: 'Soft rounded',     stack: '"Trebuchet MS","Segoe UI",Verdana,sans-serif' },
    { value: 'condensed', label: 'Narrow condensed', stack: '"Arial Narrow","Helvetica Neue Condensed",Arial,sans-serif' }
  ];

  function fontStack(v){
    var f = FONT_OPTIONS.filter(function (x) { return x.value === v; })[0];
    return f ? f.stack : FONT_OPTIONS[0].stack;
  }

  var THEME_PRESETS = {
    light:  { label: 'Light', pageBg: '#FAF7F2', pageText: '#1A1F1B', accent: '#D9582B', accent2: '#1F4D36', sectionBg: '#F1ECE3', headingColor: '', bodyColor: '' },
    dark:   { label: 'Dark',  pageBg: '#111513', pageText: '#E7EDE9', accent: '#F3A776', accent2: '#7FC8A9', sectionBg: '#181E1A', headingColor: '#FFFFFF', bodyColor: '#C9D3CC' },
    forest: { label: 'Forest & Ember', pageBg: '#F2F6F1', pageText: '#16241C', accent: '#C24E1F', accent2: '#1F4D36', sectionBg: '#E3EBE2', headingColor: '#123021', bodyColor: '#3A4A40' },
    ocean:  { label: 'Ocean & Coral',  pageBg: '#F4F8FA', pageText: '#0F2027', accent: '#FF6B6B', accent2: '#0B7285', sectionBg: '#E3EEF3', headingColor: '#0B3B47', bodyColor: '#39545E' },
    sunset: { label: 'Sunset & Gold',  pageBg: '#FFF8F0', pageText: '#2B1B12', accent: '#E8590C', accent2: '#8C5A2B', sectionBg: '#F7E9D9', headingColor: '#3D2314', bodyColor: '#5C4433' }
  };

  window.WO_DEFAULTS = DEFAULT_STATE;
  window.WO_FONT_OPTIONS = FONT_OPTIONS;
  window.WO_THEME_PRESETS = THEME_PRESETS;
  window.WO_fontStack = fontStack;
  window.WO_newId = h;
  window.WO_slugify = slugify;
  window.WO_normalizeItem = normalizeItem;
})();
