import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

/* ------------------ nastavitve ------------------ */
const NITTERS = [
  'https://nitter.net',
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
  'https://nitter.fdn.fr',
  'https://nitter.moomoo.me',
];

// kurirana SLO lista (za Plan C). Po potrebi dodaj/odstrani.
const SLO_ACCOUNTS = [
  // mediji / agencije
  'STA_novice','RTV_Slovenija','24ur_com','vecer','Delo','Dnevnik_si','SiolNEWS','FinanceSI',
  // institucije
  'vladaRS','DrzavniZbor','policija_si','MZZRS','MO_RS','MNZ_gov_si','NIJZ_pr','Arso_Vreme',
  // lokalno
  'Ljubljana','MOLjubljana','MestnaObcinaMB','VisitMaribor',
  // šport
  'nzs_si','nkmaribor','nkolimpija','kzs_si','OKS_olympicteam','TeamSlovenia',
  // tech/ostalo
  'TelekomSlo','A1Slovenija','PetrolSlovenija','AMZS_si'
];

const SLO_QUERY_TERMS = [
  'Slovenija','Ljubljana','Maribor','slovenski','slovenska','č','š','ž','RTVSLO','ARSO','Olimpija','NK Maribor'
];
const GOOGLE_MAX_LINKS = 50;

/* ------------------ pomožne ------------------ */
function startOfUTCDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function yRangeUTC() {
  const today0 = startOfUTCDay(new Date());
  const y0 = new Date(today0);
  y0.setUTCDate(y0.getUTCDate() - 1);
  return {
    sinceISO: y0.toISOString().slice(0, 10),    // včeraj 00:00 UTC
    untilISO: today0.toISOString().slice(0, 10) // danes 00:00 UTC
  };
}
function inYesterdayUTC(dateISO) {
  const d = new Date(dateISO);
  const { sinceISO, untilISO } = yRangeUTC();
  return d >= new Date(sinceISO) && d < new Date(untilISO);
}
function proxy(u) {
  const url = new URL(u);
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}
async function getText(url) {
  const urls = [proxy(url), url];
  let last;
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: {
          'user-agent': 'Mozilla/5.0',
          'accept-language': 'sl-SI,sl;q=0.9,en;q=0.8'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      if (!txt || txt.length < 100) throw new Error('empty');
      return txt;
    } catch (e) { last = e; }
  }
  throw last || new Error('fetch_failed');
}
async function nitterAlive(base) {
  try {
    const html = await getText(`${base}/about`);
    return html.includes('Nitter') || html.length > 300;
  } catch { return false; }
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
const snippet = (t, n=180) => {
  const s = (t||'').replace(/\s+/g,' ').trim();
  return s.length<=n ? s : s.slice(0, n-1)+'…';
};
const num = (txt) => Number((txt || '').replace(/[^0-9]/g,'') || 0);

/* ------------------ PLAN A: Nitter search ------------------ */
async function collectFromNitterSearch(sinceISO, untilISO, aliveBases) {
  const qVariants = [
    `lang:sl src:tweet since:${sinceISO} until:${untilISO}`,
    `src:tweet since:${sinceISO} until:${untilISO}`,
    `since:${sinceISO} until:${untilISO}`
  ];
  let items = [];
  const tried = [];

  // RSS
  for (const base of aliveBases) {
    for (const q of qVariants) {
      const rss = `${base}/search/rss?f=tweets&q=${encodeURIComponent(q)}`;
      try {
        const txt = await getText(rss);
        const $ = cheerio.load(txt, { xmlMode: true });
        const nodes = $('item');
        tried.push({ step:'rss', base, q, count: nodes.length });
        nodes.each((_i, el) => {
          const link = $(el).find('link').text().trim();
          const title = $(el).find('title').text().trim();
          const id = (link.split('/status/')[1] || '').split(/[?#]/)[0];
          if (!id || !title) return;
          items.push({
            id,
            url: link.replace('https://nitter.net','https://x.com').replace('/i/web',''),
            text: title,
            likes: 0, retweets: 0,
            dateISO: new Date().toISOString()
          });
        });
      } catch (e) {
        tried.push({ step:'rss', base, q, error: String(e) });
      }
    }
  }

  // HTML engagement
  for (const base of aliveBases) {
    for (const q of qVariants) {
      const url = `${base}/search?f=tweets&q=${encodeURIComponent(q)}`;
      try {
        const txt = await getText(url);
        const $ = cheerio.load(txt);
        const rows = $('.timeline .timeline-item');
        tried.push({ step:'html', base, q, count: rows.length });
        rows.each((_i, el) => {
          const href = $(el).find('.tweet-date a').attr('href') || '';
          const id = (href.split('/status/')[1] || '').split(/[?/]/)[0];
          if (!id) return;
          const text = $(el).find('.tweet-content').text().trim();
          const likes = num($(el).find('.icon-heart + .tweet-stat').text());
          const retweets = num($(el).find('.icon-retweet + .tweet-stat').text());
          const dateAttr = $(el).find('.tweet-date a').attr('title') || '';
          const dateISO = dateAttr ? new Date(dateAttr).toISOString() : new Date().toISOString();
          const rec = { id, url: `https://x.com${href.replace('/i/web','')}`, text, likes, retweets, dateISO };
          const ix = items.findIndex(x => x.id === id);
          if (ix >= 0) items[ix] = rec; else items.push(rec);
        });
      } catch (e) {
        tried.push({ step:'html', base, q, error: String(e) });
      }
    }
  }

  return { items, tried };
}

/* ------------------ PLAN B: Google fallback ------------------ */
async function collectFromGoogle() {
  const queries = [
    `site:x.com/status (${SLO_QUERY_TERMS.slice(0,6).join(' OR ')})`,
    `site:x.com/status (${SLO_QUERY_TERMS.slice(6,12).join(' OR ')})`,
  ];
  const links = new Set();
  for (const q of queries) {
    const g = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=sl&tbs=qdr:d&num=50`;
    try {
      const html = await getText(g);
      const $ = cheerio.load(html);
      $('a').each((_i, a) => {
        const href = $(a).attr('href') || '';
        if (!href.startsWith('/url?q=')) return;
        const real = decodeURIComponent(href.slice(7).split('&')[0]);
        if (real.includes('x.com') && real.includes('/status/')) links.add(real.replace('/i/web',''));
      });
    } catch {}
  }

  const items = [];
  for (const link of Array.from(links).slice(0, GOOGLE_MAX_LINKS)) {
    try {
      const html = await getText(link);
      const $ = cheerio.load(html);
      const text =
        $("meta[property='og:description']").attr('content') ||
        $("meta[name='description']").attr('content') ||
        $('title').text() || '';
      const id = (link.split('/status/')[1] || '').split(/[?#]/)[0];
      if (!id || !text) continue;
      items.push({
        id,
        url: link,
        text: text.trim(),
        likes: 0, retweets: 0,
        dateISO: new Date().toISOString()
      });
    } catch {}
  }
  return items;
}

/* ------------------ PLAN C: user timelines ------------------ */
async function collectFromTimelines(aliveBases, sinceISO, untilISO) {
  const items = [];
  const since = new Date(sinceISO);
  const until = new Date(untilISO);

  for (const base of aliveBases) {
    for (const handle of SLO_ACCOUNTS) {
      const url = `${base}/${handle}`;
      try {
        const html = await getText(url);
        const $ = cheerio.load(html);
        const nodes = $('.timeline .timeline-item');
        nodes.each((_i, el) => {
          const href = $(el).find('.tweet-date a').attr('href') || '';
          const id = (href.split('/status/')[1] || '').split(/[?/]/)[0];
          if (!id) return;

          const dateAttr = $(el).find('.tweet-date a').attr('title') || '';
          const dateISO = dateAttr ? new Date(dateAttr).toISOString() : '';
          if (!dateISO) return;
          const d = new Date(dateISO);
          if (d < since || d >= until) return; // samo včeraj

          const text = $(el).find('.tweet-content').text().trim();
          const likes = num($(el).find('.icon-heart + .tweet-stat').text());
          const retweets = num($(el).find('.icon-retweet + .tweet-stat').text());
          items.push({
            id,
            url: `https://x.com${href.replace('/i/web','')}`,
            text,
            likes,
            retweets,
            dateISO
          });
        });
      } catch { /* ignoriraj napako za ta handle/base */ }
    }
  }

  return items;
}

/* ------------------ main ------------------ */
(async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log(JSON.stringify({ ok:false, reason:'missing_supabase_env' }));
    return;
  }
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { sinceISO, untilISO } = yRangeUTC();

  // preveri katere Nitter baze sploh živijo
  const alive = [];
  for (const b of NITTERS) if (await nitterAlive(b)) alive.push(b);

  // PLAN A: search
  let all = [];
  let tried = [];
  if (alive.length) {
    const res = await collectFromNitterSearch(sinceISO, untilISO, alive);
    all = res.items;
    tried = res.tried;
  }

  let note = 'nitter_search';
  if (!all.length) {
    // PLAN C: kurirane časovnice (pogosto deluje tudi, ko search ne)
    const tl = await collectFromTimelines(alive, sinceISO, untilISO);
    if (tl.length) {
      all = tl;
      note = 'timelines';
    }
  }

  if (!all.length) {
    // PLAN B: google fallback (brez metrik)
    const gg = await collectFromGoogle();
    if (gg.length) {
      all = gg;
      note = 'google_fallback';
    }
  }

  if (!all.length) {
    console.log(JSON.stringify({
      ok:false,
      reason:'no_items_all_plans',
      window:{ sinceISO, untilISO },
      nitter_alive: alive,
      tried
    }, null, 2));
    return;
  }

  // zapis v Supabase
  let saved = 0;
  for (const t of all) {
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

  console.log(JSON.stringify({
    ok:true,
    saved,
    total: all.length,
    note,
    window:{ sinceISO, untilISO },
    nitter_alive: alive
  }, null, 2));
})();
