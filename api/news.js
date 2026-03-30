// api/news.js — White House news feed proxy
// Fetches whitehouse.gov RSS and returns latest items as JSON

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600'); // 5 min cache

  try {
    const r = await fetch('https://www.whitehouse.gov/feed/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; tzofeh/1.0)',
        'Accept': 'application/rss+xml, text/xml, */*',
      },
    });

    if (!r.ok) throw new Error(`WH feed ${r.status}`);

    const xml = await r.text();

    // Parse RSS items with regex (no DOM parser in Edge/Node serverless)
    const items = [];
    const itemRx = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRx.exec(xml)) !== null && items.length < 8) {
      const block = m[1];
      const get = (tag) => {
        const t = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([^<]*)<\/${tag}>`);
        const r = t.exec(block);
        return r ? (r[1] || r[2] || '').trim() : '';
      };
      const title    = get('title');
      const link     = get('link') || block.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() || '';
      const pubDate  = get('pubDate');
      const category = get('category');
      const desc     = get('description').replace(/<[^>]+>/g, '').substring(0, 160).trim();

      if (title) items.push({ title, link, pubDate, category, desc });
    }

    return res.status(200).json({ ok: true, items, asOf: new Date().toISOString() });

  } catch (err) {
    console.error('[news proxy]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
