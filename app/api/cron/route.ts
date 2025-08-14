export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  const r = await fetch(`${base}/api/fetch`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  return new Response(JSON.stringify({ ok: true, triggered: true, result: j }), {
    headers: { 'content-type': 'application/json' }
  });
}
