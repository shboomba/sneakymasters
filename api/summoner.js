export default async function handler(req, res) {
  const { gameName, tagLine } = req.query;

  if (!gameName || !tagLine) {
    return res.status(400).json({ error: 'Missing gameName or tagLine' });
  }

  const RIOT_KEY = process.env.RIOT_API_KEY;
  if (!RIOT_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  res.setHeader('Cache-Control', 'no-store');

  try {
    // Step 1: Get PUUID from Riot ID
    const accountUrl = `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const accountRes = await fetch(accountUrl, {
      headers: { 'X-Riot-Token': RIOT_KEY }
    });

    console.log('Account API status:', accountRes.status, '| Key prefix:', RIOT_KEY.slice(0, 10));

    if (accountRes.status === 403) {
      return res.status(403).json({ error: 'API key invalid or expired — renew at developer.riotgames.com' });
    }
    if (accountRes.status === 404) {
      return res.status(404).json({ error: 'Riot account not found' });
    }
    if (accountRes.status === 429) {
      return res.status(429).json({ error: 'Rate limited — try again shortly' });
    }
    if (!accountRes.ok) {
      return res.status(accountRes.status).json({ error: 'Riot API error (account lookup)' });
    }

    const account = await accountRes.json();
    const { puuid } = account;

    // Step 2: Get summoner by PUUID
    const summonerUrl = `https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`;
    const summonerRes = await fetch(summonerUrl, {
      headers: { 'X-Riot-Token': RIOT_KEY }
    });

    console.log('Summoner API status:', summonerRes.status);

    if (summonerRes.status === 403) {
      return res.status(403).json({ error: 'API key invalid or expired — renew at developer.riotgames.com' });
    }
    if (summonerRes.status === 404) {
      return res.status(404).json({ error: 'Summoner has no NA account' });
    }
    if (summonerRes.status === 429) {
      return res.status(429).json({ error: 'Rate limited — try again shortly' });
    }
    if (!summonerRes.ok) {
      return res.status(summonerRes.status).json({ error: 'Riot API error (summoner lookup)' });
    }

    const summoner = await summonerRes.json();
    const summonerId = summoner.id;

    // Step 3: Get ranked entries
    const leagueUrl = `https://na1.api.riotgames.com/lol/league/v4/entries/by-summoner/${encodeURIComponent(summonerId)}`;
    const leagueRes = await fetch(leagueUrl, {
      headers: { 'X-Riot-Token': RIOT_KEY }
    });

    console.log('League API status:', leagueRes.status);

    if (leagueRes.status === 403) {
      return res.status(403).json({ error: 'API key invalid or expired — renew at developer.riotgames.com' });
    }
    if (leagueRes.status === 429) {
      return res.status(429).json({ error: 'Rate limited — try again shortly' });
    }
    if (!leagueRes.ok) {
      return res.status(leagueRes.status).json({ error: 'Riot API error (league lookup)' });
    }

    const entries = await leagueRes.json();
    const soloEntry = entries.find(e => e.queueType === 'RANKED_SOLO_5x5');

    if (!soloEntry) {
      return res.status(200).json({
        gameName,
        tagLine,
        puuid,
        summonerId,
        tier: 'UNRANKED',
        rank: null,
        leaguePoints: 0,
        wins: 0,
        losses: 0
      });
    }

    return res.status(200).json({
      gameName,
      tagLine,
      puuid,
      summonerId,
      tier: soloEntry.tier,
      rank: soloEntry.rank,
      leaguePoints: soloEntry.leaguePoints,
      wins: soloEntry.wins,
      losses: soloEntry.losses
    });

  } catch (err) {
    return res.status(503).json({ error: 'Network error — could not reach Riot API' });
  }
}
