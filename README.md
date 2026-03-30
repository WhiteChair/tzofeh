# צֹפֶה · Tzofeh — Geopolitical Intelligence Dashboard

> Hedge fund · Political risk · Intelligence · Journalism

## Live Data
- **FX & Yields**: Yahoo Finance (no API key — public endpoint, proxied server-side)
- **Political data**: Static JSON embedded in `index.html`, last verified Mar 2025
- **Refresh**: Manual refresh button on the Matrix tab; auto-fetches on page load

## Project Structure
```
tzofeh/
├── index.html          # Full SPA — all 8 tabs, all countries
├── api/
│   └── fx.js           # Vercel serverless function — Yahoo Finance proxy
├── vercel.json         # Vercel config
└── README.md
```

## Deploy to Vercel

### Option A — Vercel CLI (recommended)
```bash
npm i -g vercel
cd tzofeh
vercel
```
Follow the prompts. No environment variables required.

### Option B — Vercel Dashboard
1. Push this folder to a GitHub repo
2. Go to https://vercel.com/new
3. Import the repo → Framework: **Other** → Root directory: `/` → Deploy

### Option C — One-liner deploy
```bash
npx vercel --yes
```

## No API Keys Required
Yahoo Finance's v7 quote and v8 chart endpoints are public and unauthenticated.
The `/api/fx.js` function runs server-side (Node.js), so there are no browser CORS issues.

## Updating Political Data
All political data lives in the `const C = { ... }` and `const CHINA = { ... }` objects
near the top of `index.html`. Each country has a `lastUpdated` field.

## Keyboard Shortcuts
`1` Matrix · `2` USA · `3` France · `4` UK · `5` Germany · `6` Japan · `7` China · `8` EU

## Theme
Toggle between **FT Beige** (light) and **Bloomberg Terminal** (dark) via the ☽/☀ button.
Preference is saved to localStorage.
