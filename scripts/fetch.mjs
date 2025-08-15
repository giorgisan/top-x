import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const NITTERS = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.fdn.fr',
  'https://nitter.poast.org',
  'https://nitter.moomoo.me'
];

function daysBackISO(n = 1) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function proxy(u) {
  const url = new URL(u);
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}
const categorize = (t) => {
  const s=(t||'').toLowerCase(), has=(...w)=>w.some(x=>s.includes(x));
  if (has('vlada','minister','parlament','referendum','volitve','poslanec','premier','golob','janša')) return 'Politika';
  if (has('olimpija','maribor','nzs','nogomet','košarka','kolesar','tour','tekma','gol','liga')) return 'Šport';
  if (has('delnica','borza','inflacija','banka','evro','gospodarstvo','proračun','davki','startup')) return 'Gospodarstvo';
  if (has('iphone','android','ai','umetna inteligenca','openai','google','apple','aplikacija','tehnologija')) return 'Tehnologija';
  if (has('neurje','vreme','poplava','sneg','vihar','nevihta','arso')) return 'Vreme';
  if (has('glasba','film','serija','koncert','festival','zabava')) return 'Zabava';
  return 'Družba';
};
const snippet = (t,n=180)=>{const s=(t||'').replace(/\s+/g,' ').trim();return s.length<=n?s:s.slice(0,n-1)+'…';};

async function getText(url) {
  // najprej preko proxyja, potem neposredno
  const urls = [proxy(url), url];
  let last;
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'sl-SI,sl;q=0.9,en;q=0.8' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      if (!txt || txt.length < 100) throw new Error('empty');
      return txt;
    } catch (e) { last = e; }
  }
  throw last || new Error('fetch_failed');
}

/* ----------  PLAN A: Nitter search  ---------- */
async function tryNitterCollect(ranges) {
  let items = [];
  const queriesFor = ({ since, until }) => ([
    `lang:sl src:tweet since:${since} until:${until}`,
    `src:tweet since:${since} until:${until}`,
    `lang:sl since:${since} until:${until}`
  ]);

  // RSS za hiter seznam
  for (const range of ranges) {
    for (const base of NITTERS) {
      for (const q of queriesFor(range)) {
        try {
          const rss = `${base}/search/rss?f=tweets&q=${encodeURIComponent(q)}`;
          const txt = await getText(rss);
          const $ = cheerio.load(txt, { xmlMode: true });
          $('item').each((_i, el) => {
            const link = $(el).find('link').text().trim();
            const title = $(el).find('title').text().trim();
            const id = (link.split('/status/')[1] || '').split(/[?#]/)[0];
            if (!id || !title) return;
            // préfill; engagement bomo poskusili dopolniti iz HTML
            items.push({ id, url: link.replace('https://nitter.net','https://x.com').replace('/i/web',''), text: title, likes: 0, retweets: 0, dateISO: new Date().toISOString() });
          });
        } catch {}
      }
    }
  }

  // HTML za engagement (če ga dobimo)
  for (const range of ranges) {
    for (const base of NITTERS) {
      for (const q of [`lang:sl src:tweet since:${range.since} until:${range.until}`, `src:tweet since:${range.since} until:${range.until}`]) {
        try {
          const url = `${base}/search?f=tweets&q=${encodeURIComponent(q)}`;
          const txt = await getText(url);
          const $ = cheerio.load(txt);
          $('.timeline .timeline-item').each((_i, el) => {
            const href = $(el).find('.tweet-date a').attr('href') || '';
            const id = (href.split('/status/')[1] || '').split(/[?/]/)[0];
            if (!id) return;
            const text = $(el).find('.tweet-content').text().trim();
            const num = (sel) => Number(($(el).find(sel).text() || '').replace(/[^0-9]/g,'') || 0);
            const likes = num('.icon-heart + .tweet-stat');
            const retweets = num('.icon-retweet + .tweet-stat');
            const dateAttr = $(el).find('.tweet-date a').attr('title') || '';
            const dateISO = dateAttr ? new Date(dateAttr).toISOString() : new Date().toISOString();

            const ix = items.findIndex(x => x.id === id);
            const rec = { id, url: `https://x.com${href.replace('/i/web','')}`, text, likes, retweets, dateISO };
            if (ix >= 0) items[ix] = rec; else items.push(rec);
          });
        } catch {}
      }
    }
  }
  return items;
}

/* ----------  PLAN B: Google fallback (brez metrik)  ---------- */
async function googleCollect() {
  // zadnjih 24h: tbs=qdr:d ; iščemo samo "status" strani
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent('site:x.com/status')}&hl=sl&tbs=qdr:d&num=50`;
  const html = await getText(googleUrl);
  const $ = cheerio.load(html);

  // rezultati so v <a href="/url?q=...">
  const links = [];
  $('a').each((_i, a) => {
    const href = $(a).attr('href') || '';
    if (!href.startsWith('/url?q=')) return;
    const real = decodeURIComponent(href.slice(7).split('&')[0]);
    if (!real.includes('x.com') || !real.includes('/status/')) return;
    links.push(real);
  });

  const unique = [...new Set(links)].slice(0, 50);
  const items = [];

  for (const link of unique) {
    try {
      const html2 = await getText(link);
      const $2 = cheerio.load(html2);
      const text =
        $2("meta[property='og:description']").attr('content') ||
        $2("meta[name='description']").attr('content') ||
        $2('title').text() || '';
      const id = (link.split('/status/')[1] || '').split(/[?#]/)[0];
      if (!id || !text) continue;
      items.push({
        id,
        url: link.replace('/i/web',''),
        text: text.trim(),
        likes: 0,
        retweets: 0,
        dateISO: new Date().toISOString()
      });
    } catch {}
  }
  return items;
}

(async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log(JSON.stringify({ ok:false, reason:'missing_supabase_env' }));
    return;
  }
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // okno 48h (včeraj + predvčerajšnjim)
  const ranges = [
    { since: daysBackISO(2), until: daysBackISO(1) },
    { since: daysBackISO(1), until: new Date().toISOString().slice(0,10) }
  ];

  let items = await tryNitterCollect(ranges);

  if (!items.length) {
    // Fallback na Google (brez metrik)
    const googleItems = await googleCollect();
    items = googleItems;
  }

  if (!items.length) {
    console.log(JSON.stringify({ ok:false, reason:'no_items_both_sources' }, null, 2));
    return;
  }

  // zapis v Supabase
  let saved = 0;
  for (const t of items) {
    const score = (t.likes || 0) + (t.retweets || 0) * 2;
    const { error } = await db.from('tweets').upsert({
      id: Number(t.id),
      text: t.text,
      url: t.url,
      likes: t.likes,
      retweets: t.retweets,
      date: t.dateISO,
      category: categorize(t.text),
      snippet: snippet(t.text),
      score
    });
    if (!error) saved++;
  }

  console.log(JSON.stringify({ ok:true, saved, total: items.length, note: !items.some(i=>i.likes||i.retweets) ? 'fallback_google_no_metrics' : 'nitter_ok' }, null, 2));
})();
