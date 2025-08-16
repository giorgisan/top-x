// scripts/fetch_x_and_import.mjs
import fetch from "cross-fetch";
import { createClient } from "@supabase/supabase-js";

// ---- CONFIG ----
// Računi (brez @). Svobodno dodajaj/odvzemi.
const ACCOUNTS = [
  "STA_novice","RTV_Slovenija","24ur_com","vecer","Delo","Dnevnik_si",
  "SiolNEWS","FinanceSI","vladaRS","DrzavniZbor","Arso_Vreme",
  "nzs_si","nkmaribor","nkolimpija","OKS_olympicteam","TeamSlovenia"
];

// Dodatne proste poizvedbe (jezik, kraji …) – po želji razširi/skrči.
const QUERIES = [
  `lang:sl`,
  `lang:sl (Slovenija OR Ljubljana OR Maribor OR Celje OR Koper OR Kranj OR Gorenjska OR Primorska OR Štajerska OR Dolenjska OR Prekmurje OR slovenski OR slovenska OR slovenskem)`
];

// Koliko maksimalno na klic (X API limit je 10–100).
const MAX_RESULTS = 100;

// ---- TIME WINDOW: včeraj v UTC ----
const now = new Date();
const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); // danes 00:00 UTC
const start = new Date(end); start.setUTCDate(start.getUTCDate() - 1); // včeraj 00:00 UTC
const startISO = start.toISOString();
const endISO   = end.toISOString();

// ---- ENV & klienti ----
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!X_BEARER_TOKEN) throw new Error("Manjka X_BEARER_TOKEN v secrets.");
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Manjka SUPABASE_URL ali SUPABASE_ANON_KEY.");

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- pomožne ----
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function buildUrl(query, nextToken) {
  const u = new URL("https://api.twitter.com/2/tweets/search/recent");
  u.searchParams.set("query", query);
  u.searchParams.set("max_results", String(MAX_RESULTS));
  u.searchParams.set("start_time", startISO);
  u.searchParams.set("end_time", endISO);
  u.searchParams.set("tweet.fields", "created_at,lang,public_metrics");
  u.searchParams.set("expansions", "author_id");
  u.searchParams.set("user.fields", "username,name,verified");
  if (nextToken) u.searchParams.set("next_token", nextToken);
  return u.toString();
}

async function searchAll(query) {
  let nextToken = undefined;
  const out = [];
  for (let page = 0; page < 50; page++) { // varovalo
    const url = buildUrl(query, nextToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }});
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`X API error ${r.status}: ${body}`);
    }
    const data = await r.json();
    const users = new Map((data.includes?.users || []).map(u => [u.id, u]));
    for (const t of (data.data || [])) {
      const user = users.get(t.author_id);
      out.push({ tweet: t, user });
    }
    nextToken = data.meta?.next_token;
    if (!nextToken) break;
    await sleep(350); // malo znižamo hitrost
  }
  return out;
}

function toDbRow({ tweet, user }) {
  const likes = tweet.public_metrics?.like_count ?? 0;
  const retweets = tweet.public_metrics?.retweet_count ?? 0;
  const score = likes * 2 + retweets;
  const username = user?.username || "unknown";
  return {
    text: tweet.text,
    url: `https://x.com/${username}/status/${tweet.id}`,
    likes,
    retweets,
    date: tweet.created_at,
    score,
    category: user ? user.username : null,
    snippet: tweet.text.length > 200 ? tweet.text.slice(0, 200) + "…" : tweet.text
  };
}

async function upsertRows(rows) {
  if (rows.length === 0) return 0;
  // Če imaš v bazi unikaten constraint na url, lahko uporabiš .upsert({ onConflict: 'url' })
  const { data, error } = await supabase
    .from("tweets")
    .upsert(rows, { onConflict: "url" });
  if (error) throw error;
  return data?.length ?? rows.length;
}

(async () => {
  console.log(`Fetching window: ${startISO} -> ${endISO}`);

  // 1) iz računov
  const accountQueries = ACCOUNTS.map(u => `from:${u} -is:retweet -is:quote`);
  // 2) proste poizvedbe
  const freeQueries = QUERIES.map(q => `${q} -is:retweet -is:quote`);

  const allQueries = [...accountQueries, ...freeQueries];

  let collected = [];
  for (const q of allQueries) {
    console.log("Query:", q);
    try {
      const items = await searchAll(q);
      collected.push(...items);
      console.log(`  +${items.length} tweets`);
    } catch (e) {
      console.error("  FAILED:", e.message);
    }
    await sleep(300); // mehko
  }

  // odstrani dvojnike po tweet.id
  const seen = new Set();
  const unique = [];
  for (const it of collected) {
    if (seen.has(it.tweet.id)) continue;
    seen.add(it.tweet.id);
    unique.push(it);
  }

  console.log(`Total unique: ${unique.length}`);

  const rows = unique.map(toDbRow);
  const inserted = await upsertRows(rows);
  console.log(`Upserted: ${inserted}`);
})();
