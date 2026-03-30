// api/fx.js — Tzofeh data proxy
// FX spot + 1d change: open.er-api.com   (free, no auth)
// MA50 / MA200:        frankfurter.app    (free, no auth, full history)
// US yields:           stooq.com          (free, no auth, CSV)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { mode } = req.query;

  try {

    // ── FX SPOT + MA50 + MA200 ────────────────────────────────────────────────
    // frankfurter.app returns daily rates for a date range in one call.
    // We fetch 210 days of history → compute MAs → return current, 1d change, MA50, MA200.
    if (mode === 'fx') {
      const today = new Date();
      const from  = new Date(today);
      from.setDate(from.getDate() - 210);
      const fromStr = from.toISOString().split('T')[0];
      const toStr   = today.toISOString().split('T')[0];

      // All pairs we need (vs USD base)
      const symbols = 'EUR,GBP,JPY,CNY,CAD,SEK,CHF';

      const r = await fetch(
        `https://api.frankfurter.app/${fromStr}..${toStr}?base=USD&symbols=${symbols}`,
        { headers: { 'User-Agent': 'tzofeh-dashboard/1.0', 'Accept': 'application/json' } }
      );
      if (!r.ok) throw new Error(`frankfurter ${r.status}`);
      const data = await r.json();

      // data.rates = { "2025-01-02": { EUR: 0.923, GBP: 0.789, ... }, ... }
      const dates = Object.keys(data.rates).sort();
      if (!dates.length) throw new Error('no dates returned');

      // Build time-series per currency
      const series = {}; // { EUR: [0.921, 0.923, ...], ... }
      dates.forEach(d => {
        const dayRates = data.rates[d];
        Object.entries(dayRates).forEach(([ccy, val]) => {
          if (!series[ccy]) series[ccy] = [];
          series[ccy].push(val);
        });
      });

      const calcMA = (arr, n) => {
        if (arr.length < n) return null;
        const slice = arr.slice(-n);
        return slice.reduce((a, b) => a + b, 0) / n;
      };

      // Derived rates: EUR/USD = 1/EUR, GBP/USD = 1/GBP, USD/JPY = JPY, etc.
      const dxyFromRates = (r) => {
        if (!r.EUR || !r.JPY || !r.GBP || !r.CAD || !r.SEK || !r.CHF) return null;
        return 50.14348
          * Math.pow(r.EUR, -0.576) * Math.pow(r.JPY, 0.136) * Math.pow(r.GBP, -0.119)
          * Math.pow(r.CAD, 0.091)  * Math.pow(r.SEK, 0.042) * Math.pow(r.CHF, 0.036);
      };

      // Latest and previous day
      const latestDate   = dates[dates.length - 1];
      const prevDate     = dates[dates.length - 2] || dates[dates.length - 1];
      const latest       = data.rates[latestDate];
      const prev         = data.rates[prevDate];

      // Build DXY series
      const dxySeries = dates.map(d => dxyFromRates(data.rates[d])).filter(Boolean);

      const result = {
        usa: {
          current:  dxyFromRates(latest),
          prev:     dxyFromRates(prev),
          ma50:     calcMA(dxySeries, 50),
          ma200:    calcMA(dxySeries, 200),
        },
        france: {
          current:  latest.EUR ? 1 / latest.EUR : null,
          prev:     prev.EUR   ? 1 / prev.EUR   : null,
          ma50:     series.EUR ? calcMA(series.EUR.map(v => 1/v), 50)  : null,
          ma200:    series.EUR ? calcMA(series.EUR.map(v => 1/v), 200) : null,
        },
        uk: {
          current:  latest.GBP ? 1 / latest.GBP : null,
          prev:     prev.GBP   ? 1 / prev.GBP   : null,
          ma50:     series.GBP ? calcMA(series.GBP.map(v => 1/v), 50)  : null,
          ma200:    series.GBP ? calcMA(series.GBP.map(v => 1/v), 200) : null,
        },
        germany: {
          current:  latest.EUR ? 1 / latest.EUR : null,
          prev:     prev.EUR   ? 1 / prev.EUR   : null,
          ma50:     series.EUR ? calcMA(series.EUR.map(v => 1/v), 50)  : null,
          ma200:    series.EUR ? calcMA(series.EUR.map(v => 1/v), 200) : null,
        },
        japan: {
          current:  latest.JPY  || null,
          prev:     prev.JPY    || null,
          ma50:     series.JPY  ? calcMA(series.JPY,  50)  : null,
          ma200:    series.JPY  ? calcMA(series.JPY,  200) : null,
        },
        china: {
          current:  latest.CNY  || null,
          prev:     prev.CNY    || null,
          ma50:     series.CNY  ? calcMA(series.CNY,  50)  : null,
          ma200:    series.CNY  ? calcMA(series.CNY,  200) : null,
        },
      };

      return res.status(200).json({ ok: true, fx: result, asOf: latestDate });
    }

    // ── US TREASURY YIELDS — stooq.com ────────────────────────────────────────
    if (mode === 'yields') {
      const yieldSymbols = { y5: 'ust5y.b', y10: 'ust10y.b', y30: 'ust30y.b' };

      const fetchYield = async (sym) => {
        const r = await fetch(`https://stooq.com/q/d/l/?s=${sym}&i=d`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tzofeh/1.0)', 'Accept': 'text/csv,*/*' },
        });
        if (!r.ok) throw new Error(`stooq ${r.status} for ${sym}`);
        const csv = await r.text();
        const lines = csv.trim().split('\n').filter(l => l && !l.toLowerCase().startsWith('date'));
        if (!lines.length) throw new Error(`no data for ${sym}`);
        const cols = lines[lines.length - 1].split(',');
        const price = parseFloat(cols[4]); // Close
        if (isNaN(price)) throw new Error(`bad parse: ${cols}`);
        return price;
      };

      const results = await Promise.allSettled(
        Object.entries(yieldSymbols).map(async ([key, sym]) => ({ key, price: await fetchYield(sym) }))
      );

      const yields = {};
      results.forEach(r => { if (r.status === 'fulfilled') yields[r.value.key] = r.value.price; });

      if (!Object.keys(yields).length) return res.status(502).json({ ok: false, error: 'stooq returned no data' });
      return res.status(200).json({ ok: true, yields });
    }

    return res.status(400).json({ error: 'mode required: fx | yields' });

  } catch (err) {
    console.error('[fx proxy]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
