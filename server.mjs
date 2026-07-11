/**
 * Production server for Railway deployment.
 * Serves the Vite-built static files with SPA fallback (all routes → index.html).
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, "dist");

// Serve static files with caching
app.use(
  express.static(DIST, {
    maxAge: "1d",
    etag: true,
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

// SPA fallback — all routes serve index.html (client-side routing handles the rest)
app.get("*", (req, res) => {
  res.sendFile(path.join(DIST, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Home Run Homes running on port ${PORT}`);
});
