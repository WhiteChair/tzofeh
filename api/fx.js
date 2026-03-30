// api/fx.js — Tzofeh data proxy  v3
// FX + MA:    frankfurter.app  (free, no auth, 210d history)
// US yields:  Yahoo Finance v8 (free, no auth)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { mode } = req.query;

  try {

    // ── FX SPOT + MA50 + MA200 ─────────────────────────────────────────────
    if (mode === 'fx') {
      const today = new Date();
      const from  = new Date(today);
      from.setDate(from.getDate() - 210);
      const fromStr = from.toISOString().split('T')[0];
      const toStr   = today.toISOString().split('T')[0];

      const symbols = 'EUR,GBP,JPY,CNY,CAD,SEK,CHF';
      const r = await fetch(
        `https://api.frankfurter.app/${fromStr}..${toStr}?base=USD&symbols=${symbols}`,
        { headers: { 'User-Agent': 'tzofeh-dashboard/1.0', 'Accept': 'application/json' } }
      );
      if (!r.ok) throw new Error(`frankfurter ${r.status}`);

      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('application/json') && !ct.includes('text/json')) {
        throw new Error(`frankfurter returned non-JSON (${ct})`);
      }

      const data  = await r.json();
      const dates = Object.keys(data.rates).sort();
      if (!dates.length) throw new Error('no dates returned');

      const series = {};
      dates.forEach(d => {
        Object.entries(data.rates[d]).forEach(([ccy, val]) => {
          if (!series[ccy]) series[ccy] = [];
          series[ccy].push(val);
        });
      });

      const calcMA = (arr, n) => {
        if (arr.length < n) return null;
        const sl = arr.slice(-n);
        return sl.reduce((a, b) => a + b, 0) / n;
      };

      const dxyFromRates = (r) => {
        if (!r.EUR || !r.JPY || !r.GBP || !r.CAD || !r.SEK || !r.CHF) return null;
        return 50.14348
          * Math.pow(r.EUR, -0.576) * Math.pow(r.JPY,  0.136) * Math.pow(r.GBP, -0.119)
          * Math.pow(r.CAD,  0.091) * Math.pow(r.SEK,  0.042) * Math.pow(r.CHF,  0.036);
      };

      const latestDate = dates[dates.length - 1];
      const prevDate   = dates[dates.length - 2] || latestDate;
      const latest = data.rates[latestDate];
      const prev   = data.rates[prevDate];
      const dxySeries = dates.map(d => dxyFromRates(data.rates[d])).filter(Boolean);

      const result = {
        usa:     { current: dxyFromRates(latest), prev: dxyFromRates(prev),
                   ma50: calcMA(dxySeries, 50), ma200: calcMA(dxySeries, 200) },
        france:  { current: latest.EUR ? 1/latest.EUR : null,  prev: prev.EUR ? 1/prev.EUR : null,
                   ma50: series.EUR ? calcMA(series.EUR.map(v => 1/v), 50)  : null,
                   ma200: series.EUR ? calcMA(series.EUR.map(v => 1/v), 200) : null },
        uk:      { current: latest.GBP ? 1/latest.GBP : null,  prev: prev.GBP ? 1/prev.GBP : null,
                   ma50: series.GBP ? calcMA(series.GBP.map(v => 1/v), 50)  : null,
                   ma200: series.GBP ? calcMA(series.GBP.map(v => 1/v), 200) : null },
        germany: { current: latest.EUR ? 1/latest.EUR : null,  prev: prev.EUR ? 1/prev.EUR : null,
                   ma50: series.EUR ? calcMA(series.EUR.map(v => 1/v), 50)  : null,
                   ma200: series.EUR ? calcMA(series.EUR.map(v => 1/v), 200) : null },
        japan:   { current: latest.JPY || null, prev: prev.JPY || null,
                   ma50: series.JPY ? calcMA(series.JPY, 50)  : null,
                   ma200: series.JPY ? calcMA(series.JPY, 200) : null },
        china:   { current: latest.CNY || null, prev: prev.CNY || null,
                   ma50: series.CNY ? calcMA(series.CNY, 50)  : null,
                   ma200: series.CNY ? calcMA(series.CNY, 200) : null },
      };

      return res.status(200).json({ ok: true, fx: result, asOf: latestDate });
    }

    // ── US TREASURY YIELDS — Yahoo Finance v8 ─────────────────────────────
    // Tickers: ^FVX (5Y), ^TNX (10Y), ^TYX (30Y)
    if (mode === 'yields') {
      const tickers = { y5: '%5EFVX', y10: '%5ETNX', y30: '%5ETYX' };

      const fetchYield = async (encoded, key) => {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=5d`;
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
        });
        if (!r.ok) throw new Error(`Yahoo ${r.status} for ${key}`);

        // Guard: make sure we got JSON, not an HTML error page
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('json')) throw new Error(`Yahoo non-JSON for ${key}: ${ct}`);

        const data = await r.json();
        const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
        if (!closes?.length) throw new Error(`no close data for ${key}`);
        const price = closes.filter(v => v != null).pop();
        if (price == null || isNaN(price)) throw new Error(`bad close for ${key}`);
        return price;
      };

      const results = await Promise.allSettled(
        Object.entries(tickers).map(([key, enc]) =>
          fetchYield(enc, key).then(price => ({ key, price }))
        )
      );

      const yields = {};
      results.forEach(r => {
        if (r.status === 'fulfilled') yields[r.value.key] = r.value.price;
      });

      if (!Object.keys(yields).length) {
        return res.status(502).json({ ok: false, error: 'Yahoo Finance returned no yield data' });
      }
      return res.status(200).json({ ok: true, yields });
    }

    return res.status(400).json({ error: 'mode required: fx | yields' });

  } catch (err) {
    console.error('[fx proxy]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
