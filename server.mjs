/**
 * Production server for Railway deployment.
 * Serves the Vite-built static files with SPA fallback (all routes → index.html).
 * Includes user auth (signup/login) backed by JSON file storage + express-session,
 * and gates /thank-you (all listings) behind login.
 */
import express from "express";
import session from "express-session";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, "dist");

/* ────────────────────────────────────────────────
 * JSON-based user storage (no native deps needed)
 * ──────────────────────────────────────────────── */
const DATA_DIR = process.env.DATA_DIR || __dirname;
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");

function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (err) {
    console.warn(`Failed to load ${filePath}:`, err.message);
  }
  return fallback;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`Failed to save ${filePath}:`, err.message);
  }
}

// In-memory user store backed by JSON file
let users = loadJSON(USERS_FILE, []);
let nextUserId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;

function saveUsers() {
  saveJSON(USERS_FILE, users);
}

function findUserByEmail(email) {
  return users.find(u => u.email === email);
}

function createUser({ fullName, email, phone, passwordHash }) {
  const user = {
    id: nextUserId++,
    full_name: fullName,
    email,
    phone,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
  };
  users.push(user);
  saveUsers();
  return user;
}

/* Password hashing with Node's built-in scrypt (no native bcrypt needed) */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(candidate, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ────────────────────────────────────────────────
 * JSON-backed session store (persists across restarts)
 * ──────────────────────────────────────────────── */
let sessionData = loadJSON(SESSIONS_FILE, {});

function saveSessions() {
  saveJSON(SESSIONS_FILE, sessionData);
}

class JsonStore extends session.Store {
  get(sid, cb) {
    try {
      const entry = sessionData[sid];
      if (!entry) return cb(null, null);
      if (entry.expire < Date.now()) {
        delete sessionData[sid];
        saveSessions();
        return cb(null, null);
      }
      cb(null, entry.sess);
    } catch (err) {
      cb(err);
    }
  }
  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie?.maxAge ?? 30 * 24 * 60 * 60 * 1000;
      const expire = Date.now() + maxAge;
      sessionData[sid] = { sess, expire };
      saveSessions();
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
  destroy(sid, cb) {
    try {
      delete sessionData[sid];
      saveSessions();
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

/* Periodically clean expired sessions */
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const sid of Object.keys(sessionData)) {
    if (sessionData[sid].expire < now) {
      delete sessionData[sid];
      changed = true;
    }
  }
  if (changed) saveSessions();
}, 6 * 60 * 60 * 1000).unref();

/* ────────────────────────────────────────────────
 * Middleware
 * ──────────────────────────────────────────────── */
app.set("trust proxy", 1); // Railway sits behind a proxy (needed for secure cookies)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: new JsonStore(),
    name: "hrh.sid",
    secret: process.env.SESSION_SECRET || "hrh-okc-owner-financed-2026-keep-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days — stays logged in across browser restarts
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT,
    },
  })
);

/* ────────────────────────────────────────────────
 * GHL lead submission (optional — only if API key is configured)
 * ──────────────────────────────────────────────── */
const GHL_LOCATION_ID = "f2xAqrDFG9b2eDS53k6S";
async function submitLeadToGHL({ fullName, email, phone }) {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) return; // no key configured — lead capture still happens via GHL form on thank-you page
  try {
    const [firstName, ...rest] = fullName.trim().split(/\s+/);
    const res = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName: firstName || fullName,
        lastName: rest.join(" ") || "",
        name: fullName,
        email,
        phone,
        source: "Website Signup (homerunhomes.casa)",
        tags: ["website-signup", "buyer-account"],
      }),
    });
    if (!res.ok) {
      console.warn("GHL contact upsert failed:", res.status, await res.text());
    }
  } catch (err) {
    console.warn("GHL contact upsert error:", err.message);
  }
}

/* ────────────────────────────────────────────────
 * Auth API routes
 * ──────────────────────────────────────────────── */
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/api/signup", async (req, res) => {
  const { fullName, email, phone, password } = req.body || {};
  if (!fullName || !String(fullName).trim()) {
    return res.status(400).json({ error: "name_required" });
  }
  if (!email || !emailRe.test(String(email).trim())) {
    return res.status(400).json({ error: "invalid_email" });
  }
  if (!phone || String(phone).replace(/\D/g, "").length < 10) {
    return res.status(400).json({ error: "invalid_phone" });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: "weak_password" });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(fullName).trim();
  const cleanPhone = String(phone).trim();

  // Check if email already exists
  if (findUserByEmail(cleanEmail)) {
    return res.status(409).json({ error: "email_exists" });
  }

  try {
    const user = createUser({
      fullName: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      passwordHash: hashPassword(String(password)),
    });
    req.session.user = { id: user.id, name: cleanName, email: cleanEmail };
    // Fire-and-forget lead submission to GHL (does not block signup)
    submitLeadToGHL({ fullName: cleanName, email: cleanEmail, phone: cleanPhone });
    return res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "missing_fields" });
  }
  const row = findUserByEmail(String(email).trim().toLowerCase());
  if (!row || !verifyPassword(String(password), row.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  req.session.user = { id: row.id, name: row.full_name, email: row.email };
  return res.json({ ok: true, user: req.session.user });
});

app.get("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("hrh.sid");
    // If called from a link, send them home; if called via fetch, JSON is fine too
    if (req.headers.accept && req.headers.accept.includes("text/html")) {
      return res.redirect("/");
    }
    res.json({ ok: true });
  });
});
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("hrh.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  if (req.session.user) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
  res.json({ loggedIn: false });
});

/* ────────────────────────────────────────────────
 * Auth middleware — gate /thank-you (all listings) behind login
 * ──────────────────────────────────────────────── */
function requireLogin(req, res, next) {
  if (req.session.user) return next();
  const next_ = encodeURIComponent(req.originalUrl || "/properties");
  return res.redirect(`/login?next=${next_}`);
}

/* Legacy gated route. The old SPA thank-you page has been replaced by the
 * dedicated listings platform, so send logged-in visitors (and anyone with an
 * old bookmark or emailed link) straight to /properties. */
app.get("/thank-you", requireLogin, (req, res) => {
  res.redirect(301, "/properties");
});

/* ────────────────────────────────────────────────
 * Standalone auth pages (before static, so /login isn't shadowed)
 * ──────────────────────────────────────────────── */
app.get(["/login", "/signup"], (req, res) => {
  if (req.session.user) {
    return res.redirect("/properties");
  }
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(DIST, "login.html"));
});

/* ────────────────────────────────────────────────
 * Static files — index.html served with no-cache so script
 * injections take effect immediately (assets keep 1d cache)
 * ──────────────────────────────────────────────── */
app.use(
  express.static(DIST, {
    maxAge: "1d",
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

// Standalone pages (not part of the SPA bundle)
app.get("/ebook-call", (req, res) => {
  res.sendFile(path.join(DIST, "ebook-call.html"));
});

app.get("/events", (req, res) => {
  res.sendFile(path.join(DIST, "events.html"));
});

app.get("/events-confirmation", (req, res) => {
  res.sendFile(path.join(DIST, "events-confirmation.html"));
});

app.get("/rent-to-own-guide", (req, res) => {
  res.sendFile(path.join(DIST, "rent-to-own-guide.html"));
});

app.get("/rent-to-own-guide-thank-you", (req, res) => {
  res.sendFile(path.join(DIST, "rent-to-own-guide-thank-you.html"));
});

app.get("/training", (req, res) => {
  res.sendFile(path.join(DIST, "training.html"));
});

app.get("/training-watch", (req, res) => {
  res.sendFile(path.join(DIST, "training-watch.html"));
});

app.get("/path-home", (req, res) => {
  res.sendFile(path.join(DIST, "path-home.html"));
});

app.get("/training-thankyou", (req, res) => {
  res.sendFile(path.join(DIST, "training-thankyou.html"));
});

/* ────────────────────────────────────────────────
 * Training funnel qualification form (backup capture)
 * Stores every submission locally so no lead is lost even
 * if the GHL webhook is missing or fails.
 * ──────────────────────────────────────────────── */
const QUALIFY_FILE = path.join(DATA_DIR, "qualify-leads.json");

app.post("/api/qualify", (req, res) => {
  const body = req.body || {};
  const entry = {
    received_at: new Date().toISOString(),
    first_name: body.first_name || body.firstName || "",
    phone: body.phone || "",
    email: body.email || "",
    age: body.age || "",
    move_timeline: body.move_timeline || "",
    down_payment: body.down_payment || "",
    monthly_budget: body.monthly_budget || "",
    evictions: body.evictions || "",
    summary: body.message || body.notes || "",
    page_url: body.page_url || "",
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
  };

  const leads = loadJSON(QUALIFY_FILE, []);
  leads.push(entry);
  saveJSON(QUALIFY_FILE, leads);
  console.log("📋 Qualification form submission:", entry.first_name, entry.phone, entry.email);

  // Optional: forward to GHL contacts API if a key is configured
  if (process.env.GHL_API_KEY) {
    submitLeadToGHL({
      fullName: entry.first_name || "Website Lead",
      email: entry.email,
      phone: entry.phone,
    });
  }

  res.json({ ok: true });
});

app.get("/api/qualify-leads", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "unauthorized" });
  res.json(loadJSON(QUALIFY_FILE, []));
});

/* ────────────────────────────────────────────────
 * Property listings API endpoint
 * ──────────────────────────────────────────────── */
const PROPERTIES_FILE = path.join(DATA_DIR, "properties.json");

app.get("/api/properties", (req, res) => {
  const properties = loadJSON(PROPERTIES_FILE, []);
  res.json(properties);
});

/* ────────────────────────────────────────────────
 * Favorites — saved homes per user
 * Stored as { "<userId>": ["HRH-006", "HRH-041"] }
 * ──────────────────────────────────────────────── */
let favorites = loadJSON(FAVORITES_FILE, {});

function saveFavorites() {
  saveJSON(FAVORITES_FILE, favorites);
}

function getUserFavorites(userId) {
  const list = favorites[String(userId)];
  return Array.isArray(list) ? list : [];
}

function requireAuthJSON(req, res, next) {
  if (req.session.user) return next();
  return res.status(401).json({ error: "login_required" });
}

/** Validates a property id against properties.json so we never store junk. */
function validPropertyId(id) {
  if (typeof id !== "string" || !id.trim()) return false;
  const properties = loadJSON(PROPERTIES_FILE, []);
  return properties.some((p) => p.id === id);
}

app.get("/api/favorites", requireAuthJSON, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, favorites: getUserFavorites(req.session.user.id) });
});

app.post("/api/favorites/add", requireAuthJSON, (req, res) => {
  const { propertyId } = req.body || {};
  if (!validPropertyId(propertyId)) {
    return res.status(400).json({ error: "invalid_property" });
  }
  const key = String(req.session.user.id);
  const list = getUserFavorites(key);
  if (!list.includes(propertyId)) {
    list.push(propertyId);
    favorites[key] = list;
    saveFavorites();
    console.log(`❤️  ${req.session.user.email} saved ${propertyId}`);
  }
  res.json({ ok: true, favorites: list });
});

app.post("/api/favorites/remove", requireAuthJSON, (req, res) => {
  const { propertyId } = req.body || {};
  if (typeof propertyId !== "string" || !propertyId.trim()) {
    return res.status(400).json({ error: "invalid_property" });
  }
  const key = String(req.session.user.id);
  const list = getUserFavorites(key).filter((id) => id !== propertyId);
  favorites[key] = list;
  saveFavorites();
  res.json({ ok: true, favorites: list });
});

/* ────────────────────────────────────────────────
 * Admin — see every user's saved homes (buyer intent signal)
 * Access: logged-in admin email, or x-admin-secret header.
 * ──────────────────────────────────────────────── */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ||
  "tez@tezbuyshouses.com,info@homerunhomes.casa")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

function isAdmin(req) {
  const headerSecret = req.headers["x-admin-secret"];
  if (ADMIN_SECRET && headerSecret && headerSecret === ADMIN_SECRET) return true;
  const email = req.session.user?.email?.toLowerCase();
  return !!email && ADMIN_EMAILS.includes(email);
}

app.get("/api/admin/favorites", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "forbidden" });
  res.set("Cache-Control", "no-store");

  const properties = loadJSON(PROPERTIES_FILE, []);
  const byId = new Map(properties.map((p) => [p.id, p]));

  const report = users.map((u) => {
    const ids = getUserFavorites(u.id);
    return {
      userId: u.id,
      name: u.full_name,
      email: u.email,
      phone: u.phone,
      signedUpAt: u.created_at,
      favoriteCount: ids.length,
      favorites: ids.map((id) => {
        const p = byId.get(id);
        return {
          propertyId: id,
          address: p ? p.address : "(no longer listed)",
          city: p ? p.cityCanonical || p.city : "",
          purchasePrice: p ? p.purchasePrice : "",
          monthlyPayment: p ? p.monthlyPayment : "",
          status: p ? p.status : "",
        };
      }),
    };
  });

  // Most-saved properties first — tells Tez which homes are in demand.
  const tally = new Map();
  for (const ids of Object.values(favorites)) {
    for (const id of ids || []) tally.set(id, (tally.get(id) || 0) + 1);
  }
  const mostSaved = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => {
      const p = byId.get(id);
      return {
        propertyId: id,
        address: p ? p.address : "(no longer listed)",
        city: p ? p.cityCanonical || p.city : "",
        saves: count,
      };
    });

  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    totalUsers: users.length,
    usersWithFavorites: report.filter((r) => r.favoriteCount > 0).length,
    totalSaves: [...tally.values()].reduce((a, b) => a + b, 0),
    mostSaved,
    users: report.sort((a, b) => b.favoriteCount - a.favoriteCount),
  });
});

/* ────────────────────────────────────────────────
 * Listings pages
 * /properties  — public browsing (signup prompts for saving)
 * /favorites   — gated, the user's saved homes
 * ──────────────────────────────────────────────── */
app.get(["/properties", "/listings", "/homes"], (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(DIST, "properties.html"));
});

app.get("/favorites", requireLogin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(DIST, "favorites.html"));
});

// SPA fallback — all routes serve index.html (client-side routing handles the rest)
app.get("*", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(DIST, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Home Run Homes running on port ${PORT}`);
});

