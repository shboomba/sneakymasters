// Returns public Gamba data: points leaderboard + bet history
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const POINTS_KEY      = 'rtm_gamba_points';
const BETS_KEY        = 'rtm_gamba_bets';
const USERNAMES_KEY   = 'rtm_gamba_usernames';
const CONNECTIONS_KEY = 'rtm_gamba_connections';
const STARTING_PTS    = 20000;

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  if (!r.ok) return null;
  let d;
  try { d = await r.json(); } catch { return null; }
  if (!d.result) return null;
  try { return JSON.parse(d.result); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const [rawPoints, rawBets, rawUsernames, rawConnections] = await Promise.all([
    kvGet(POINTS_KEY),
    kvGet(BETS_KEY),
    kvGet(USERNAMES_KEY),
    kvGet(CONNECTIONS_KEY)
  ]);

  const points      = rawPoints      || {};
  const bets        = rawBets        || {};
  const usernames   = rawUsernames   || {};
  const connections = rawConnections || {};

  // Build points leaderboard — include anyone who connected OR has points
  const allUserIds = new Set([...Object.keys(points), ...Object.keys(connections)]);
  const pointsList = Array.from(allUserIds)
    .map(userId => ({
      userId,
      name: usernames[userId] || userId,
      pts: points[userId] ?? STARTING_PTS,
      summoner: connections[userId] || null
    }))
    .sort((a, b) => b.pts - a.pts);

  // All bets sorted newest first
  const betList = Object.values(bets)
    .sort((a, b) => b.createdAt - a.createdAt);

  res.status(200).json({ points: pointsList, bets: betList, startingPts: STARTING_PTS });
}
