const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'rtm_lp_history';
const MAX_PER_PLAYER = 200;

async function kvGet() {
  const res = await fetch(`${KV_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  if (!res.ok) return {};
  let data;
  try { data = await res.json(); } catch { return {}; }
  if (!data.result) return {};
  try { return JSON.parse(data.result); } catch { return {}; }
}

async function kvSet(history) {
  await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', KEY, JSON.stringify(history)])
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured', history: {} });
  }

  try {
    if (req.method === 'GET') {
      const history = await kvGet();
      return res.status(200).json({ history });
    }

    if (req.method === 'POST') {
      const { key, snapshot } = req.body || {};
      if (!key || !snapshot) return res.status(400).json({ error: 'Missing key or snapshot' });

      const history = await kvGet();
      if (!history[key]) history[key] = [];
      history[key].push(snapshot);
      if (history[key].length > MAX_PER_PLAYER) {
        history[key] = history[key].slice(-MAX_PER_PLAYER);
      }
      await kvSet(history);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('LP history API error:', err);
    return res.status(503).json({ error: 'Storage error', history: {} });
  }
}
