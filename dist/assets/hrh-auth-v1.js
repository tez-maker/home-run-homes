/**
 * HRH Auth Nav Injector (v1)
 * Adds "Log In" / "Sign Up" buttons to the site header without rebuilding the SPA.
 * - If a <header> navbar exists (inner pages), the buttons are placed inside it.
 * - If not (homepage SqueezePage has no navbar), a small fixed pill is shown top-right.
 * - When logged in, shows the user's first name + "Log Out" instead.
 * Bilingual: follows the hrh_lang localStorage key (defaults to English).
 */
(function () {
  var LANG = (function () {
    try { return localStorage.getItem("hrh_lang") === "es" ? "es" : "en"; } catch (e) { return "en"; }
  })();
  var T = {
    en: { login: "Log In", signup: "Sign Up", logout: "Log Out", hi: "Hi" },
    es: { login: "Iniciar Sesión", signup: "Registrarse", logout: "Cerrar Sesión", hi: "Hola" }
  }[LANG];

  var CSS =
    ".hrh-auth-wrap{display:flex;align-items:center;gap:8px;font-family:'Nunito Sans',sans-serif}" +
    ".hrh-auth-btn{display:inline-flex;align-items:center;justify-content:center;padding:7px 16px;border-radius:9999px;font-size:13px;font-weight:800;letter-spacing:.02em;text-decoration:none;cursor:pointer;border:none;white-space:nowrap;transition:opacity .15s}" +
    ".hrh-auth-btn:hover{opacity:.85}" +
    ".hrh-auth-login{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.45)}" +
    ".hrh-auth-signup{background:#C41E3A;color:#fff}" +
    ".hrh-auth-name{color:rgba(255,255,255,.85);font-size:13px;font-weight:700;white-space:nowrap}" +
    ".hrh-auth-fixed{position:fixed;top:14px;right:14px;z-index:9999;background:rgba(27,42,74,.92);backdrop-filter:blur(6px);padding:7px 10px;border-radius:9999px;box-shadow:0 4px 16px rgba(0,0,0,.3)}" +
    "@media(max-width:640px){.hrh-auth-btn{padding:6px 12px;font-size:12px}.hrh-auth-fixed{top:10px;right:10px}}";

  function el(tag, cls, text, href) {
    var e = document.createElement(href ? "a" : tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    if (href) e.href = href;
    return e;
  }

  function buildButtons(state) {
    var wrap = el("div", "hrh-auth-wrap");
    if (state && state.loggedIn) {
      var first = (state.user && state.user.name ? state.user.name : "").split(" ")[0];
      if (first) wrap.appendChild(el("span", "hrh-auth-name", T.hi + ", " + first));
      var out = el("a", "hrh-auth-btn hrh-auth-login", T.logout, "#");
      out.addEventListener("click", function (ev) {
        ev.preventDefault();
        fetch("/api/logout", { method: "POST", credentials: "same-origin" }).finally(function () {
          location.href = "/";
        });
      });
      wrap.appendChild(out);
    } else {
      wrap.appendChild(el("a", "hrh-auth-btn hrh-auth-login", T.login, "/login"));
      wrap.appendChild(el("a", "hrh-auth-btn hrh-auth-signup", T.signup, "/signup"));
    }
    return wrap;
  }

  function mount(state) {
    // Remove any previous mount (in case of SPA re-render)
    var old = document.getElementById("hrh-auth-mount");
    if (old) old.remove();

    var container = document.createElement("div");
    container.id = "hrh-auth-mount";

    // Try to place inside the sticky header (inner pages with NavBar)
    var header = document.querySelector("header.sticky, header[class*='sticky']");
    var target = null;
    if (header) {
      // Desktop nav lives in `nav.hidden.lg\\:flex`; place buttons after it
      var nav = header.querySelector("nav");
      target = nav ? nav.parentElement : header.firstElementChild || header;
    }

    var buttons = buildButtons(state);
    if (target) {
      container.appendChild(buttons);
      container.style.display = "flex";
      container.style.alignItems = "center";
      target.appendChild(container);
    } else {
      // Homepage / pages without navbar: fixed pill top-right
      container.className = "hrh-auth-fixed";
      container.appendChild(buttons);
      document.body.appendChild(container);
    }
  }

  function init() {
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    fetch("/api/me", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { loggedIn: false }; })
      .then(function (state) {
        // Wait for React to render, then mount; re-mount on SPA route changes
        var tries = 0;
        var timer = setInterval(function () {
          tries++;
          var rootReady = document.getElementById("root") && document.getElementById("root").children.length > 0;
          if (rootReady || tries > 40) {
            clearInterval(timer);
            mount(state);
            watchRouteChanges(state);
          }
        }, 250);
      });
  }

  function watchRouteChanges(state) {
    var lastPath = location.pathname;
    setInterval(function () {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        setTimeout(function () { mount(state); }, 400);
      } else if (!document.getElementById("hrh-auth-mount")) {
        // Re-mount if a re-render wiped it out
        mount(state);
      }
    }, 600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
