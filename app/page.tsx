import { createClient } from '../lib/supabase';

export const revalidate = 60; // ISR: 1 min

export default async function Home() {
  const supabase = createClient();

  // Vlečemo samo včerajšnje (če že obstajajo)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const y0 = new Date(yesterday.toDateString()); // reset time

  const { data: tweets, error } = await supabase
    .from('tweets')
    .select('*')
    .gte('date', y0.toISOString())
    .order('likes', { ascending: false })
    .limit(20);

  return (
    <main className="container">
      <h1 style={{fontWeight:700, fontSize:28, marginBottom:8}}>Top tviti preteklega dne 🇸🇮</h1>
      <p style={{color:'#9ca3af', marginBottom:24}}>Prototip (brez X API). Podatki se pridobijo dnevno prek Nitter iskanja za <code>lang:sl</code>.</p>

      {error && <div className="card">Napaka pri branju: {error.message}</div>}

      <div className="grid">
        {tweets?.map((t: any) => (
          <article key={t.id} className="card">
            <p style={{whiteSpace:'pre-wrap'}}>{t.text}</p>
            <div className="badge">❤️ {t.likes} · 🔁 {t.retweets}</div>
            <a href={t.url} target="_blank" rel="noreferrer">Odpri na X</a>
          </article>
        ))}

        {!tweets?.length && (
          <div className="card">Ni podatkov za včeraj. Zaženi cron ali pokliči <code>/api/fetchTweets</code>.</div>
        )}
      </div>
    </main>
  );
}
