import { createClient } from '@supabase/supabase-js';

/**
 * CILJ: včerajšnji (UTC) tviti v slovenščini + engagement (public_metrics),
 *       sortirano po našem "score" in zapisano v Supabase.
 *
 * Zahteva: X_BEARER_TOKEN v env (GitHub secret), ki omogoča recent search.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log(JSON.stringify({ ok: false, error: 'missing_supabase_env' }));
  process.exit(0);
}
if (!X_BEARER_TOKEN) {
  console.log(JSON.stringify({ ok: false, error: 'missing_x_bearer_token' }));
  process.exit(0);
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function startOfUTCDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function yRangeUTC() {
  const today0 = startOfUTCDay(new Date());
  const y0 = new Date(today0);
  y0.setUTCDate(y0.getUTCDate() - 1);
  return {
    start_time: y0.toISOString(),     // včeraj 00:00Z
    end_time: today0.toISOString()    // danes 00:00Z
  };
}

// url helper – poskusi api.x.com, nato api.twitter.com (oba trenutno obstajata)
async function xApi(path, params) {
  const qs = new URLSearchParams(params).toString();
  const urls = [
    `https://api.x.com/2/${path}?${qs}`,
    `https://api.twitter.com/2/${path}?${qs}`,
  ];
  let lastErr;
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }
      });
      if (res.status === 429) throw new Error('rate_limited_429');
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('x_api_failed');
}

// kategorije (preprosta heuristika)
function categorize(t) {
  const s=(t||'').toLowerCase(), has=(...w)=>w.some(x=>s.includes(x));
  if (has('vlada','minister','parlament','referendum','volitve','poslanec','premier','golob','janša')) return 'Politika';
  if (has('olimpija','maribor','nzs','nogomet','košarka','kolesar','tour','tekma','gol','liga')) return 'Šport';
  if (has('delnica','borza','inflacija','banka','evro','gospodarstvo','proračun','davki','startup')) return 'Gospodarstvo';
  if (has('iphone','android','ai','umetna inteligenca','openai','google','apple','aplikacija','tehnologija')) return 'Tehnologija';
  if (has('neurje','vreme','poplava','sneg','vihar','nevihta','arso')) return 'Vreme';
  if (has('glasba','film','serija','koncert','festival','zabava')) return 'Zabava';
  return 'Družba';
}
const snippet = (t, n=180)=>{const s=(t||'').replace(/\s+/g,' ').trim();return s.length<=n?s:s.slice(0,n-1)+'…';};

// score = like + 2*retweet + 2*reply (+1*quote)
function scoreOf(pm) {
  const l = pm?.like_count || 0;
  const r = pm?.retweet_count || 0;
  const q = pm?.quote_count || 0;
  const rp = pm?.reply_count || 0;
  return l + 2*r + 2*rp + q;
}

(async () => {
  const { start_time, end_time } = yRangeUTC();

  // približek SLO: lang:sl + nekaj ključnih besed za SI kontekst (ker geo večinoma manjka)
  const slTerms = [
    'Slovenija','Ljubljana','Maribor','Celje','Koper','Kranj','Nova Gorica','Ptuj',
    'Gorenjska','Primorska','Štajerska','Dolenjska','Prekmurje','slovenski','slovenska','slovenskem'
  ];
  const context = '(' + slTerms.map(t => `"${t}"`).join(' OR ') + ')';

  const query = `lang:sl -is:retweet ${context}`;
  // lahko bi dodal še `-is:quote` ali `-has:links` po želji

  const params = {
    query,
    'tweet.fields': 'public_metrics,created_at,lang,geo',
    'user.fields': 'username,name',
    expansions: 'author_id',
    max_results: '100',
    start_time,
    end_time
  };

  let all = [];
  let next_token = undefined;
  for (let page = 0; page < 5; page++) { // do ~500 tvitov max
    const data = await xApi('tweets/search/recent', { ...params, ...(next_token ? { next_token } : {}) });
    const tweets = data?.data || [];
    const users = (data?.includes?.users || []).reduce((m,u)=> (m[u.id]=u, m), {});
    for (const t of tweets) {
      const u = users[t.author_id];
      const url = u ? `https://x.com/${u.username}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`;
      all.push({
        id: Number(t.id),
        text: t.text,
        url,
        likes: t.public_metrics?.like_count || 0,
        retweets: (t.public_metrics?.retweet_count || 0) + (t.public_metrics?.quote_count || 0),
        replies: t.public_metrics?.reply_count || 0,
        dateISO: t.created_at,
        score: scoreOf(t.public_metrics),
      });
    }
    next_token = data?.meta?.next_token;
    if (!next_token) break;
  }

  if (!all.length) {
    console.log(JSON.stringify({
      ok:false,
      reason:'no_results_from_x_api',
      query, window:{ start_time, end_time }
    }, null, 2));
    return;
  }

  // shranimo TOP (npr. 200) po score
  all.sort((a,b)=> b.score - a.score);
  const top = all.slice(0, 200);

  let saved = 0;
  for (const t of top) {
    const { error } = await db.from('tweets').upsert({
      id: t.id,
      text: t.text,
      url: t.url,
      likes: t.likes,
      retweets: t.retweets, // replies ne shranjujemo posebej, je vključen v score
      date: t.dateISO,
      category: categorize(t.text),
      snippet: snippet(t.text),
      score: t.score
    });
    if (!error) saved++;
  }

  console.log(JSON.stringify({
    ok: true,
    saved,
    total_fetched: all.length,
    stored: top.length,
    window: { start_time, end_time },
    sample: top.slice(0, 3).map(x => ({ id: x.id, score: x.score }))
  }, null, 2));
})();
