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
  // r.jina.ai vrne vsebino dane URL (brez CORS omejitev)
  const url = new URL(u);
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}

type Item = {
  id: string;
  text: string;
  url: string;
  likes: number;
  retweets: number;
  dateISO: string;
};

export default function ImportClient() {
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setStatus('Iščem včerajšnje tvite prek RSS/HTML…');

    try {
      const now = new Date();
      const until = now.toISOString().slice(0, 10);
      now.setDate(now.getDate() - 1);
      const since = now.toISOString().slice(0, 10);
      const q = `lang:sl since:${since} until:${until}`;
      const query = encodeURIComponent(q);
      const path = `/search?f=tweets&q=${query}`;
      const rssPath = `/search/rss?f=tweets&q=${query}`;

      let items: Item[] = [];

      // ---------- 1) POSKUS: RSS prek več Nitter instanc ----------
      for (const base of NITTERS) {
        try {
          const rssUrl = proxy(`${base}${rssPath}`);
          const res = await fetch(rssUrl, { cache: 'no-store' });
          if (!res.ok) continue;
          const xml = await res.text();
          if (!xml || xml.length < 100) continue;

          const dom = new DOMParser().parseFromString(xml, 'text/xml');
          const nodes = Array.from(dom.querySelectorAll('item'));

          if (nodes.length) {
            items = nodes.map((it) => {
              const title = (it.querySelector('title')?.textContent || '').trim();
              const link = (it.querySelector('link')?.textContent || '').trim();
              // link je običajno npr. https://nitter.net/<user>/status/12345#m
              const id = (link.split('/status/')[1] || '').split(/[?#]/)[0];

              return {
                id,
                text: title,
                url: link ? link.replace('https://nitter.net', 'https://x.com').replace('/i/web', '') : '',
                likes: 0,       // RSS ne nosi engagementa
                retweets: 0,    // RSS ne nosi engagementa
                dateISO: new Date().toISOString()
              };
            }).filter(v => v.id && v.text) as Item[];

            if (items.length) break; // uspešno – ne poskušaj dalje
          }
        } catch {
          // poskusi naslednjo instanco
        }
      }

      // ---------- 2) REZERVA: HTML prek proxyja (če RSS ni dal nič) ----------
      if (!items.length) {
        for (const base of NITTERS) {
          try {
            const res = await fetch(proxy(`${base}${path}`), { cache: 'no-store' });
            if (!res.ok) continue;
            const html = await res.text();
            if (!html || (!html.includes('timeline') && !html.includes('timeline-item'))) continue;

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const nodes = Array.from(doc.querySelectorAll('.timeline .timeline-item')) as HTMLElement[];

            items = nodes.map(el => {
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
            }).filter(Boolean) as Item[];

            if (items.length) break;
          } catch {
            // poskusi naslednjo instanco
          }
        }
      }

      if (!items.length) {
        setStatus('Ni uspelo pridobiti HTML-ja/RSS-ja (proxy). Poskusi kasneje.');
        setBusy(false);
        return;
      }

      // ---------- 3) Zapis v Supabase prek API ----------
      const res2 = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items, note: 'via-browser' })
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
    <div className="card" style={{ marginTop: 16 }}>
      <button
        onClick={run}
        disabled={busy}
        style={{ padding:'10px 14px', borderRadius:10, border:'1px solid #2a2f3a', background:'#111827', color:'#fff', cursor:'pointer' }}
      >
        {busy ? 'Uvažam…' : 'Napolni včerajšnje tvite (fallback)'}
      </button>
      {status && <div style={{ marginTop: 8, color:'#9ca3af' }}>{status}</div>}
    </div>
  );
}
