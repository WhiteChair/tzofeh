// api/news.js — White House news feed proxy
// Tries multiple WP RSS paths, returns latest items as JSON

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const feedUrls = [
    'https://www.whitehouse.gov/?feed=rss2',
    'https://www.whitehouse.gov/feed/',
    'https://www.whitehouse.gov/news/feed/',
  ];

  try {
    let xml = null;
    for (const url of feedUrls) {
      try {
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; tzofeh/1.0)',
            'Accept': 'application/rss+xml, text/xml, */*',
          },
        });
        if (r.ok) {
          const text = await r.text();
          if (text.includes('<item>')) { xml = text; break; }
        }
      } catch (e) { /* try next */ }
    }

    if (!xml) throw new Error('No WH RSS feed responded');

    const items = [];
    const itemRx = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRx.exec(xml)) !== null && items.length < 8) {
      const block = m[1];
      const get = (tag) => {
        const t = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`);
        const r = t.exec(block);
        return r ? (r[1] || r[2] || '').trim() : '';
      };
      const title    = get('title');
      const pubDate  = get('pubDate');
      const category = get('category');
      const desc     = get('description').replace(/<[^>]+>/g, '').substring(0, 160).trim();
      // link is between tags, not CDATA
      const linkM = block.match(/<link>([^<]+)<\/link>/);
      const link  = linkM ? linkM[1].trim() : '';
      if (title) items.push({ title, link, pubDate, category, desc });
    }

    return res.status(200).json({ ok: true, items, asOf: new Date().toISOString() });

  } catch (err) {
    console.error('[news proxy]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
