/* ===========================================================
   Home Run Homes — Listings platform logic
   Shared by /properties and /favorites. No framework, no build step.
   =========================================================== */
(function () {
  "use strict";

  /* ── State ────────────────────────────────────────────── */
  var state = {
    properties: [],
    favorites: [],      // array of property ids
    user: null,         // { id, name, email } or null
    filtered: [],
    gallery: { id: null, index: 0, images: [] },
    mode: document.body.dataset.page === "favorites" ? "favorites" : "browse",
  };

  var CONTACT_URL = "/path-home";
  var PHONE = "+14057618014";

  /* ── Tiny helpers ─────────────────────────────────────── */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(n) {
    if (!n) return "";
    return "$" + Number(n).toLocaleString("en-US");
  }

  /* The source sheet uses "$0" and "" interchangeably for "not published yet",
     so never print a zero dollar amount — it reads like a free house. */
  function priceLabel(p) {
    return p.priceNum > 0 ? p.purchasePrice : "Call for Price";
  }
  function monthlyLabel(p) {
    return p.monthlyNum > 0 ? p.monthlyPayment : "";
  }
  function downLabel(p) {
    return p.downNum > 0 ? p.downPayment : "";
  }
  /* A handful of rows have no street address yet. */
  function addrLabel(p) {
    var a = String(p.address || "").trim();
    return a || "Address Available on Request";
  }

  /** "3" -> "3 bd", "" -> null so we can show "Ask us" instead of "0" */
  function bedLabel(p) {
    return p.bedsNum > 0 ? p.bedsNum + " bd" : null;
  }
  function bathLabel(p) {
    if (!p.bathsNum) return null;
    // 1.75 baths is common in OKC stock — keep the decimal, trim trailing zeros
    var v = String(p.bathsNum).replace(/\.0+$/, "");
    return v + " ba";
  }

  function statusClass(s) {
    var v = String(s || "").toLowerCase();
    if (v.indexOf("sold") > -1) return "sold";
    if (v.indexOf("pend") > -1 || v.indexOf("contract") > -1) return "pending";
    return "";
  }

  var ICON_HEART =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  var ICON_HOME =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>';
  var ICON_CAMERA =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>';
  var ICON_EXT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M18 13v6H5V6h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>';
  var ICON_SEARCH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';

  /* ── Toast ────────────────────────────────────────────── */
  var toastTimer;
  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  /* ── Data loading ─────────────────────────────────────── */
  function fetchJSON(url, opts) {
    return fetch(url, Object.assign({ credentials: "same-origin" }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
      });
  }

  function loadAll() {
    return Promise.all([
      fetchJSON("/api/properties"),
      fetchJSON("/api/me"),
    ]).then(function (res) {
      state.properties = Array.isArray(res[0].data) ? res[0].data : [];
      state.user = res[1].data && res[1].data.loggedIn ? res[1].data.user : null;
      if (!state.user) return null;
      return fetchJSON("/api/favorites").then(function (f) {
        state.favorites = (f.data && f.data.favorites) || [];
      });
    });
  }

  /* ── Header / banner chrome ───────────────────────────── */
  function renderChrome() {
    var nav = $("#header-nav");
    if (nav) {
      var favBadge = state.favorites.length
        ? '<span class="fav-count">' + state.favorites.length + "</span>"
        : "";
      if (state.user) {
        nav.innerHTML =
          '<a href="/properties" class="nav-hide-xs' + (state.mode === "browse" ? " active" : "") + '">Browse Homes</a>' +
          '<a href="/favorites"' + (state.mode === "favorites" ? ' class="active"' : "") + ">Saved" + favBadge + "</a>" +
          '<a href="/api/logout" class="nav-hide-xs">Log Out</a>';
      } else {
        nav.innerHTML =
          '<a href="/login?next=' + encodeURIComponent(location.pathname) + '" class="nav-hide-xs">Log In</a>' +
          '<a href="/signup?next=' + encodeURIComponent(location.pathname) + '" class="nav-cta">Sign Up Free</a>';
      }
    }

    var banner = $("#signup-banner");
    if (banner) {
      var dismissed = false;
      try { dismissed = sessionStorage.getItem("hrh_banner_dismissed") === "1"; } catch (e) {}
      banner.hidden = !!state.user || dismissed;
    }
  }

  /* ── Card rendering ───────────────────────────────────── */
  function cardHTML(p) {
    var isFav = state.favorites.indexOf(p.id) > -1;
    var sc = statusClass(p.status);
    var photos = Array.isArray(p.images) ? p.images : [];
    var hasPhoto = photos.length > 0;

    var media =
      '<div class="card-media" data-detail="' + esc(p.id) + '" role="button" tabindex="0" aria-label="View details for ' + esc(addrLabel(p)) + '">' +
        (hasPhoto
          ? '<img src="' + esc(photos[0]) + '" alt="' + esc(addrLabel(p)) + '" loading="lazy" decoding="async" />'
          : '<div class="no-photo">' + ICON_HOME + "<span>Photos Coming Soon</span></div>") +
        '<span class="badge ' + sc + '">' + esc(statusLabel(p)) + "</span>" +
        (photos.length > 1
          ? '<span class="photo-count">' + ICON_CAMERA + photos.length + "</span>"
          : "") +
        '<button class="fav-btn' + (isFav ? " is-fav" : "") + '" data-fav="' + esc(p.id) + '" ' +
          'aria-label="' + (isFav ? "Remove from saved homes" : "Save this home") + '" ' +
          'aria-pressed="' + (isFav ? "true" : "false") + '">' + ICON_HEART + "</button>" +
      "</div>";

    var specParts = [];
    var bd = bedLabel(p), ba = bathLabel(p);
    if (bd) specParts.push("<span>" + bd + "</span>");
    if (ba) specParts.push("<span>" + ba + "</span>");
    var specs = specParts.length
      ? specParts.join('<span class="dot">&bull;</span>')
      : '<span class="spec-na">Call for details</span>';

    var actions = state.mode === "favorites"
      ? '<button class="btn-remove" data-remove="' + esc(p.id) + '">Remove from Saved</button>'
      : '<a class="btn-detail" data-detail="' + esc(p.id) + '" href="#' + esc(p.id) + '">View Details</a>' +
        (p.zillowUrl
          ? '<a class="btn-zillow" href="' + esc(p.zillowUrl) + '" target="_blank" rel="noopener noreferrer">Zillow' + ICON_EXT + "</a>"
          : "");

    return (
      '<article class="card" id="card-' + esc(p.id) + '">' +
        media +
        '<div class="card-body">' +
          '<div class="price-row">' +
            '<span class="price">' + esc(priceLabel(p)) + "</span>" +
            (monthlyLabel(p) ? '<span class="monthly">' + esc(monthlyLabel(p)) + "/mo</span>" : "") +
          "</div>" +
          (downLabel(p) ? '<div class="down-note">' + esc(downLabel(p)) + " down</div>" : "") +
          '<div class="specs">' + specs + "</div>" +
          '<div class="addr">' + esc(addrLabel(p)) + "</div>" +
          '<div class="city">' + esc(p.cityCanonical || p.city || "") + (p.zip ? " " + esc(p.zip) : "") + "</div>" +
          '<div class="card-actions">' + actions + "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function skeletonHTML() {
    var one =
      '<article class="card skeleton"><div class="card-media"></div>' +
      '<div class="card-body"><div class="sk-line lg"></div><div class="sk-line sm"></div>' +
      '<div class="sk-line"></div><div class="sk-line sm"></div></div></article>';
    return new Array(6).join("") + one + one + one + one + one + one;
  }

  /* ── Filtering ────────────────────────────────────────── */
  function readFilters() {
    return {
      q: (($("#f-search") || {}).value || "").trim().toLowerCase(),
      city: ($("#f-city") || {}).value || "",
      price: ($("#f-price") || {}).value || "",
      beds: ($("#f-beds") || {}).value || "",
      baths: ($("#f-baths") || {}).value || "",
      status: ($("#f-status") || {}).value || "",
      sort: ($("#f-sort") || {}).value || "featured",
    };
  }

  /* The set of homes the current page is allowed to show, before filters.
     On /favorites this is only the saved homes, so filter dropdowns must be
     built from this and not the whole catalog. */
  function currentPool() {
    return state.mode === "favorites"
      ? state.properties.filter(function (p) { return state.favorites.indexOf(p.id) > -1; })
      : state.properties;
  }

  function applyFilters() {
    var f = readFilters();
    var pool = currentPool();

    var out = pool.filter(function (p) {
      if (f.q) {
        var hay = (p.address + " " + (p.city || "") + " " + (p.cityCanonical || "") + " " + (p.zip || "") + " " + p.id).toLowerCase();
        if (hay.indexOf(f.q) === -1) return false;
      }
      if (f.city && (p.cityCanonical || p.city) !== f.city) return false;
      if (f.status && statusLabel(p) !== f.status) return false;
      if (f.beds && !(p.bedsNum >= Number(f.beds))) return false;
      if (f.baths && !(p.bathsNum >= Number(f.baths))) return false;
      if (f.price) {
        var parts = f.price.split("-");
        var lo = Number(parts[0]) || 0;
        var hi = parts[1] ? Number(parts[1]) : Infinity;
        if (!(p.priceNum >= lo && p.priceNum <= hi)) return false;
      }
      return true;
    });

    out.sort(function (a, b) {
      switch (f.sort) {
        case "price-asc": return (a.priceNum || 1e12) - (b.priceNum || 1e12);
        case "price-desc": return (b.priceNum || 0) - (a.priceNum || 0);
        case "monthly-asc": return (a.monthlyNum || 1e12) - (b.monthlyNum || 1e12);
        case "down-asc": return (a.downNum || 1e12) - (b.downNum || 1e12);
        case "beds-desc": return (b.bedsNum || 0) - (a.bedsNum || 0);
        default:
          // Featured: available homes with photos first, then available, then sold
          return score(b) - score(a);
      }
    });

    state.filtered = out;
    renderGrid();
  }

  function score(p) {
    var s = 0;
    if (statusLabel(p) === "Available") s += 100;
    if (p.images && p.images.length) s += 10;
    if (p.zillowUrl) s += 2;
    return s;
  }

  function statusLabel(p) {
    var c = statusClass(p.status);
    if (c === "sold") return "Sold";
    if (c === "pending") return "Pending";
    return "Available";
  }

  /* ── Grid + empty states ──────────────────────────────── */
  function renderGrid() {
    var grid = $("#grid");
    var count = $("#result-count");
    if (!grid) return;

    if (count) {
      var n = state.filtered.length;
      count.textContent = n + (n === 1 ? " home" : " homes");
    }

    if (!state.filtered.length) {
      grid.innerHTML = "";
      grid.style.display = "none";
      showEmpty(true);
      return;
    }
    grid.style.display = "";
    showEmpty(false);
    grid.innerHTML = state.filtered.map(cardHTML).join("");
  }

  function showEmpty(show) {
    var box = $("#empty-state");
    if (!box) return;
    box.hidden = !show;
    if (!show) return;

    if (state.mode === "favorites") {
      box.innerHTML =
        '<div class="state">' + ICON_HEART_OUTLINE() +
        "<h3>No Saved Homes Yet</h3>" +
        "<p>Tap the heart on any home to save it here. We will keep track so you can compare your favorites side by side.</p>" +
        '<a class="btn-primary" href="/properties">Browse Homes</a></div>';
    } else {
      var anyFilter = JSON.stringify(readFilters()) !== JSON.stringify({
        q: "", city: "", price: "", beds: "", baths: "", status: "", sort: readFilters().sort,
      });
      box.innerHTML =
        '<div class="state">' + ICON_HOME +
        "<h3>No Homes Match</h3>" +
        "<p>" + (anyFilter
          ? "Try widening your price range or clearing a filter — new homes come in every week."
          : "No listings are loaded right now. Please check back shortly.") + "</p>" +
        (anyFilter ? '<button class="btn-primary" id="clear-from-empty">Clear All Filters</button>' : "") +
        "</div>";
      var btn = $("#clear-from-empty");
      if (btn) btn.addEventListener("click", resetFilters);
    }
  }

  function ICON_HEART_OUTLINE() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  }

  /* ── Filter controls ──────────────────────────────────── */
  function buildCityOptions() {
    var sel = $("#f-city");
    if (!sel) return;
    var keep = sel.value;
    var cities = {};
    currentPool().forEach(function (p) {
      var c = p.cityCanonical || p.city;
      if (c) cities[c] = (cities[c] || 0) + 1;
    });
    var names = Object.keys(cities).sort();
    sel.innerHTML =
      '<option value="">All Cities</option>' +
      names.map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + " (" + cities[c] + ")</option>";
      }).join("");
    // Preserve the active choice if it still exists in the rebuilt list
    if (keep && names.indexOf(keep) > -1) sel.value = keep;
  }

  /* Hide price/bed/bath/status options that cannot match anything in the
     current pool, so /favorites never offers a dead-end filter. */
  function pruneFilterOptions() {
    var pool = currentPool();
    if (state.mode !== "favorites") return;

    function prune(id, test) {
      var sel = document.getElementById(id);
      if (!sel) return;
      Array.prototype.slice.call(sel.options).forEach(function (opt) {
        if (!opt.value) return;
        var ok = pool.some(function (p) { return test(p, opt.value); });
        opt.hidden = !ok;
        opt.disabled = !ok;
      });
    }

    prune("f-price", function (p, v) {
      var parts = v.split("-");
      var lo = Number(parts[0]) || 0;
      var hi = parts[1] ? Number(parts[1]) : Infinity;
      return p.priceNum >= lo && p.priceNum <= hi;
    });
    prune("f-beds", function (p, v) { return p.bedsNum >= Number(v); });
    prune("f-baths", function (p, v) { return p.bathsNum >= Number(v); });
    prune("f-status", function (p, v) { return statusLabel(p) === v; });
  }

  function resetFilters() {
    ["f-search", "f-city", "f-price", "f-beds", "f-baths", "f-status"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    var sort = $("#f-sort");
    if (sort) sort.value = "featured";
    applyFilters();
  }

  function wireFilters() {
    var debounce;
    var search = $("#f-search");
    if (search) {
      search.addEventListener("input", function () {
        clearTimeout(debounce);
        debounce = setTimeout(applyFilters, 180);
      });
    }
    ["f-city", "f-price", "f-beds", "f-baths", "f-status", "f-sort"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", applyFilters);
    });
    var reset = $("#f-reset");
    if (reset) reset.addEventListener("click", resetFilters);

    var toggle = $("#filter-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var g = $("#filter-grid");
        var open = g.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
  }

  /* ── Favorites ────────────────────────────────────────── */
  function openSignupPrompt() {
    var ov = $("#prompt-overlay");
    if (ov) ov.classList.add("open");
  }

  function toggleFavorite(id, btn) {
    if (!state.user) {
      openSignupPrompt();
      return;
    }
    var isFav = state.favorites.indexOf(id) > -1;
    var url = isFav ? "/api/favorites/remove" : "/api/favorites/add";

    // Optimistic UI — revert if the server disagrees.
    if (isFav) {
      state.favorites = state.favorites.filter(function (x) { return x !== id; });
    } else {
      state.favorites = state.favorites.concat([id]);
    }
    paintFavState(id);
    if (btn) {
      btn.classList.add("pop");
      setTimeout(function () { btn.classList.remove("pop"); }, 360);
    }

    fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: id }),
    }).then(function (res) {
      if (res.status === 401) {
        state.user = null;
        openSignupPrompt();
        state.favorites = state.favorites.filter(function (x) { return x !== id; });
        paintFavState(id);
        renderChrome();
        return;
      }
      if (!res.ok) {
        // Revert
        state.favorites = isFav ? state.favorites.concat([id])
          : state.favorites.filter(function (x) { return x !== id; });
        paintFavState(id);
        toast("Could not save right now. Please try again.");
        return;
      }
      state.favorites = (res.data && res.data.favorites) || state.favorites;
      renderChrome();
      paintFavState(id);
      toast(isFav ? "Removed from your saved homes" : "Saved! View it under Saved.");
      if (state.mode === "favorites") {
        // The pool just changed, so the dropdowns must be rebuilt to match
        buildCityOptions();
        pruneFilterOptions();
        if (isFav) applyFilters();
      }
    });
  }

  function removeFavorite(id) {
    if (!state.user) return;
    state.favorites = state.favorites.filter(function (x) { return x !== id; });
    var card = document.getElementById("card-" + id);
    if (card) {
      card.style.transition = "opacity .2s, transform .2s";
      card.style.opacity = "0";
      card.style.transform = "scale(.96)";
    }
    fetchJSON("/api/favorites/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: id }),
    }).then(function (res) {
      state.favorites = (res.data && res.data.favorites) || state.favorites;
      renderChrome();
      buildCityOptions();
      pruneFilterOptions();
      applyFilters();
      toast("Removed from your saved homes");
    });
  }

  /** Repaint every heart + detail-modal save button for one property. */
  function paintFavState(id) {
    var isFav = state.favorites.indexOf(id) > -1;
    $$('[data-fav="' + id + '"]').forEach(function (b) {
      b.classList.toggle("is-fav", isFav);
      b.setAttribute("aria-pressed", isFav ? "true" : "false");
      b.setAttribute("aria-label", isFav ? "Remove from saved homes" : "Save this home");
    });
    var ds = $("#detail-save");
    if (ds && ds.dataset.fav === id) {
      ds.classList.toggle("is-fav", isFav);
      var label = $("#detail-save-label");
      if (label) label.textContent = isFav ? "Saved" : "Save This Home";
    }
  }

  /* ── Detail modal ─────────────────────────────────────── */
  function openDetail(id) {
    var p = state.properties.filter(function (x) { return x.id === id; })[0];
    if (!p) return;

    state.gallery = { id: id, index: 0, images: (p.images || []).slice() };

    var isFav = state.favorites.indexOf(id) > -1;
    var bd = bedLabel(p), ba = bathLabel(p);

    var specs = [
      { k: "Price", v: p.priceNum > 0 ? p.purchasePrice : "Ask", small: false },
      { k: "Monthly", v: p.monthlyNum > 0 ? p.monthlyPayment : "Ask", small: false },
      { k: "Down", v: p.downNum > 0 ? p.downPayment : "Ask", small: false },
      { k: "Beds", v: bd ? bd.replace(" bd", "") : "Ask", small: false },
      { k: "Baths", v: ba ? ba.replace(" ba", "") : "Ask", small: false },
      { k: "Status", v: statusLabel(p), small: true },
    ];

    $("#detail-content").innerHTML =
      '<div class="detail-gallery" id="detail-gallery">' + galleryInnerHTML(p) + "</div>" +
      '<div class="detail-body">' +
        '<div class="detail-head"><div>' +
          '<span class="price">' + esc(priceLabel(p)) + "</span>" +
          '<div class="detail-addr">' + esc(addrLabel(p)) + "</div>" +
          '<div class="detail-city">' + esc(p.cityCanonical || p.city || "") +
            (p.zip ? " " + esc(p.zip) : "") + ", OK</div>" +
        "</div>" +
        (monthlyLabel(p) ? '<span class="monthly">' + esc(monthlyLabel(p)) + "/mo</span>" : "") +
        "</div>" +

        '<div class="spec-grid">' +
          specs.map(function (s) {
            return '<div class="spec-item"><div class="k">' + esc(s.k) + "</div>" +
              '<div class="v' + (s.small ? " small" : "") + '">' + esc(s.v) + "</div></div>";
          }).join("") +
        "</div>" +

        (p.notes
          ? '<div class="detail-section"><h4>About This Home</h4><p>' + esc(p.notes) + "</p></div>"
          : '<div class="detail-section"><h4>About This Home</h4><p>Full details on this property are available by request — reach out and we will walk you through the numbers, the condition, and the terms.</p></div>') +

        '<div class="detail-actions">' +
          '<a class="contact" href="' + CONTACT_URL + '">Contact Us About This Home</a>' +
          '<button class="save' + (isFav ? " is-fav" : "") + '" id="detail-save" data-fav="' + esc(id) + '">' +
            ICON_HEART + '<span id="detail-save-label">' + (isFav ? "Saved" : "Save This Home") + "</span></button>" +
          (p.zillowUrl
            ? '<a class="zillow" href="' + esc(p.zillowUrl) + '" target="_blank" rel="noopener noreferrer">View on Zillow' + ICON_EXT + "</a>"
            : "") +
          (p.tourUrl
            ? '<a class="zillow" href="' + esc(p.tourUrl) + '" target="_blank" rel="noopener noreferrer">Photos &amp; Tour' + ICON_EXT + "</a>"
            : "") +
        "</div>" +
      "</div>";

    $("#detail-overlay").classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function galleryInnerHTML(p) {
    var imgs = state.gallery.images;
    if (!imgs.length) {
      return '<div class="no-photo">' + ICON_HOME +
        "<span>Photos Coming Soon</span></div>" +
        '<span class="badge ' + statusClass(p.status) + '">' + esc(statusLabel(p)) + "</span>";
    }
    var i = state.gallery.index;
    return '<img src="' + esc(imgs[i]) + '" alt="' + esc(addrLabel(p)) + '" />' +
      '<span class="badge ' + statusClass(p.status) + '">' + esc(statusLabel(p)) + "</span>" +
      (imgs.length > 1
        ? '<button class="gallery-nav prev" data-gal="-1" aria-label="Previous photo">&#8249;</button>' +
          '<button class="gallery-nav next" data-gal="1" aria-label="Next photo">&#8250;</button>' +
          '<div class="gallery-dots">' + imgs.map(function (_, n) {
            return "<i" + (n === i ? ' class="on"' : "") + "></i>";
          }).join("") + "</div>"
        : "");
  }

  function stepGallery(delta) {
    var imgs = state.gallery.images;
    if (imgs.length < 2) return;
    state.gallery.index = (state.gallery.index + delta + imgs.length) % imgs.length;
    var p = state.properties.filter(function (x) { return x.id === state.gallery.id; })[0];
    var g = $("#detail-gallery");
    if (g && p) g.innerHTML = galleryInnerHTML(p);
  }

  function closeModals() {
    $$(".overlay").forEach(function (o) { o.classList.remove("open"); });
    document.body.style.overflow = "";
    if (location.hash) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
  }

  /* ── Global event wiring (delegation) ─────────────────── */
  function wireGlobal() {
    document.addEventListener("click", function (e) {
      var favBtn = e.target.closest("[data-fav]");
      if (favBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(favBtn.dataset.fav, favBtn);
        return;
      }

      var rm = e.target.closest("[data-remove]");
      if (rm) {
        e.preventDefault();
        removeFavorite(rm.dataset.remove);
        return;
      }

      var gal = e.target.closest("[data-gal]");
      if (gal) {
        e.preventDefault();
        stepGallery(Number(gal.dataset.gal));
        return;
      }

      var det = e.target.closest("[data-detail]");
      if (det) {
        e.preventDefault();
        openDetail(det.dataset.detail);
        return;
      }

      if (e.target.closest("[data-close]")) {
        e.preventDefault();
        closeModals();
        return;
      }
      // Click on the dimmed backdrop closes
      if (e.target.classList && e.target.classList.contains("overlay")) {
        closeModals();
      }
    });

    // Keyboard: Enter/Space on card media, Esc to close, arrows for gallery
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeModals(); return; }
      if ($("#detail-overlay") && $("#detail-overlay").classList.contains("open")) {
        if (e.key === "ArrowLeft") stepGallery(-1);
        if (e.key === "ArrowRight") stepGallery(1);
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && e.target.dataset && e.target.dataset.detail) {
        e.preventDefault();
        openDetail(e.target.dataset.detail);
      }
    });

    var close = $("#banner-close");
    if (close) {
      close.addEventListener("click", function () {
        var b = $("#signup-banner");
        if (b) b.hidden = true;
        try { sessionStorage.setItem("hrh_banner_dismissed", "1"); } catch (e) {}
      });
    }
  }

  /* ── Boot ─────────────────────────────────────────────── */
  function init() {
    var sw = $("#search-icon-slot");
    if (sw) sw.innerHTML = ICON_SEARCH;

    var grid = $("#grid");
    if (grid) grid.innerHTML = skeletonHTML();

    wireGlobal();
    wireFilters();

    loadAll().then(function () {
      renderChrome();
      buildCityOptions();
      pruneFilterOptions();

      // Deep link: /properties#HRH-041 opens that home
      var hash = (location.hash || "").replace("#", "");
      applyFilters();
      if (hash && state.properties.some(function (p) { return p.id === hash; })) {
        openDetail(hash);
      }
    }).catch(function (err) {
      console.error("Listings failed to load", err);
      var g = $("#grid");
      if (g) g.innerHTML = "";
      var box = $("#empty-state");
      if (box) {
        box.hidden = false;
        box.innerHTML =
          '<div class="state">' + ICON_HOME + "<h3>Could Not Load Homes</h3>" +
          "<p>Something went wrong on our end. Please refresh the page or call us and we will send the list over.</p>" +
          '<a class="btn-primary" href="tel:' + PHONE + '">Call (405) 761-8014</a></div>';
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
