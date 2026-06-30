# Home Run Homes — Railway Deployment

Owner-financed homes and rent-to-own properties in Oklahoma City. No bank required, no credit check, 100% free for buyers.

## Tech Stack

- **Frontend:** React 19 + Tailwind CSS 4 + Vite
- **Server:** Express (serves static build with SPA fallback)
- **Routing:** Wouter (client-side)
- **Hosting:** Railway

## Pages

| Route | Description |
|-------|-------------|
| `/` | Main squeeze page (property listings, video, testimonials) |
| `/book-a-call` | ClickFunnels-style booking funnel (GHL calendar embed) |
| `/schedule` | Alias for /book-a-call |
| `/list-your-property` | Landlord intake page |
| `/landlord-thank-you` | Landlord form confirmation |
| `/rent-to-own-guide` | Ebook opt-in page |
| `/rent-to-own-guide-thank-you` | Ebook download confirmation |
| `/thank-you` | General thank you page |
| `/privacy-policy` | Privacy policy |
| `/terms` | Terms of service |

## Deploy to Railway (5 minutes)

This is a **pre-built** static site. No Vite/Tailwind build happens on Railway — it just installs Express and serves the compiled files. This avoids the Tailwind oxide/Node version issues entirely.

### Option A: Deploy from GitHub (Recommended)

1. Push this code to a GitHub repo:
```bash
cd home-run-homes-railway
git init
git add -A
git commit -m "Initial deploy"
git remote add origin https://github.com/tez-maker/home-run-homes.git
git branch -M main
git push -u origin main
```
2. Go to [railway.app](https://railway.app) and sign in with GitHub
3. Click **"New Project"** → **"Deploy from GitHub Repo"**
4. Select your `tez-maker/home-run-homes` repo
5. Railway auto-detects the `railway.toml` config — no settings to change
6. Click **Deploy** — it installs Express (~5 seconds) and starts serving
7. Go to **Settings → Networking → Generate Domain** to get your Railway URL
8. To use `homerunhomes.casa`: Go to **Settings → Networking → Custom Domain** → add `homerunhomes.casa` → update your DNS CNAME to point to Railway's provided target

### Option B: Deploy via Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create new project and deploy
railway init
railway up
```

## Custom Domain Setup (homerunhomes.casa)

1. In Railway dashboard → your service → **Settings → Networking**
2. Click **"Custom Domain"** → enter `homerunhomes.casa`
3. Railway gives you a CNAME target (like `xxx.up.railway.app`)
4. Go to your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.)
5. Update DNS: Create a **CNAME record** pointing `homerunhomes.casa` → Railway's target
6. Wait 5-15 minutes for DNS propagation
7. Railway auto-provisions SSL certificate

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (hot reload)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm start
```

## Meta Pixel

The Meta Pixel (ID: `859563789884057`) is installed site-wide in `client/index.html`. It fires:
- `PageView` on every page load
- `Lead` event specifically on `/book-a-call` and `/rent-to-own-guide-thank-you` pages

## GHL Calendar

The booking calendar on `/book-a-call` uses GoHighLevel embed:
- Calendar ID: `s7sOJmJ1u4uWb2xuwTNe`
- Form embed script loads from `link.msgsndr.com`

## Property Images

All property images are served from `/assets/` in the public folder. To add new property photos:
1. Add the image file to `client/public/assets/`
2. Reference it in `client/src/data/properties.ts` as `/assets/your-image.jpg`

## File Structure

```
├── client/
│   ├── index.html          ← HTML shell (Meta Pixel, fonts, OG tags)
│   ├── public/
│   │   ├── assets/         ← All images, video, captions
│   │   ├── sitemap.xml
│   │   └── sw.js
│   └── src/
│       ├── components/     ← Reusable UI components
│       ├── contexts/       ← Theme context
│       ├── data/           ← Property listings data
│       ├── hooks/          ← Custom hooks
│       ├── lib/            ← Utilities
│       ├── pages/          ← Page components
│       ├── App.tsx         ← Routes & layout
│       ├── main.tsx        ← Entry point
│       └── index.css       ← Global styles & Tailwind
├── shared/                 ← Shared constants
├── server.mjs             ← Production Express server
├── vite.config.ts         ← Vite build config
├── railway.toml           ← Railway deployment config
├── package.json
└── tsconfig.json
```

## Environment Variables

No environment variables are required. The site is fully static with all configuration baked in.

## Troubleshooting

**404 on page refresh:** The Express server handles SPA fallback — all routes serve `index.html`. If you deploy elsewhere (Nginx, Apache), add equivalent rewrite rules.

**Images not loading:** Ensure all `/assets/*` files are in `client/public/assets/`. The build copies them to `dist/assets/`.

**Large bundle warning:** The JS bundle is ~1.1MB (309KB gzipped). This is fine for a marketing site. If you want to optimize, add code splitting with `React.lazy()`.
