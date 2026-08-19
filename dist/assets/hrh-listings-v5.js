/**
 * HRH Listings Enhancer (v4)
 * ---------------------------------------------------------------------------
 * Upgrades the existing "AVAILABLE HOMES" section on /thank-you in place.
 * It does NOT introduce a new design system: every class used here is a
 * Tailwind utility already present in the site's compiled stylesheet, and the
 * markup mirrors the SPA's own card anatomy (photo + status badge, address,
 * map-pin city row, bed/bath row, gray price panel, footer strip, red CTA).
 *
 * What it adds on top of the original section:
 *   - search by address / city / ZIP
 *   - filters: city, price band, beds, baths, status
 *   - sort options
 *   - a heart on every card to save homes (favorites API)
 *   - a "Saved Homes" tab in the same section (no separate page)
 *   - Zillow / tour links when the listing has them
 *   - live data from /api/properties instead of the stale bundled list
 *
 * Why a script instead of editing the React bundle: the bundle is minified and
 * patching it has broken the site before. Replacing the section's DOM keeps the
 * rest of the page (nav, hero, footer, pixels, chat widget) completely intact.
 */
(function () {
  "use strict";

  var NAVY = "#1B2A4A";
  var RED = "#C41E3A";
  var PHONE_HREF = "tel:+14057618014";
  var CTA_HREF = "/book-a-call";

  /* Only upgrade the gated listings page. index.html is served for every SPA
     route, including the public homepage, which has its own short
     "AVAILABLE HOMES" teaser (#property-teasers). Replacing that would publish
     the entire inventory on a public page and defeat the login gate. */
  var LISTINGS_PATHS = ["/thank-you"];
  function onListingsPage() {
    var p = location.pathname.replace(/\/+$/, "") || "/";
    return LISTINGS_PATHS.indexOf(p) > -1;
  }

  var state = {
    properties: [],
    user: null,
    favorites: [],
    tab: "browse", // "browse" | "saved"
    booted: false,
  };

  /* ── helpers ─────────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function getJSON(url, opts) {
    return fetch(url, Object.assign({ credentials: "same-origin" }, opts || {}))
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; })
          .catch(function () { return { ok: r.ok, status: r.status, data: null }; });
      })
      .catch(function () { return { ok: false, status: 0, data: null }; });
  }

  /* The sheet uses "$0" and "" interchangeably for "not published yet", so a
     zero must never be printed as a dollar amount. */
  function priceText(p) { return p.priceNum > 0 ? p.purchasePrice : "Contact Us"; }
  function monthlyText(p) { return p.monthlyNum > 0 ? p.monthlyPayment + "/mo" : "Contact Us"; }
  function downText(p) { return p.downNum > 0 ? p.downPayment : "TBD"; }
  function addrText(p) {
    var a = String(p.address || "").trim();
    return a || "Address Available on Request";
  }
  function cityText(p) {
    var c = p.cityCanonical || p.city || "";
    return c ? c + ", OK" : "Oklahoma";
  }
  function statusText(p) {
    var s = String(p.status || "Available").trim().toLowerCase();
    if (s.indexOf("sold") > -1) return "SOLD";
    if (s.indexOf("pend") > -1) return "PENDING";
    if (s.indexOf("coming") > -1) return "COMING SOON";
    return "AVAILABLE";
  }
  function statusBadgeClass(p) {
    var s = statusText(p);
    if (s === "SOLD") return "bg-[#C41E3A]";
    if (s === "PENDING") return "bg-amber-500";
    if (s === "COMING SOON") return "bg-gray-500";
    return "bg-green-600";
  }

  /* ── icons (same lucide paths the SPA already uses) ──────── */

  var ICON_PIN =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'class="lucide lucide-map-pin w-3.5 h-3.5 shrink-0"><path d="M20 10c0 4.993-5.539 10.193-7.399 ' +
    '11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>';

  var ICON_BED =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'class="lucide lucide-bed-double w-4 h-4 text-gray-400"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/>' +
    '<path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/></svg>';

  var ICON_BATH =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'class="lucide lucide-bath w-4 h-4 text-gray-400"><path d="M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.683 3 4 ' +
    '3.683 4 4.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><line x1="10" x2="8" y1="5" y2="7"/>' +
    '<line x1="2" x2="22" y1="12" y2="12"/><line x1="7" x2="7" y1="19" y2="21"/><line x1="17" x2="17" y1="19" y2="21"/></svg>';

  var ICON_SEARCH =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'class="lucide lucide-search w-4 h-4"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

  var ICON_HOME_BIG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
    'class="lucide lucide-house w-10 h-10 opacity-60"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>' +
    '<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

  var ICON_EXT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'class="lucide lucide-external-link w-3.5 h-3.5 shrink-0"><path d="M15 3h6v6"/><path d="M10 14 21 3"/>' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

  function heartSVG(filled) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
      'fill="' + (filled ? RED : "none") + '" stroke="' + (filled ? RED : NAVY) + '" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">' +
      '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  }

  /* ── section shell ───────────────────────────────────────── */

  function findSection() {
    if (!onListingsPage()) return null;
    var heads = document.querySelectorAll("#root h3, #root h2");
    for (var i = 0; i < heads.length; i++) {
      if (/AVAILABLE HOMES/i.test(heads[i].textContent || "")) {
        var sec = heads[i].closest("section");
        if (sec) return sec;
      }
    }
    return null;
  }

  function shellHTML() {
    var isSaved = state.tab === "saved";
    var savedCount = state.favorites.length;

    // Tab buttons only make sense once someone can actually save homes.
    var tabs = state.user
      ? '<div class="flex items-center justify-center gap-2 mb-8">' +
          '<button id="hrh-tab-browse" class="px-5 py-2.5 rounded-full font-bold text-sm transition-all duration-150 ' +
            (isSaved ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' : 'text-white') + '"' +
            (isSaved ? "" : ' style="background:' + NAVY + '"') + '>All Homes</button>' +
          '<button id="hrh-tab-saved" class="px-5 py-2.5 rounded-full font-bold text-sm transition-all duration-150 ' +
            (isSaved ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200') + '"' +
            (isSaved ? ' style="background:' + NAVY + '"' : "") + '>' +
            'Saved Homes' + (savedCount ? ' <span class="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#C41E3A] text-white text-xs">' + savedCount + "</span>" : "") +
          "</button>" +
        "</div>"
      : "";

    return (
      '<div class="max-w-7xl mx-auto px-4">' +
        '<div class="text-center mb-8">' +
          '<h3 class="font-display text-4xl md:text-5xl text-[#1B2A4A] mb-2">AVAILABLE HOMES IN OKC &amp; SURROUNDING AREAS</h3>' +
          '<div id="hrh-count-pills" class="flex items-center justify-center gap-2 flex-wrap my-4"></div>' +
          '<p class="text-gray-600 max-w-2xl mx-auto">Browse our current inventory of owner-financed and rent-to-own homes. ' +
            "No bank needed. No credit check. Save the ones you like and our team will follow up.</p>" +
        "</div>" +

        tabs +

        /* Filter bar — white card on the section's white bg, bordered like the listing cards */
        '<div class="bg-white border border-gray-200 rounded-xl shadow-sm p-4 mb-8">' +
          '<div class="relative mb-3">' +
            '<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">' + ICON_SEARCH + "</span>" +
            '<input id="hrh-f-search" type="search" placeholder="Search by address, city or ZIP" ' +
              'class="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm text-[#1B2A4A] ' +
              'focus:outline-none focus:border-[#1B2A4A] focus:ring-2 focus:ring-[#1B2A4A]/10" />' +
          "</div>" +
          '<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">' +
            selectHTML("hrh-f-city", "City", '<option value="">All Cities</option>') +
            selectHTML("hrh-f-price", "Price",
              '<option value="">Any Price</option>' +
              '<option value="0-100000">Under $100k</option>' +
              '<option value="100000-150000">$100k – $150k</option>' +
              '<option value="150000-200000">$150k – $200k</option>' +
              '<option value="200000-250000">$200k – $250k</option>' +
              '<option value="250000-350000">$250k – $350k</option>' +
              '<option value="350000-">$350k+</option>') +
            selectHTML("hrh-f-beds", "Beds",
              '<option value="">Any Beds</option><option value="1">1+</option><option value="2">2+</option>' +
              '<option value="3">3+</option><option value="4">4+</option><option value="5">5+</option>') +
            selectHTML("hrh-f-baths", "Baths",
              '<option value="">Any Baths</option><option value="1">1+</option><option value="1.5">1.5+</option>' +
              '<option value="2">2+</option><option value="3">3+</option>') +
            selectHTML("hrh-f-status", "Status",
              '<option value="">All Status</option><option value="AVAILABLE">Available</option>' +
              '<option value="PENDING">Pending</option><option value="SOLD">Sold</option>') +
            selectHTML("hrh-f-sort", "Sort By",
              '<option value="featured">Featured</option><option value="price-asc">Price: Low to High</option>' +
              '<option value="price-desc">Price: High to Low</option><option value="monthly-asc">Lowest Monthly</option>' +
              '<option value="down-asc">Lowest Down</option><option value="beds-desc">Most Bedrooms</option>') +
          "</div>" +
          '<div class="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">' +
            '<span id="hrh-result-count" class="text-sm text-gray-500 font-semibold"></span>' +
            '<button id="hrh-f-reset" class="text-sm font-bold text-gray-500 hover:text-[#C41E3A] transition-colors">Clear Filters</button>' +
          "</div>" +
        "</div>" +

        (state.user ? "" : signupNudgeHTML()) +

        '<div id="hrh-grid" class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"></div>' +
        '<div id="hrh-empty" class="hidden text-center py-16"></div>' +
      "</div>"
    );
  }

  function selectHTML(id, label, options) {
    return (
      '<div class="flex flex-col gap-1 min-w-0">' +
        '<label for="' + id + '" class="text-xs text-gray-500 uppercase tracking-wide font-bold">' + label + "</label>" +
        '<select id="' + id + '" class="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm text-[#1B2A4A] bg-white ' +
          'focus:outline-none focus:border-[#1B2A4A] focus:ring-2 focus:ring-[#1B2A4A]/10">' + options + "</select>" +
      "</div>"
    );
  }

  function signupNudgeHTML() {
    return (
      '<div id="hrh-nudge" class="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-8 flex items-center gap-4 flex-wrap justify-center text-center sm:text-left">' +
        '<p class="text-sm text-[#1B2A4A] font-semibold flex-1 min-w-[240px]">' +
          "Create a free account to save the homes you like and get notified when new ones hit the list." +
        "</p>" +
        '<a href="/signup?next=%2Fthank-you" class="px-5 py-2.5 rounded-lg font-bold text-white text-sm" style="background:' + RED + '">Sign Up Free</a>' +
        '<a href="/login?next=%2Fthank-you" class="px-5 py-2.5 rounded-lg font-bold text-sm border border-gray-300 text-[#1B2A4A] hover:bg-white transition-colors">Log In</a>' +
      "</div>"
    );
  }

  /* ── cards ───────────────────────────────────────────────── */

  function cardHTML(p) {
    var photos = Array.isArray(p.images) ? p.images : [];
    var hasPhoto = photos.length > 0;
    var isFav = state.favorites.indexOf(p.id) > -1;

    var media =
      '<div class="relative w-full h-52 md:h-56">' +
        (hasPhoto
          ? '<img alt="' + esc(addrText(p) + ", " + (p.cityCanonical || p.city || "")) + '" ' +
            'class="w-full h-full object-cover" loading="lazy" decoding="async" src="' + esc(photos[0]) + '" />'
          : '<div class="w-full h-full flex flex-col items-center justify-center gap-2 text-white" style="background:' + NAVY + '">' +
            ICON_HOME_BIG + '<span class="font-display text-lg tracking-wide">Photos Coming Soon</span></div>') +
        '<div class="absolute top-3 left-3 ' + statusBadgeClass(p) + ' text-white text-xs font-bold px-3 py-1.5 rounded-full z-10 shadow-md">' +
          statusText(p) + "</div>" +
        /* No price chip on the photo: the monthly payment already appears in the
           gray panel below, and on narrow cards a chip collides with the badge. */
        '<button type="button" data-hrh-fav="' + esc(p.id) + '" aria-pressed="' + (isFav ? "true" : "false") + '" ' +
          'aria-label="' + (isFav ? "Remove from saved homes" : "Save this home") + '" ' +
          'class="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/95 shadow-md z-10 grid place-items-center hover:scale-110 transition-transform">' +
          heartSVG(isFav) + "</button>" +
      "</div>";

    var specs = [];
    if (p.bedsNum > 0) {
      specs.push('<span class="inline-flex items-center gap-1">' + ICON_BED + p.bedsNum + " Bed</span>");
    }
    if (p.bathsNum > 0) {
      specs.push('<span class="inline-flex items-center gap-1">' + ICON_BATH + p.bathsNum + " Bath</span>");
    }
    var specRow = specs.length
      ? '<div class="flex items-center gap-3 text-[#1B2A4A] text-sm font-semibold mb-3 flex-wrap">' +
        specs.join('<span class="text-gray-300">|</span>') + "</div>"
      : '<div class="text-sm text-gray-400 italic mb-3">Call for details</div>';

    var links = [];
    if (p.zillowUrl) {
      links.push('<a href="' + esc(p.zillowUrl) + '" target="_blank" rel="noopener noreferrer" ' +
        'class="inline-flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-[#1B2A4A] transition-colors">Zillow' + ICON_EXT + "</a>");
    }
    if (p.tourUrl) {
      links.push('<a href="' + esc(p.tourUrl) + '" target="_blank" rel="noopener noreferrer" ' +
        'class="inline-flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-[#1B2A4A] transition-colors">Photos &amp; Tour' + ICON_EXT + "</a>");
    }

    return (
      '<div id="hrh-card-' + esc(p.id) + '" class="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300">' +
        media +
        '<div class="p-4">' +
          '<h4 class="font-bold text-[#1B2A4A] text-base mb-1 leading-tight">' + esc(addrText(p)) + "</h4>" +
          '<div class="flex items-center gap-1 text-gray-500 text-sm mb-3">' + ICON_PIN +
            "<span>" + esc(cityText(p)) + (p.zip ? " " + esc(p.zip) : "") + "</span></div>" +
          specRow +
          '<div class="bg-gray-50 rounded-lg p-3 mb-3">' +
            '<div class="flex items-center justify-between">' +
              "<div><span class=\"text-xs text-gray-500 uppercase tracking-wide\">Monthly</span>" +
                '<p class="text-[#C41E3A] font-bold text-lg leading-tight">' + esc(monthlyText(p)) + "</p></div>" +
              '<div class="text-right"><span class="text-xs text-gray-500 uppercase tracking-wide">Down</span>' +
                '<p class="text-[#1B2A4A] font-bold text-lg leading-tight">' + esc(downText(p)) + "</p></div>" +
            "</div>" +
            (p.priceNum > 0
              ? '<div class="mt-2 pt-2 border-t border-gray-200"><span class="text-xs text-gray-500 uppercase tracking-wide">Purchase Price</span>' +
                '<p class="text-[#1B2A4A] font-bold text-base leading-tight">' + esc(p.purchasePrice) + "</p></div>"
              : "") +
          "</div>" +
          '<div class="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">' +
            '<span class="text-[#C41E3A] text-xs font-semibold">Owner Financing</span>' +
            (links.length ? '<span class="flex items-center gap-3">' + links.join("") + "</span>" : "") +
          "</div>" +
          '<a href="' + CTA_HREF + '" class="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-lg font-bold text-white text-sm transition-all duration-150 active:scale-[0.97]" ' +
            'style="background:' + RED + '">See This Home</a>' +
        "</div>" +
      "</div>"
    );
  }

  /* ── filtering ───────────────────────────────────────────── */

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }

  function pool() {
    if (state.tab === "saved") {
      return state.properties.filter(function (p) { return state.favorites.indexOf(p.id) > -1; });
    }
    return state.properties;
  }

  function filtered() {
    var q = val("hrh-f-search").trim().toLowerCase();
    var city = val("hrh-f-city");
    var price = val("hrh-f-price");
    var beds = val("hrh-f-beds");
    var baths = val("hrh-f-baths");
    var status = val("hrh-f-status");
    var sort = val("hrh-f-sort") || "featured";

    var out = pool().filter(function (p) {
      if (q) {
        var hay = (addrText(p) + " " + (p.city || "") + " " + (p.cityCanonical || "") + " " +
          (p.zip || "") + " " + p.id).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (city && (p.cityCanonical || p.city) !== city) return false;
      if (status && statusText(p) !== status) return false;
      if (beds && !(p.bedsNum >= Number(beds))) return false;
      if (baths && !(p.bathsNum >= Number(baths))) return false;
      if (price) {
        var parts = price.split("-");
        var lo = Number(parts[0]) || 0;
        var hi = parts[1] ? Number(parts[1]) : Infinity;
        if (!(p.priceNum >= lo && p.priceNum <= hi)) return false;
      }
      return true;
    });

    var by = {
      "price-asc": function (a, b) { return (a.priceNum || Infinity) - (b.priceNum || Infinity); },
      "price-desc": function (a, b) { return (b.priceNum || 0) - (a.priceNum || 0); },
      "monthly-asc": function (a, b) { return (a.monthlyNum || Infinity) - (b.monthlyNum || Infinity); },
      "down-asc": function (a, b) { return (a.downNum || Infinity) - (b.downNum || Infinity); },
      "beds-desc": function (a, b) { return (b.bedsNum || 0) - (a.bedsNum || 0); },
    };
    if (by[sort]) out = out.slice().sort(by[sort]);
    else {
      // Featured: available homes with photos first, then by price desc.
      out = out.slice().sort(function (a, b) {
        var av = statusText(a) === "AVAILABLE" ? 0 : 1;
        var bv = statusText(b) === "AVAILABLE" ? 0 : 1;
        if (av !== bv) return av - bv;
        var ap = (a.images || []).length ? 0 : 1;
        var bp = (b.images || []).length ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (b.priceNum || 0) - (a.priceNum || 0);
      });
    }
    return out;
  }

  function render() {
    var grid = document.getElementById("hrh-grid");
    var empty = document.getElementById("hrh-empty");
    if (!grid || !empty) return;

    var rows = filtered();
    var countEl = document.getElementById("hrh-result-count");
    if (countEl) {
      countEl.textContent = rows.length + (rows.length === 1 ? " home" : " homes");
    }

    if (!rows.length) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      empty.innerHTML = state.tab === "saved"
        ? '<div class="text-[#1B2A4A]">' + ICON_HOME_BIG.replace("opacity-60", "opacity-40 mx-auto") +
          '<h4 class="font-display text-2xl mt-3 mb-2">No Saved Homes Yet</h4>' +
          '<p class="text-gray-500 max-w-md mx-auto mb-5">Tap the heart on any home to save it here so you can compare your favorites side by side.</p>' +
          '<button id="hrh-goto-browse" class="px-5 py-2.5 rounded-lg font-bold text-white text-sm" style="background:' + NAVY + '">Browse All Homes</button></div>'
        : '<div class="text-[#1B2A4A]">' + ICON_HOME_BIG.replace("opacity-60", "opacity-40 mx-auto") +
          '<h4 class="font-display text-2xl mt-3 mb-2">No Homes Match</h4>' +
          '<p class="text-gray-500 max-w-md mx-auto mb-5">Try widening your price range or clearing a filter — new homes come in every week.</p>' +
          '<button id="hrh-clear-2" class="px-5 py-2.5 rounded-lg font-bold text-white text-sm" style="background:' + NAVY + '">Clear All Filters</button>' +
          '<a href="' + PHONE_HREF + '" class="ml-2 px-5 py-2.5 rounded-lg font-bold text-sm border border-gray-300 text-[#1B2A4A] inline-block">Call (405) 761-8014</a></div>';
      return;
    }

    empty.classList.add("hidden");
    empty.innerHTML = "";
    grid.innerHTML = rows.map(cardHTML).join("");
  }

  function renderCountPills() {
    var el = document.getElementById("hrh-count-pills");
    if (!el) return;
    var avail = 0, coming = 0, pending = 0;
    state.properties.forEach(function (p) {
      var s = statusText(p);
      if (s === "AVAILABLE") avail++;
      else if (s === "COMING SOON") coming++;
      else if (s === "PENDING") pending++;
    });
    function pill(text, cls) {
      return '<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ' + cls + '">' + text + "</span>";
    }
    el.innerHTML =
      pill(avail + " Available Now", "bg-green-50 text-green-700") +
      (coming ? pill(coming + " Coming Soon", "bg-amber-50 text-amber-700") : "") +
      (pending ? pill(pending + " Pending", "bg-gray-100 text-gray-600") : "");
  }

  function buildCityOptions() {
    var sel = document.getElementById("hrh-f-city");
    if (!sel) return;
    var keep = sel.value;
    var counts = {};
    pool().forEach(function (p) {
      var c = p.cityCanonical || p.city;
      if (c) counts[c] = (counts[c] || 0) + 1;
    });
    var names = Object.keys(counts).sort();
    sel.innerHTML = '<option value="">All Cities</option>' +
      names.map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + " (" + counts[c] + ")</option>";
      }).join("");
    if (keep && names.indexOf(keep) > -1) sel.value = keep;
  }

  /* On the Saved tab, hide filter options that cannot match any saved home so
     the user never picks a dead end. */
  function pruneOptions() {
    var rows = pool();
    var tests = {
      "hrh-f-price": function (p, v) {
        var parts = v.split("-");
        var lo = Number(parts[0]) || 0;
        var hi = parts[1] ? Number(parts[1]) : Infinity;
        return p.priceNum >= lo && p.priceNum <= hi;
      },
      "hrh-f-beds": function (p, v) { return p.bedsNum >= Number(v); },
      "hrh-f-baths": function (p, v) { return p.bathsNum >= Number(v); },
      "hrh-f-status": function (p, v) { return statusText(p) === v; },
    };
    Object.keys(tests).forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      Array.prototype.slice.call(sel.options).forEach(function (opt) {
        if (!opt.value) return;
        var ok = state.tab !== "saved" || rows.some(function (p) { return tests[id](p, opt.value); });
        opt.hidden = !ok;
        opt.disabled = !ok;
      });
    });
  }

  function resetFilters() {
    ["hrh-f-search", "hrh-f-city", "hrh-f-price", "hrh-f-beds", "hrh-f-baths", "hrh-f-status"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    var s = document.getElementById("hrh-f-sort");
    if (s) s.value = "featured";
    render();
  }

  /* ── favorites ───────────────────────────────────────────── */

  function toast(msg) {
    var t = document.getElementById("hrh-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "hrh-toast";
      t.className = "fixed left-1/2 -translate-x-1/2 bottom-6 z-[9999] px-4 py-2.5 rounded-lg text-white text-sm font-bold shadow-lg transition-opacity duration-200";
      t.style.background = NAVY;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = "0"; }, 2600);
  }

  function paintHearts(id) {
    var isFav = state.favorites.indexOf(id) > -1;
    var btns = document.querySelectorAll('[data-hrh-fav="' + id + '"]');
    Array.prototype.forEach.call(btns, function (b) {
      b.innerHTML = heartSVG(isFav);
      b.setAttribute("aria-pressed", isFav ? "true" : "false");
      b.setAttribute("aria-label", isFav ? "Remove from saved homes" : "Save this home");
    });
  }

  function showSignupPrompt() {
    var ov = document.getElementById("hrh-signup-overlay");
    if (ov) { ov.classList.remove("hidden"); return; }
    ov = document.createElement("div");
    ov.id = "hrh-signup-overlay";
    ov.className = "fixed inset-0 z-[9998] bg-black/60 flex items-center justify-center p-4";
    ov.innerHTML =
      '<div class="bg-white rounded-xl max-w-md w-full p-6 text-center shadow-xl">' +
        '<div class="mx-auto mb-3">' + heartSVG(true) + "</div>" +
        '<h4 class="font-display text-3xl text-[#1B2A4A] mb-2">Save Your Favorite Homes</h4>' +
        '<p class="text-gray-600 text-sm mb-5">Create a free account to save every home you like, compare them side by side, ' +
          "and get a text when a new one hits the list.</p>" +
        '<a href="/signup?next=%2Fthank-you" class="block w-full py-3 rounded-lg font-bold text-white text-sm mb-2" style="background:' + RED + '">Sign Up Free</a>' +
        '<a href="/login?next=%2Fthank-you" class="block w-full py-3 rounded-lg font-bold text-sm border border-gray-300 text-[#1B2A4A]">I Already Have an Account</a>' +
        '<button id="hrh-signup-close" class="mt-4 text-xs text-gray-400 hover:text-gray-600">Maybe later</button>' +
      "</div>";
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) {
      if (e.target === ov || e.target.id === "hrh-signup-close") ov.classList.add("hidden");
    });
  }

  function toggleFavorite(id) {
    if (!state.user) { showSignupPrompt(); return; }

    var wasFav = state.favorites.indexOf(id) > -1;
    // Optimistic paint, reverted if the request fails.
    state.favorites = wasFav
      ? state.favorites.filter(function (x) { return x !== id; })
      : state.favorites.concat([id]);
    paintHearts(id);
    updateTabCount();

    getJSON("/api/favorites/" + (wasFav ? "remove" : "add"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: id }),
    }).then(function (res) {
      if (!res.ok) {
        state.favorites = wasFav ? state.favorites.concat([id]) : state.favorites.filter(function (x) { return x !== id; });
        paintHearts(id);
        updateTabCount();
        toast("Could not save right now. Please try again.");
        return;
      }
      state.favorites = (res.data && res.data.favorites) || state.favorites;
      paintHearts(id);
      updateTabCount();
      toast(wasFav ? "Removed from your saved homes" : "Saved! See it under Saved Homes.");
      if (state.tab === "saved") {
        buildCityOptions();
        pruneOptions();
        render();
      }
    });
  }

  function updateTabCount() {
    var btn = document.getElementById("hrh-tab-saved");
    if (!btn) return;
    var n = state.favorites.length;
    btn.innerHTML = "Saved Homes" + (n
      ? ' <span class="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#C41E3A] text-white text-xs">' + n + "</span>"
      : "");
  }

  function setTab(tab) {
    state.tab = tab;
    mount(true);
  }

  /* ── wiring ──────────────────────────────────────────────── */

  function wire() {
    var debounce;
    var search = document.getElementById("hrh-f-search");
    if (search) {
      search.addEventListener("input", function () {
        clearTimeout(debounce);
        debounce = setTimeout(render, 180);
      });
    }
    ["hrh-f-city", "hrh-f-price", "hrh-f-beds", "hrh-f-baths", "hrh-f-status", "hrh-f-sort"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", render);
    });
    var reset = document.getElementById("hrh-f-reset");
    if (reset) reset.addEventListener("click", resetFilters);

    var tb = document.getElementById("hrh-tab-browse");
    if (tb) tb.addEventListener("click", function () { setTab("browse"); });
    var ts = document.getElementById("hrh-tab-saved");
    if (ts) ts.addEventListener("click", function () { setTab("saved"); });
  }

  /* One delegated listener on the section handles hearts and empty-state
     buttons, so re-rendering the grid never loses handlers. */
  function wireDelegates(section) {
    if (section._hrhWired) return;
    section._hrhWired = true;
    section.addEventListener("click", function (e) {
      var fav = e.target.closest ? e.target.closest("[data-hrh-fav]") : null;
      if (fav) {
        e.preventDefault();
        toggleFavorite(fav.getAttribute("data-hrh-fav"));
        return;
      }
      if (e.target.closest && e.target.closest("#hrh-clear-2")) { resetFilters(); return; }
      if (e.target.closest && e.target.closest("#hrh-goto-browse")) { setTab("browse"); return; }
    });
  }

  function mount(force) {
    var section = findSection();
    if (!section) return false;
    if (section._hrhMounted && !force) return true;

    section.innerHTML = shellHTML();
    section._hrhMounted = true;
    wireDelegates(section);
    wire();
    buildCityOptions();
    pruneOptions();
    renderCountPills();
    render();
    return true;
  }

  /* ── boot ────────────────────────────────────────────────── */

  function boot() {
    if (!onListingsPage()) return;
    Promise.all([getJSON("/api/properties"), getJSON("/api/me")]).then(function (res) {
      state.properties = Array.isArray(res[0].data) ? res[0].data : [];
      state.user = res[1].data && res[1].data.loggedIn ? res[1].data.user : null;

      var after = function () {
        if (!state.properties.length) return; // nothing to show; leave the SPA section alone
        var tries = 0;
        var timer = setInterval(function () {
          tries++;
          if (mount() || tries > 60) {
            clearInterval(timer);
            watch();
          }
        }, 250);
      };

      if (state.user) {
        getJSON("/api/favorites").then(function (f) {
          state.favorites = (f.data && f.data.favorites) || [];
          after();
        });
      } else {
        after();
      }
    });
  }

  /* If React re-renders and blows away our markup, put it back. */
  function watch() {
    setInterval(function () {
      var section = findSection();
      if (section && !document.getElementById("hrh-grid")) {
        section._hrhMounted = false;
        mount(true);
      }
    }, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
