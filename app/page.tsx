import { supabase } from '../lib/supabase';

export const revalidate = 600; // 10 min cache

export default async function Page() {
  // prejšnji dan (00:00 → 23:59)
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yStart = new Date(d.toDateString()); // 00:00
  const yEnd = new Date(yStart);
  yEnd.setDate(yEnd.getDate() + 1); // naslednji dan 00:00

  const { data: tweets, error } = await supabase
    .from('tweets')
    .select('*')
    .gte('date', yStart.toISOString())
    .lt('date', yEnd.toISOString())
    .order('likes', { ascending: false })
    .order('retweets', { ascending: false })
    .limit(40);

  return (
    <main className="container">
      <div className="header">
        <h1 style={{fontWeight:700, fontSize:28}}>Top tviti včeraj 🇸🇮</h1>
        <small className="muted">cron + Supabase · brez X API</small>
      </div>

      {error && <div className="card">Napaka pri branju: {error.message}</div>}

      <div className="grid">
        {tweets?.map((t: any) => (
          <article className="card" key={t.id}>
            <p style={{whiteSpace:'pre-wrap'}}>{t.text}</p>
            <div className="badge">❤️ {t.likes} · 🔁 {t.retweets}</div>
            <a href={t.url} target="_blank" rel="noreferrer">Odpri tvit</a>
          </article>
        ))}
        {!tweets?.length && (
          <div className="card">Ni podatkov. Najprej zaženi <code>/api/fetch</code> ali počakaj na cron.</div>
        )}
      </div>
    </main>
  );
}
