import { getTopTweets } from '../../lib/getTopTweets';

export default async function handler(req: any, res: any) {
  try {
    const limit = Number(req.query.limit || 20);
    const data = await getTopTweets(limit);
    res.status(200).json({ ok: true, data });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || 'failed' });
  }
}
