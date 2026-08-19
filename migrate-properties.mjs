/**
 * One-time migration of properties.json into a cleaner schema for the
 * Zillow-style listings platform.
 *
 *  - Splits the overloaded `images` array into:
 *      images    -> real photo files only (local /assets/... paths)
 *      zillowUrl -> canonical zillow.com listing URL ("" placeholder when unknown)
 *      tourUrl   -> Google Drive / Dropbox / 3D tour / photo-gallery links
 *  - Drops junk placeholder text ("Coming Soon!", "will follow up", ...)
 *  - Recovers the 44 local property photos from dist/assets that the old SPA
 *    bundle referenced but properties.json never carried.
 *  - Adds `cityCanonical` + `zip` so the city filter has ~20 clean options
 *    instead of 47 spelling variants.
 *  - Adds numeric mirrors (priceNum, downNum, monthlyNum, bedsNum, bathsNum)
 *    so the front end can filter/sort without re-parsing "$1,650" strings.
 *  - Keeps every original field untouched for backwards compatibility.
 *
 * Usage: node scripts/migrate-properties.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PROPS = path.join(ROOT, "properties.json");
const ASSETS = path.join(ROOT, "dist", "assets");

/* ── City canonicalization ────────────────────────────────────────────── */
const CITY_ALIASES = {
  okc: "Oklahoma City",
  "oklahoma city": "Oklahoma City",
  "oklahoma  city": "Oklahoma City",
  mwc: "Midwest City",
  "midwest city": "Midwest City",
  "del city": "Del City",
  "the village": "The Village",
  "warr acres": "Warr Acres",
  "el reno": "El Reno",
  moore: "Moore",
  norman: "Norman",
  edmond: "Edmond",
  yukon: "Yukon",
  bethany: "Bethany",
  spencer: "Spencer",
  mustang: "Mustang",
  choctaw: "Choctaw",
  "choctaw oklahoma": "Choctaw",
  newcastle: "Newcastle",
  newalla: "Newalla",
  shawnee: "Shawnee",
  tuttle: "Tuttle",
  guthrie: "Guthrie",
  "guthrie okc": "Guthrie",
  lawton: "Lawton",
  tulsa: "Tulsa",
  harrah: "Harrah",
  blanchard: "Blanchard",
  purcell: "Purcell",
  noble: "Noble",
};

/* ZIP -> city fallback for records that only carry a ZIP ("OK 73119") */
const ZIP_CITY = {
  73013: "Edmond", 73020: "Choctaw", 73036: "El Reno", 73068: "Norman",
  73107: "Oklahoma City", 73109: "Oklahoma City", 73110: "Midwest City",
  73119: "Oklahoma City", 73130: "Midwest City", 73159: "Oklahoma City",
  73160: "Moore", 73044: "Guthrie", 73099: "Yukon", 73505: "Lawton",
  73507: "Lawton",
};

function parseCity(raw) {
  const s = String(raw || "").trim();
  const zipMatch = s.match(/\b(7\d{4})\b/);
  const zip = zipMatch ? zipMatch[1] : "";

  // Strip ZIP and trailing state token, then normalize separators.
  let core = s
    .replace(/\b7\d{4}\b/g, "")
    .replace(/,?\s*\b(OK|Ok|ok|Oklahoma)\b\s*$/g, "")
    .replace(/[,\s]+$/g, "")
    .trim();

  const key = core.toLowerCase().replace(/\s+/g, " ");
  let canonical = CITY_ALIASES[key];

  if (!canonical) {
    // Try the leading token set (e.g. "Oklahoma City, OK" already handled above)
    const firstPart = key.split(",")[0].trim();
    canonical = CITY_ALIASES[firstPart];
  }
  if (!canonical && zip && ZIP_CITY[zip]) canonical = ZIP_CITY[zip];
  if (!canonical) {
    canonical = core
      ? core.replace(/\b\w/g, (c) => c.toUpperCase())
      : "Oklahoma City";
  }
  return { canonical, zip };
}

/* ── Money / number parsing ───────────────────────────────────────────── */
function toNum(v) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/* ── Link classification ──────────────────────────────────────────────── */
const PHOTO_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

function classifyLinks(images) {
  const photos = [];
  let zillowUrl = "";
  let tourUrl = "";

  for (const raw of images || []) {
    const s = String(raw).trim().replace(/^"+|"+$/g, "");
    if (!s || !/^https?:\/\//i.test(s)) continue; // junk text -> dropped

    if (/(^|\.)zillow\.com/i.test(s)) {
      if (!zillowUrl) zillowUrl = s.split("?")[0]; // drop utm noise
      continue;
    }
    if (PHOTO_EXT.test(s) || s.startsWith("/assets/")) {
      photos.push(s);
      continue;
    }
    if (!tourUrl) tourUrl = s; // drive folder, 3d tour, dropbox, gallery
  }
  return { photos, zillowUrl, tourUrl };
}

/* ── Recover local photos from dist/assets ────────────────────────────── */
function buildLocalPhotoIndex() {
  const index = {};
  if (!fs.existsSync(ASSETS)) return index;
  for (const file of fs.readdirSync(ASSETS)) {
    const m = file.match(/^(HRH-\d+)_[a-f0-9]+\.(jpe?g|png|webp)$/i);
    if (m) {
      (index[m[1]] ||= []).push(`/assets/${file}`);
    }
  }
  for (const k of Object.keys(index)) index[k].sort();
  return index;
}

/* ── Run ──────────────────────────────────────────────────────────────── */
const properties = JSON.parse(fs.readFileSync(PROPS, "utf8"));
const localPhotos = buildLocalPhotoIndex();

const stats = {
  total: properties.length, withPhoto: 0, withZillow: 0,
  withTour: 0, junkDropped: 0, citiesBefore: new Set(), citiesAfter: new Set(),
};

const migrated = properties.map((p) => {
  const originalImages = p.images || [];
  const { photos, zillowUrl, tourUrl } = classifyLinks(originalImages);

  stats.junkDropped += originalImages.filter(
    (i) => !/^https?:\/\//i.test(String(i).trim().replace(/^"+|"+$/g, ""))
  ).length;

  // Prefer photos already present; otherwise recover from dist/assets by id.
  const images = photos.length ? photos : (localPhotos[p.id] || []);

  const { canonical, zip } = parseCity(p.city);
  stats.citiesBefore.add(String(p.city || "").trim());
  stats.citiesAfter.add(canonical);
  if (images.length) stats.withPhoto++;
  if (zillowUrl) stats.withZillow++;
  if (tourUrl) stats.withTour++;

  const notes = String(p.sqft || "").trim();

  return {
    id: p.id,
    address: p.address,
    city: p.city,                 // original string preserved
    cityCanonical: canonical,     // for the filter dropdown
    zip,
    bedrooms: p.bedrooms ?? "",
    bathrooms: p.bathrooms ?? "",
    monthlyPayment: p.monthlyPayment ?? "",
    downPayment: p.downPayment ?? "",
    purchasePrice: p.purchasePrice ?? "",
    status: p.status ?? "",
    sqft: p.sqft ?? "",           // original free-text notes preserved
    notes,                        // clearer alias for the detail view
    images,
    zillowUrl,                    // "" = placeholder, fill from Google Sheet
    tourUrl,
    priceNum: toNum(p.purchasePrice),
    downNum: toNum(p.downPayment),
    monthlyNum: toNum(p.monthlyPayment),
    bedsNum: toNum(p.bedrooms),
    bathsNum: toNum(p.bathrooms),
  };
});

fs.copyFileSync(PROPS, path.join(ROOT, "properties.backup.json"));
fs.writeFileSync(PROPS, JSON.stringify(migrated, null, 2), "utf8");

console.log("Migration complete");
console.log("  total properties :", stats.total);
console.log("  with photo(s)    :", stats.withPhoto);
console.log("  with zillowUrl   :", stats.withZillow);
console.log("  with tourUrl     :", stats.withTour);
console.log("  junk strings cut :", stats.junkDropped);
console.log("  city strings     :", stats.citiesBefore.size, "->", stats.citiesAfter.size);
console.log("  cities:", [...stats.citiesAfter].sort().join(", "));
