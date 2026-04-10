// GET  → returns all notes { notes: { [playerKey]: string } }
// POST { key, note } → saves/deletes a note

const KV_URL    = process.env.KV_REST_API_URL;
const KV_TOKEN  = process.env.KV_REST_API_TOKEN;
const NOTES_KEY = 'rtm_notes';

async function kvGet() {
  const r = await fetch(`${KV_URL}/get/${NOTES_KEY}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  if (!r.ok) return {};
  let d;
  try { d = await r.json(); } catch { return {}; }
  if (!d.result) return {};
  try { return JSON.parse(d.result); } catch { return {}; }
}

async function kvSet(value) {
  await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', NOTES_KEY, JSON.stringify(value)])
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    const notes = await kvGet();
    return res.status(200).json({ notes });
  }

  if (req.method === 'POST') {
    const { key, note } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    const notes = await kvGet();
    if (note) {
      notes[key] = note;
    } else {
      delete notes[key];
    }
    await kvSet(notes);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
