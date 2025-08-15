'use client';

import { useState } from 'react';

const NITTERS = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.fdn.fr',
  'https://nitter.poast.org',
  'https://nitter.moomoo.me'
];

function proxy(u: string) {
  const url = new URL(u);
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}

export default function ImportClient() {
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setStatus('Iščem včerajšnje tvite prek brskalnika…');

    try {
      const now = new Date();
      const until = now.toISOString().slice(0, 10);
      now.setDate(now.getDate() - 1);
      const since = now.toISOString().slice(0, 10);
      const query = encodeURIComponent(`lang:sl since:${since} until:${until}`);
      const path = `/search?f=tweets&q=${query}`;

      let html = '';
      let used = '';

      // poskusi več instanc (vsako prek r.jina.ai proxyja)
      for (const base of NITTERS) {
        try {
          const res = await fetch(proxy(`${base}${path}`), { cache: 'no-store' });
          if (!res.ok) continue;
          const h = await res.text();
          if (h.includes('timeline') || h.includes('timeline-item')) {
            html = h; used = base; break;
          }
        } catch {}
      }

      if (!html) {
        setStatus('Ni uspelo pridobiti HTML-ja (proxy). Poskusi kasneje.');
        setBusy(false);
        return;
      }

      // parse z DOMParser (v brskalniku)
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nodes = Array.from(doc.querySelectorAll('.timeline .timeline-item')) as HTMLElement[];

      const items = nodes.map(el => {
        const link = el.querySelector('.tweet-date a') as HTMLAnchorElement | null;
        const href = link?.getAttribute('href') || '';
        const id = (href.split('/status/')[1] || '').split(/[?/]/)[0];
        const text = (el.querySelector('.tweet-content')?.textContent || '').trim();
        const num = (sel: string) => {
          const t = el.querySelector(sel)?.textContent?.trim().replace(/[^0-9]/g, '') || '0';
          return Number(t || 0);
        };
        const likes = num('.icon-heart + .tweet-stat');
        const retweets = num('.icon-retweet + .tweet-stat');
        const dateAttr = link?.getAttribute('title') || '';
        const dateISO = dateAttr ? new Date(dateAttr).toISOString() : new Date().toISOString();

        if (!id) return null;
        return {
          id,
          text,
          url: `https://x.com${href.replace('/i/web', '')}`,
          likes,
          retweets,
          dateISO
        };
      }).filter(Boolean);

      // pošlji na server za zapis v Supabase
      const res2 = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items, note: `via-browser ${used}` })
      });
      const j = await res2.json();
      if (!j.ok) {
        setStatus(`Zapis v bazo ni uspel: ${j.error || 'unknown'}`);
      } else {
        setStatus(`Uspelo. Shranjenih: ${j.saved}. Osveži stran.`);
      }
    } catch (e: any) {
      setStatus(`Napaka: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{marginTop:16}}>
      <button
        onClick={run}
        disabled={busy}
        style={{padding:'10px 14px', borderRadius:10, border:'1px solid #2a2f3a', background:'#111827', color:'#fff', cursor:'pointer'}}
      >
        {busy ? 'Uvažam…' : 'Napolni včerajšnje tvite (fallback)'}
      </button>
      {status && <div style={{marginTop:8, color:'#9ca3af'}}>{status}</div>}
    </div>
  );
}
