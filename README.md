# צֹפֶה · Tzofeh — Geopolitical Intelligence Dashboard

> Hedge fund · Political risk · Intelligence · Journalism

The Global Yield Matrix sits on the Matrix tab, under the geopolitical risk matrix: [https://tzofeh.vercel.app/#matrix](https://tzofeh.vercel.app/#matrix).

## Live Data
- **FX**: Yahoo Finance, proxied by `api/fx.js` (no API key)
- **Government bond yields**: official sources, saved in `data/yields.json`. A GitHub Action refreshes that file on weekdays. See below.
- **Central-bank decisions**: `data/central-banks.json`, recorded from official statements. The same Action checks the Bank of Canada overnight target.
- **AI Race**: snapshot of the [Arena agent leaderboard](https://arena.ai/leaderboard/agent) in `data/ai-race.json`
- **Political data**: static JSON embedded in `index.html`, last verified Mar 2025
- **Refresh**: the Matrix tab still has a live FX refresh. Bond yields update with the weekday commit, not that button.

## Project Structure
```
tzofeh/
├── index.html                 # SPA — geopolitical tabs plus AI Race
├── market.js                  # Yield matrix, central-bank decisions, AI Race
├── data/
│   ├── yields.json
│   ├── central-banks.json
│   └── ai-race.json
├── scripts/refresh_data.py    # Weekday fetch
├── api/
│   ├── fx.js
│   └── news.js
├── .github/workflows/refresh-data.yml
├── favicon.svg                # Lighthouse mark, plus png/ico fallbacks
├── vercel.json
└── README.md
```

## Yield refresh
`.github/workflows/refresh-data.yml` runs at 22:00 UTC, Monday to Friday. It fetches free official curves, commits `data/` only when the figures changed, and the Vercel Git integration redeploys production from that push to `main`. No Vercel cron and no paid market-data API.

No secret is required. Optional: add a repository secret named `WEBSTAT_API_KEY` (a free Banque de France Webstat client id from [developer.webstat.banque-france.fr](https://developer.webstat.banque-france.fr/)). With it, the job fills French tenors other than the 10-year TEC. Without it, those cells stay `n/a`.

The Action needs permission to push to `main`, and the Vercel project needs to stay connected to this GitHub repo so that push redeploys.

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
Yahoo Finance's quote and chart endpoints are public and unauthenticated.
The `/api/fx.js` function runs server-side (Node.js), so there are no browser CORS issues.
Bond yields do not use Yahoo. The optional Webstat key above is the only secret, and the site works without it.

## Updating Political Data
All political data lives in the `const C = { ... }` and `const CHINA = { ... }` objects
near the top of `index.html`. Each country has a `lastUpdated` field.

## Keyboard Shortcuts
`1` Matrix · `2` USA · `3` France · `4` UK · `5` Germany · `6` Japan · `7` China · `8` EU · `9` AI Race

## Theme
Toggle between **FT Beige** (light) and **Bloomberg Terminal** (dark) via the ☽/☀ button.
Preference is saved to localStorage.
