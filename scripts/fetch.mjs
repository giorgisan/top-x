import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const NITTERS = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.fdn.fr',
  'https://nitter.poast.org',
  'https://nitter.moomoo.me'
];

function daysBackISO(n=1) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function proxy(u) {
  const url = new URL(u);
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}
const cat = (t) => {
  const s=(t||'').toLowerCase(), has=(...w)=>w.some(x=>s.includes(x));
  if (has('vlada','minister','parlament','referendum','volitve','poslanec','premier','golob','janša')) return 'Politika';
  if (has('olimpija','maribor','nzs','nogomet','košarka','kolesar','tour','tekma','gol','liga')) return 'Šport';
  if (has('delnica','borza','inflacija','banka','evro','gospodarstvo','proračun','davki','startup')) return 'Gospodarstvo';
  if (has('iphone','android','ai','umetna inteligenca','openai','google','apple','aplikacija','tehnologija')) return 'Tehnologija';
  if (has('neurje','vreme','poplava','sneg','vihar','nevihta','arso')) return 'Vreme';
  if (has('glasba','film','serija','koncert','festival','zabava')) return 'Zabava';
  return 'Družba';
};
const snip = (t,n=180)=>{const s=(t||'').replace(/\s+/g,' ').trim();return s.length<=n?s:s.slice(0,n-1)+'…';};

async function getText(url) {
  const urls = [proxy(url), url];
  let last;
  for (const u of urls) {
    try {
      const res = await fetch(u, { headers: { 'user-agent':'Mozilla/5.0', 'accept-language':'sl-SI,sl;q=0.9,en;q=0.8' }});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      if (!txt || txt.length < 100) throw new Error('empty');
      return txt;
    } catch (e) { last = e; }
  }
  throw last || new Error('fetch_failed');
}

(async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log(JSON.stringify({ ok:false, reason:'missing_supabase_env' }));
    return;
  }
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Okno: včeraj in predvčerajšnjim
  const day2 = daysBackISO(2);
  const day1 = daysBackISO(1);
  const today = new Date().toISOString().slice(0,10);

  const ranges = [
    { since: day2, until: day1 },
    { since: day1, until: today }
  ];

  const queriesFor = ({since, until}) => ([
    `lang:sl src:tweet since:${since} until:${until}`,
    `src:tweet since:${since} until:${until}`,
    `lang:sl since:${since} until:${until}`
  ]);

  let items = [];
  const attempts = [];

  // 1) RSS (hiter seznam)
  for (const range of ranges) {
    const queries = queriesFor(range);
    for (const base of NITTERS) {
      for (const q of queries) {
        const rss = `${base}/search/rss?f=tweets&q=${encodeURIComponent(q)}`;
        try {
          const txt = await getText(rss);
          const $ = cheerio.load(txt, { xmlMode: true });
          const nodes = $('item');
          attempts.push({ step:'rss', base, q, count: nodes.length });
          if (!nodes.length) continue;
          nodes.each((_, el) => {
            const title = $(el).find('title').text().trim();
            const link = $(el).find('link').text().trim();
            const id = (link.split('/status/')[1] || '').split(/[?#]/)[0];
            if (!id || !title) return;
            items.push({
              id,
              text: title,
              url: link.replace('https://nitter.net','https://x.com').replace('/i/web',''),
              likes: 0, retweets: 0,
              dateISO: new Date().toISOString()
            });
          });
        } catch (e) {
          attempts.push({ step:'rss', base, q, error: String(e) });
        }
      }
    }
  }

  // 2) HTML (engagement)
  for (const range of ranges) {
    const queries = queriesFor(range);
    for (const base of NITTERS) {
      for (const q of queries) {
        const url = `${base}/search?f=tweets&q=${encodeURIComponent(q)}`;
        try {
          const txt = await getText(url);
          const $ = cheerio.load(txt);
          const rows = $('.timeline .timeline-item');
          attempts.push({ step:'html', base, q, count: rows.length });
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
            const ix = items.findIndex(x => x.id === id);
            const rec = { id, text, url: `https://x.com${link.replace('/i/web','')}`, likes, retweets, dateISO };
            if (ix >= 0) items[ix] = rec; else items.push(rec);
          });
        } catch (e) {
          attempts.push({ step:'html', base, q, error: String(e) });
        }
      }
    }
  }

  if (!items.length) {
    console.log(JSON.stringify({ ok:false, reason:'no_items', ranges, attempts }, null, 2));
    return;
  }

  // 3) zapis
  let saved = 0;
  for (const t of items) {
    const score = (t.likes||0) + (t.retweets||0)*2;
    const { error } = await db.from('tweets').upsert({
      id: Number(t.id),
      text: t.text,
      url: t.url,
      likes: t.likes,
      retweets: t.retweets,
      date: t.dateISO,
      category: cat(t.text),
      snippet: snip(t.text),
      score
    });
    if (!error) saved++;
  }

  console.log(JSON.stringify({ ok:true, saved, total: items.length, ranges }, null, 2));
})();
