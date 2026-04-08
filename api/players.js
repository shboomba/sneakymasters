const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'rtm_players';

async function kvGet() {
  if (!KV_URL || !KV_TOKEN) return [];
  const res = await fetch(`${KV_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : [];
}

async function kvSet(players) {
  await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', KEY, JSON.stringify(players)])
  });
}

function pKey(gameName, tagLine) {
  return `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: 'KV not configured', players: [] });
  }

  try {
    if (req.method === 'GET') {
      const players = await kvGet();
      return res.status(200).json({ players });
    }

    if (req.method === 'POST') {
      const { gameName, tagLine } = req.body || {};
      if (!gameName || !tagLine) return res.status(400).json({ error: 'Missing gameName or tagLine' });

      const players = await kvGet();
      const exists = players.some(p => pKey(p.gameName, p.tagLine) === pKey(gameName, tagLine));
      if (exists) return res.status(409).json({ error: 'Player already added' });

      players.push({ gameName, tagLine });
      await kvSet(players);
      return res.status(200).json({ players });
    }

    if (req.method === 'DELETE') {
      const { gameName, tagLine } = req.body || {};
      if (!gameName || !tagLine) return res.status(400).json({ error: 'Missing gameName or tagLine' });

      const players = await kvGet();
      const updated = players.filter(p => pKey(p.gameName, p.tagLine) !== pKey(gameName, tagLine));
      await kvSet(updated);
      return res.status(200).json({ players: updated });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Players API error:', err);
    return res.status(503).json({ error: 'Storage error', players: [] });
  }
}
