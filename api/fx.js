// api/fx.js — Tzofeh data proxy
// FX:     open.er-api.com  — free, no API key, no auth, reliable
// Yields: stooq.com        — free, no API key, returns CSV, very reliable

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { mode } = req.query;

  try {

    // ── FX RATES — open.er-api.com ────────────────────────────────────────
    // Returns all spot rates vs USD in a single call. No key, no auth.
    if (mode === 'fx') {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', {
        headers: { 'User-Agent': 'tzofeh-dashboard/1.0' },
      });
      if (!r.ok) throw new Error(`er-api ${r.status}`);
      const data = await r.json();
      return res.status(200).json({ ok: true, rates: data.rates, time: data.time_last_update_utc });
    }

    // ── YESTERDAY'S FX RATES — for 1d change ─────────────────────────────
    if (mode === 'fx_prev') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
      const r = await fetch(`https://open.er-api.com/v6/${dateStr}`, {
        headers: { 'User-Agent': 'tzofeh-dashboard/1.0' },
      });
      if (!r.ok) throw new Error(`er-api prev ${r.status}`);
      const data = await r.json();
      return res.status(200).json({ ok: true, rates: data.rates });
    }

    // ── US TREASURY YIELDS — stooq.com ────────────────────────────────────
    // Stooq serves real-time/delayed bond yields as CSV, no auth needed.
    // Symbols: ust5y.b = 5Y, ust10y.b = 10Y, ust30y.b = 30Y
    if (mode === 'yields') {
      const symbols = {
        y5:  'ust5y.b',
        y10: 'ust10y.b',
        y30: 'ust30y.b',
      };

      const fetchYield = async (sym) => {
        // ?i=d = daily, returns last ~5 rows of CSV
        const r = await fetch(`https://stooq.com/q/d/l/?s=${sym}&i=d`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; tzofeh/1.0)',
            'Accept': 'text/csv,text/plain,*/*',
          },
        });
        if (!r.ok) throw new Error(`stooq ${r.status} for ${sym}`);
        const csv = await r.text();
        // CSV format: Date,Open,High,Low,Close,Volume
        // Last row = most recent
        const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('Date'));
        if (!lines.length) throw new Error(`no data for ${sym}`);
        const last = lines[lines.length - 1].split(',');
        // Close is index 4
        const price = parseFloat(last[4]);
        if (isNaN(price)) throw new Error(`bad parse for ${sym}: ${last}`);
        return price;
      };

      const results = await Promise.allSettled(
        Object.entries(symbols).map(async ([key, sym]) => {
          const price = await fetchYield(sym);
          return { key, price };
        })
      );

      const yields = {};
      results.forEach(r => {
        if (r.status === 'fulfilled') yields[r.value.key] = r.value.price;
      });

      if (!Object.keys(yields).length) {
        return res.status(502).json({ ok: false, error: 'stooq returned no data' });
      }

      return res.status(200).json({ ok: true, yields });
    }

    return res.status(400).json({ error: 'mode required: fx | fx_prev | yields' });

  } catch (err) {
    console.error('[fx proxy]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
