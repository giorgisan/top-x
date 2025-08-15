import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

// ---- konfiguracija iskanja (po potrebi spremeni) ----
const NITTERS = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.fdn.fr',
  'https://nitter.poast.org',
  'https://nitter.moomoo.me'
];

function yesterdayRange() {
  const now = new Date();
  const until = now.toISOString().slice(0, 10);
  now.setDate(now.getDate() - 1);
  const since = now.toISOString().slice(0, 10);
  return { since, until };
}

function proxy(u) {
  const url = new URL(u);
  // r.jina.ai -> HTTP znotraj je pomemben
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}

function categorize(t) {
  const s = (t || '').toLowerCase();
  const has = (...w) => w.some(x => s.includes(x));
  if (has('vlada','minister','parlament','referendum','volitve','poslanec','premier','janša','golob','ministrstvo')) return 'Politika';
  if (has('olimpija','maribor','nzs','nogomet','košarka','kolesar','tour','dirka','tekma','gol','liga')) return 'Šport';
  if (has('delnica','borza','inflacija','banka','evro','gospodarstvo','proračun','bdp','davki','podjetje','startup')) return 'Gospodarstvo';
  if (has('iphone','android','ai','umetna inteligenca','openai','google','apple','program','aplikacija','tehnologija')) return 'Tehnologija';
  if (has('neurje','vreme','poplava','sneg','vihar','temperatura','nevihta','arso')) return 'Vreme';
  if (has('glasba','film','serija','zabava','koncert','festival','influencer','zvezda')) return 'Zabava';
  return 'Družba';
}
function snippet(t, max=180){ const s=(t||'').replace(/\s+/g,' ').trim(); return s.length<=max?s:s.slice(0,max-1)+'…'; }

// ---- main ----
(async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY env');
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { since, until } = yesterdayRange();
  const q = encodeURIComponent(`lang:sl since:${since} until:${until}`);
  const rssPath = `/search/rss?f=tweets&q=${q}`;
  const htmlPath = `/search?f=tweets&q=${q}`;

  let items = [];

  // 1) poskusi RSS (prek več instanc)
  for (const base of NITTERS) {
    try {
      const res = await fetch(proxy(`${base}${rssPath}`));
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml || xml.length < 100) continue;

      const $rss = cheerio.load(xml, { xmlMode: true });
      const nodes = $rss('item');
      if (nodes.length === 0) continue;

      nodes.each((_, el) => {
        const $el = $rss(el);
        const title = ($el.find('title').text() || '').trim();
        const link = ($el.find('link').text() || '').trim();
        const id = (link.split('/status/')[1] || '').split(/[?#]/)[0];
        if (!id || !title) return;
        items.push({
          id,
          text: title,
          url: link.replace('https://nitter.net', 'https://x.com').replace('/i/web',''),
          likes: 0, retweets: 0,
          dateISO: new Date().toISOString()
        });
      });
      if (items.length) break;
    } catch {}
  }

  // 2) fallback: HTML (prek proxyja)
  if (!items.length) {
    for (const base of NITTERS) {
      try {
        const res = await fetch(proxy(`${base}${htmlPath}`), {
          headers: {'user-agent':'Mozilla/5.0','accept-language':'sl-SI,sl;q=0.9,en;q=0.8'}
        });
        if (!res.ok) continue;
        const html = await res.text();
        if (!html || (!html.includes('timeline') && !html.includes('timeline-item'))) continue;

        const $ = cheerio.load(html);
        $('.timeline .timeline-item').each((_, el) => {
          const $el = $(el);
          const link = $el.find('.tweet-date a').attr('href') || '';
          const id = (link.split('/status/')[1] || '').split(/[?/]/)[0];
          if (!id) return;
          const text = ($el.find('.tweet-content').text() || '').trim();
          const number = (sel) => {
            const raw = ($el.find(sel).text() || '').replace(/[^0-9]/g,'');
            return Number(raw || 0);
          };
          const likes = number('.icon-heart + .tweet-stat');
          const retweets = number('.icon-retweet + .tweet-stat');
          const dateAttr = $el.find('.tweet-date a').attr('title') || '';
          const dateISO = dateAttr ? new Date(dateAttr).toISOString() : new Date().toISOString();

          items.push({
            id, text,
            url: `https://x.com${link.replace('/i/web','')}`,
            likes, retweets, dateISO
          });
        });
        if (items.length) break;
      } catch {}
    }
  }

  if (!items.length) {
    console.log(JSON.stringify({ ok:false, reason:'no_items_from_nitter', since, until }, null, 2));
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

  console.log(JSON.stringify({ ok:true, saved, since, until }, null, 2));
})();
