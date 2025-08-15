import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

// --- Nitter instance + pomožne ---
const NITTERS = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.fdn.fr',
  'https://nitter.poast.org',
  'https://nitter.moomoo.me'
];

function yRangeUTC() {
  // včeraj 00:00–24:00 UTC
  const now = new Date();
  const until = now.toISOString().slice(0, 10);
  now.setUTCDate(now.getUTCDate() - 1);
  const since = now.toISOString().slice(0, 10);
  return { since, until };
}

function proxy(u) {
  const url = new URL(u);
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}

function categorize(t) {
  const s = (t || '').toLowerCase();
  const has = (...w) => w.some(x => s.includes(x));
  if (has('vlada','minister','parlament','referendum','volitve','poslanec','premier','golob','janša')) return 'Politika';
  if (has('olimpija','maribor','nzs','nogomet','košarka','kolesar','tour','tekma','gol','liga')) return 'Šport';
  if (has('delnica','borza','inflacija','banka','evro','gospodarstvo','proračun','davki','startup')) return 'Gospodarstvo';
  if (has('iphone','android','ai','umetna inteligenca','openai','google','apple','aplikacija','tehnologija')) return 'Tehnologija';
  if (has('neurje','vreme','poplava','sneg','vihar','nevihta','arso')) return 'Vreme';
  if (has('glasba','film','serija','koncert','festival','zabava')) return 'Zabava';
  return 'Družba';
}
const snippet = (t, n=180) => {
  const s = (t||'').replace(/\s+/g,' ').trim();
  return s.length<=n?s:s.slice(0,n-1)+'…';
};

async function tryFetch(url) {
  // proxy najprej, nato direkten URL
  const urls = [proxy(url), url];
  let lastErr;
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { 'user-agent':'Mozilla/5.0', 'accept-language':'sl-SI,sl;q=0.9,en;q=0.8' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      if (!txt || txt.length < 100) throw new Error('empty');
      return { txt, used: u };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('fetch_failed');
}

(async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log(JSON.stringify({ ok:false, reason:'missing_supabase_env' }));
    process.exit(0);
  }
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { since, until } = yRangeUTC();

  // več variant poizvedb – širimo mrežo
  const queries = [
    `lang:sl src:tweet since:${since} until:${until}`,
    `src:tweet since:${since} until:${until}`,             // brez language filtra
    `lang:sl since:${since} until:${until}`,               // brez src
  ];

  let items = [];
  const attempts = [];

  // 1) POSKUS RSS (hitrejši, včasih deluje, a brez engagementa)
  for (const base of NITTERS) {
    for (const q of queries) {
      const rssUrl = `${base}/search/rss?f=tweets&q=${encodeURIComponent(q)}`;
      try {
        const { txt, used } = await tryFetch(rssUrl);
        const $ = cheerio.load(txt, { xmlMode: true });
        const nodes = $('item');
        attempts.push({ step:'rss', base, q, ok:true, count:nodes.length, used });
        if (nodes.length) {
          nodes.each((_, el) => {
            const t = $(el).find('title').text().trim();
            const link = $(el).find('link').text().trim();
            const id = (link.split('/status/')[1] || '').split(/[?#]/)[0];
            if (!id || !t) return;
            items.push({
              id, text: t,
              url: link.replace('https://nitter.net','https://x.com').replace('/i/web',''),
              likes: 0, retweets: 0,
              dateISO: new Date().toISOString()
            });
          });
          // ne prekinjamo – poskusimo še HTML za engagement
        }
      } catch (e) {
        attempts.push({ step:'rss', base, q, ok:false, error:String(e) });
      }
    }
  }

  // 2) POSKUS HTML (za ❤️/🔁)
  let htmlFound = 0;
  for (const base of NITTERS) {
    for (const q of queries) {
      const htmlUrl = `${base}/search?f=tweets&q=${encodeURIComponent(q)}`;
      try {
        const { txt, used } = await tryFetch(htmlUrl);
        const $ = cheerio.load(txt);
        const rows = $('.timeline .timeline-item');
        attempts.push({ step:'html', base, q, ok:true, count:rows.length, used });
        if (!rows.length) continue;

        rows.each((_i, el) => {
          const link = $(el).find('.tweet-date a').attr('href') || '';
          const id = (link.split('/status/')[1] || '').split(/[?/]/)[0];
          if (!id) return;
          const text = $(el).find('.tweet-content').text().trim();
          const num = (sel) => Number(($(el).find(sel).text() || '').replace(/[^0-9]/g,'') || 0);
          const likes = num('.icon-heart + .tweet-stat');
          const retweets = num('.icon-retweet + .tweet-stat');
          const dateAttr = $(el).find('.tweet-date a').attr('title') || '';
          const dateISO = dateAttr ? new Date(dateAttr).toISOString() : new Date().toISOString();

          // ali že obstaja iz RSS? -> nadgradi
          const ix = items.findIndex(x => x.id === id);
          const rec = {
            id, text,
            url: `https://x.com${link.replace('/i/web','')}`,
            likes, retweets, dateISO
          };
          if (ix >= 0) items[ix] = rec; else items.push(rec);
        });
        htmlFound += rows.length;
        if (htmlFound > 100) break;
      } catch (e) {
        attempts.push({ step:'html', base, q, ok:false, error:String(e) });
      }
    }
  }

  if (!items.length) {
    console.log(JSON.stringify({ ok:false, reason:'no_items', since, until, attempts }, null, 2));
    process.exit(0);
  }

  // 3) zapis v Supabase
  let saved = 0;
  for (const t of items) {
    const cat = categorize(t.text);
    const sn = snippet(t.text);
    const score = (t.likes || 0) + (t.retweets || 0) * 2;
    const { error } = await db.from('tweets').upsert({
      id: Number(t.id),
      text: t.text,
      url: t.url,
      likes: t.likes,
      retweets: t.retweets,
      date: t.dateISO,
      category: cat,
      snippet: sn,
      score
    });
    if (!error) saved++;
  }

  console.log(JSON.stringify({ ok:true, saved, total: items.length, since, until }, null, 2));
})();
