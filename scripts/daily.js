// Daily leaderboard summary — runs at 11:59 PM PST via GitHub Actions
// Posts a full standings embed with LP gains and best kill game

const WEBHOOK  = process.env.DISCORD_WEBHOOK_URL;
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const API      = process.env.VERCEL_API_URL;
const RIOT_KEY = process.env.RIOT_API_KEY;

const TIER_BASE = { IRON:0,BRONZE:400,SILVER:800,GOLD:1200,PLATINUM:1600,EMERALD:2000,DIAMOND:2400,MASTER:2800,GRANDMASTER:2800,CHALLENGER:2800 };
const DIV_BASE  = { IV:0,III:100,II:200,I:300 };
const MASTERS_T = new Set(['MASTER','GRANDMASTER','CHALLENGER']);

function computeLP(tier, rank, lp) {
  if (!tier || tier === 'UNRANKED') return 0;
  if (MASTERS_T.has(tier)) return 2800 + (lp || 0);
  return (TIER_BASE[tier] || 0) + (DIV_BASE[rank] || 0) + (lp || 0);
}

function pKey(gameName, tagLine) {
  return `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

async function fetchPlayers() {
  const r = await fetch(`${API}/api/players`);
  return (await r.json()).players || [];
}

async function fetchRank(gameName, tagLine) {
  try {
    const r = await fetch(`${API}/api/summoner?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function fetchLPHistory() {
  try {
    const r = await fetch(`${API}/api/lp-history`);
    return (await r.json()).history || {};
  } catch { return {}; }
}

async function fetchTodayStats(puuid) {
  const empty = { bestKills: 0, games: 0 };
  if (!puuid || !RIOT_KEY) return empty;
  try {
    const midnight = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const idsRes = await fetch(
      `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&start=0&count=20&startTime=${midnight}`,
      { headers: { 'X-Riot-Token': RIOT_KEY } }
    );
    if (!idsRes.ok) return empty;
    const ids = await idsRes.json();
    if (!ids.length) return empty;

    let bestKills = 0;
    for (const id of ids) {
      const mr = await fetch(
        `https://americas.api.riotgames.com/lol/match/v5/matches/${id}`,
        { headers: { 'X-Riot-Token': RIOT_KEY } }
      );
      if (!mr.ok) continue;
      const m = await mr.json();
      const p = m?.info?.participants?.find(p => p.puuid === puuid);
      if (p && p.kills > bestKills) bestKills = p.kills;
    }
    return { bestKills, games: ids.length };
  } catch { return empty; }
}

async function main() {
  const players = await fetchPlayers();
  if (!players.length) return;

  const history = await fetchLPHistory();
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  const stats = [];
  for (const { gameName, tagLine } of players) {
    const rank = await fetchRank(gameName, tagLine);
    if (!rank) continue;

    const key = pKey(gameName, tagLine);
    const hist = history[key] || [];
    const midnightMs = new Date().setHours(0, 0, 0, 0);
    const todayStart = [...hist].reverse().find(e => e.ts < midnightMs);
    const lpNow = rank.totalLP || computeLP(rank.tier, rank.rank, rank.leaguePoints);
    const lpDelta = todayStart ? lpNow - todayStart.lp : null;
    const matchStats = await fetchTodayStats(rank.puuid);

    stats.push({ gameName, rank, lpNow, lpDelta, ...matchStats });
  }

  stats.sort((a, b) => b.lpNow - a.lpNow);

  const lines = stats.map((s, i) => {
    const rankStr = MASTERS_T.has(s.rank.tier)
      ? `${s.rank.tier} ${s.rank.leaguePoints} LP`
      : `${s.rank.tier} ${s.rank.rank} — ${s.rank.leaguePoints} LP`;
    const delta = s.lpDelta !== null
      ? (s.lpDelta >= 0 ? `+${s.lpDelta}` : `${s.lpDelta}`)
      : '—';
    return `**#${i + 1} ${s.gameName}** — ${rankStr}  *(${delta} LP today)*`;
  });

  const withDelta  = stats.filter(s => s.lpDelta !== null);
  const mostGain   = withDelta.length ? withDelta.reduce((a, b) => b.lpDelta > a.lpDelta ? b : a) : null;
  const leastGain  = withDelta.length ? withDelta.reduce((a, b) => b.lpDelta < a.lpDelta ? b : a) : null;
  const withGames  = stats.filter(s => s.games > 0);
  const mostKills  = withGames.length ? withGames.reduce((a, b) => b.bestKills > a.bestKills ? b : a) : null;

  const highlights = [
    mostGain  ? `🏆 **Most LP gained:** ${mostGain.gameName}  +${mostGain.lpDelta} LP` : null,
    leastGain && leastGain.gameName !== mostGain?.gameName
      ? `📉 **Least LP gained:** ${leastGain.gameName}  ${leastGain.lpDelta} LP` : null,
    mostKills && mostKills.bestKills > 0
      ? `⚔️ **Best game (kills):** ${mostKills.gameName}  ${mostKills.bestKills} kills` : null,
  ].filter(Boolean);

  const description = lines.join('\n') + (highlights.length ? '\n\u200B\n' + highlights.join('\n') : '');

  await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `📊 Daily Leaderboard Update — ${today}`,
        color: 0xc89b3c,
        description,
        timestamp: new Date().toISOString()
      }]
    })
  });

  console.log('Daily update posted.');
}

main().catch(err => { console.error(err); process.exit(1); });
