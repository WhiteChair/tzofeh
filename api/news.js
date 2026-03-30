// api/news.js — White House news feed proxy
// Fetches whitehouse.gov RSS and returns latest items as JSON

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600'); // 5 min cache

  try {
    // Try standard WP RSS paths
    const feedUrls = [
      'https://www.whitehouse.gov/feed/',
      'https://www.whitehouse.gov/?feed=rss2',
      'https://www.whitehouse.gov/news/feed/',
    ];
    let xml = null;
    for (const url of feedUrls) {
      try {
        const attempt = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; tzofeh/1.0)',
            'Accept': 'application/rss+xml, text/xml, application/xml, */*',
          },
        });
        if (attempt.ok) {
          const text = await attempt.text();
          if (text.includes('<rss') || text.includes('<feed')) { xml = text; break; }
        }
      } catch(e) { /* try next */ }
    }
    if (!xml) throw new Error('No WH RSS feed responded');
    const r = { ok: true }; // sentinel
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; tzofeh/1.0)',
        'Accept': 'application/rss+xml, text/xml, */*',
      },
    });

    // xml already set above

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
