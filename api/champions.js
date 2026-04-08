export default async function handler(req, res) {
  const { puuid } = req.query;

  if (!puuid) {
    return res.status(400).json({ champions: [] });
  }

  const RIOT_KEY = process.env.RIOT_API_KEY;
  if (!RIOT_KEY) {
    return res.status(200).json({ champions: [] });
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    // Fetch last 20 ranked solo match IDs
    const matchListUrl = `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&count=20`;
    const matchListRes = await fetch(matchListUrl, {
      headers: { 'X-Riot-Token': RIOT_KEY }
    });

    // 403 = match-v5 not approved on this key — degrade silently
    if (matchListRes.status === 403) {
      return res.status(200).json({ champions: [] });
    }
    if (!matchListRes.ok) {
      return res.status(200).json({ champions: [] });
    }

    const matchIds = await matchListRes.json();
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return res.status(200).json({ champions: [] });
    }

    // Fetch each match and count champion plays
    const champCounts = {};

    for (const matchId of matchIds) {
      try {
        const matchRes = await fetch(
          `https://americas.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
          { headers: { 'X-Riot-Token': RIOT_KEY } }
        );
        if (!matchRes.ok) continue;

        const match = await matchRes.json();
        const participant = match?.info?.participants?.find(p => p.puuid === puuid);
        if (!participant?.championName) continue;

        champCounts[participant.championName] = (champCounts[participant.championName] || 0) + 1;
      } catch {
        continue;
      }
    }

    const top3 = Object.entries(champCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    return res.status(200).json({ champions: top3 });

  } catch {
    return res.status(200).json({ champions: [] });
  }
}
