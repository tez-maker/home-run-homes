/**
 * Four property IDs are reused by two different addresses each
 * (HRH-060, HRH-033, HRH-055, HRH-028). Favorites are keyed by ID, so a
 * collision would make one property's heart toggle the other's. This assigns
 * a unique suffixed ID to the second occurrence of any duplicate and clears
 * photos that were only inherited via the colliding ID.
 *
 * Usage: node scripts/fix-duplicate-ids.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROPS = path.join(__dirname, "..", "properties.json");

const properties = JSON.parse(fs.readFileSync(PROPS, "utf8"));

const seen = new Map();
const changes = [];

for (const p of properties) {
  const base = p.id;
  if (!seen.has(base)) {
    seen.set(base, 1);
    continue;
  }
  const n = seen.get(base) + 1;
  seen.set(base, n);
  const newId = `${base}-${String.fromCharCode(96 + n)}`; // HRH-033-b
  changes.push({ from: base, to: newId, address: p.address });
  p.id = newId;
  // The photo was matched purely by the shared ID prefix, so it is not
  // trustworthy for the second record — drop it rather than show a wrong house.
  if (p.images?.length) p.images = [];
}

fs.writeFileSync(PROPS, JSON.stringify(properties, null, 2), "utf8");

console.log(`Reassigned ${changes.length} duplicate ID(s):`);
for (const c of changes) console.log(`  ${c.from} -> ${c.to}  (${c.address})`);

const ids = properties.map((p) => p.id);
console.log("unique ids:", new Set(ids).size, "of", ids.length);
