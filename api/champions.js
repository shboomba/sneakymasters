async function riotFetch(url, key) {
  let r = await fetch(url, { headers: { 'X-Riot-Token': key } });
  if (r.status === 429) {
    const wait = parseInt(r.headers.get('Retry-After') || '3', 10);
    await new Promise(res => setTimeout(res, wait * 1000));
    r = await fetch(url, { headers: { 'X-Riot-Token': key } });
  }
  return r;
}

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
    // Fetch last 5 ranked solo matches (reduced from 20 to stay under personal key rate limits)
    const matchListUrl = `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&count=5`;
    const matchListRes = await riotFetch(matchListUrl, RIOT_KEY);

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

    const champCounts = {};
    const roleCounts = {};
    let streakType = null, streakCount = 0, streakDone = false;

    for (const matchId of matchIds) {
      try {
        const matchRes = await riotFetch(
          `https://americas.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
          RIOT_KEY
        );
        if (!matchRes.ok) continue;

        const match = await matchRes.json();
        const participant = match?.info?.participants?.find(p => p.puuid === puuid);
        if (!participant) continue;

        if (participant.championName) {
          champCounts[participant.championName] = (champCounts[participant.championName] || 0) + 1;
        }

        if (participant.teamPosition) {
          roleCounts[participant.teamPosition] = (roleCounts[participant.teamPosition] || 0) + 1;
        }

        if (!streakDone) {
          const won = participant.win;
          if (streakType === null) {
            streakType = won ? 'win' : 'loss';
            streakCount = 1;
          } else if ((won && streakType === 'win') || (!won && streakType === 'loss')) {
            streakCount++;
          } else {
            streakDone = true;
          }
        }
      } catch {
        continue;
      }
    }

    const top3 = Object.entries(champCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    const sortedRoles = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
    let roles = [];
    if (sortedRoles.length > 0) {
      roles.push(sortedRoles[0][0]);
      if (sortedRoles.length > 1 && sortedRoles[1][1] >= sortedRoles[0][1] * 0.8) {
        roles.push(sortedRoles[1][0]);
      }
    }

    const streak = streakType ? { type: streakType, count: streakCount } : null;

    return res.status(200).json({ champions: top3, streak, roles });

  } catch {
    return res.status(200).json({ champions: [] });
  }
}
