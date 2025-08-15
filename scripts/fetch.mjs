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

// kurirana SLO lista (po potrebi dodaj/uredi)
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

const MAX_PER_ACCOUNT = 20; // varovalka
const REQUEST_TIMEOUT_MS = 15000;

/* ------------------ pomožne ------------------ */
function startOfUTCDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function yRangeUTC() {
  const today0 = startOfUTCDay(new Date());
  const y0 = new Date(today0);
  y0.setUTCDate(y0.getUTCDate() - 1);
  return {
    sinceISO: y0.toISOString(),       // včeraj 00:00:00Z
    untilISO: today0.toISOString()    // danes 00:00:00Z
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
function withTimeout(promise, ms, label='timeout') {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms)),
  ]);
}
async function getText(url) {
  // najprej preko proxyja (bolj stabilno), nato direkt
  const urls = [proxy(url), url];
  let last;
  for (const u of urls) {
    try {
      const res = await withTimeout(fetch(u, {
        headers: {
          'user-agent': 'Mozilla/5.0',
          'accept-language': 'sl-SI,sl;q=0.9,en;q=0.8'
        },
        cache: 'no-store',
      }), REQUEST_TIMEOUT_MS);
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
const onlyDigits = (x='') => Number((x||'').replace(/[^0-9]/g,'') || 0);

/* ------------------ PLAN: user RSS + (posamezni tweet HTML) ------------------ */
async function collectFromUserRSS(aliveBases, sinceISO, untilISO) {
  const items = [];
  const tried = [];

  for (const base of aliveBases) {
    for (const handle of SLO_ACCOUNTS) {
      const rssUrl = `${base}/${handle}/rss`;
      try {
        const xml = await getText(rssUrl);
        const $ = cheerio.load(xml, { xmlMode: true });

        const nodes = $('item').slice(0, MAX_PER_ACCOUNT);
        tried.push({ step:'rss', base, handle, count: nodes.length });

        nodes.each((_i, el) => {
          const $el = $(el);
          const link = $el.find('link').text().trim();     // npr. https://nitter.net/user/status/123...
          const title = $el.find('title').text().trim();
          const pubDate = $el.find('pubDate').text().trim();
          const id = (link.split('/status/')[1] || '').split(/[?#]/)[0];
          if (!id || !title || !pubDate) return;

          const dateISO = new Date(pubDate).toISOString();
          if (!inYesterdayUTC(dateISO)) return; // vzemi samo včeraj

          items.push({
            id,
            url: link.replace('https://nitter.net','https://x.com').replace('/i/web',''),
            text: title,
            likes: 0,
            retweets: 0,
            dateISO
          });
        });
      } catch (e) {
        tried.push({ step:'rss', base, handle, error: String(e) });
      }
    }
  }

  // poskusi za vsak tvit dobiti engagement z odpiranjem Nitter tweet strani
  // (če pade, pustimo 0 – bolje nekaj kot nič)
  for (const base of aliveBases) {
    for (let i = 0; i < items.length; i++) {
      const nLink = `${base}/i/web/status/${items[i].id}`;
      try {
        const html = await getText(nLink);
        const $ = cheerio.load(html);
        const likes = onlyDigits($('.icon-heart + .tweet-stat').first().text());
        const retweets = onlyDigits($('.icon-retweet + .tweet-stat').first().text());
        if (!isNaN(likes)) items[i].likes = likes;
        if (!isNaN(retweets)) items[i].retweets = retweets;
      } catch { /* ignore */ }
    }
  }

  return { items, tried };
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

  // preveri katere Nitter baze živijo
  const alive = [];
  for (const b of NITTERS) if (await nitterAlive(b)) alive.push(b);

  if (!alive.length) {
    console.log(JSON.stringify({ ok:false, reason:'no_alive_nitter_instances' }, null, 2));
    return;
  }

  // Plan: samo user RSS (bolj stabilno kot search) + posamičen tweet HTML za metrike
  const { items, tried } = await collectFromUserRSS(alive, sinceISO, untilISO);

  if (!items.length) {
    console.log(JSON.stringify({
      ok:false,
      reason:'no_items_user_rss',
      window:{ sinceISO, untilISO },
      nitter_alive: alive,
      tried
    }, null, 2));
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

  console.log(JSON.stringify({
    ok:true,
    saved,
    total: items.length,
    window:{ sinceISO, untilISO },
    nitter_alive: alive
  }, null, 2));
})();
