// Leaderboard change monitor — runs every 5 min via GitHub Actions
// Posts to Discord webhook when rank or position changes

const WEBHOOK   = process.env.DISCORD_WEBHOOK_URL;
const KV_URL    = process.env.KV_REST_API_URL;
const KV_TOKEN  = process.env.KV_REST_API_TOKEN;
const API       = process.env.VERCEL_API_URL;
const STATE_KEY = 'rtm_bot_state';

const TIER_BASE = { IRON:0,BRONZE:400,SILVER:800,GOLD:1200,PLATINUM:1600,EMERALD:2000,DIAMOND:2400,MASTER:2800,GRANDMASTER:2800,CHALLENGER:2800 };
const DIV_BASE  = { IV:0,III:100,II:200,I:300 };
const MASTERS_T = new Set(['MASTER','GRANDMASTER','CHALLENGER']);

function computeLP(tier, rank, lp) {
  if (!tier || tier === 'UNRANKED') return 0;
  if (MASTERS_T.has(tier)) return 2800 + (lp || 0);
  return (TIER_BASE[tier] || 0) + (DIV_BASE[rank] || 0) + (lp || 0);
}

async function kvGet() {
  const r = await fetch(`${KV_URL}/get/${STATE_KEY}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  if (!r.ok) return {};
  let d;
  try { d = await r.json(); } catch { return {}; }
  if (!d.result) return {};
  try { return JSON.parse(d.result); } catch { return {}; }
}

async function kvSet(state) {
  await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', STATE_KEY, JSON.stringify(state)])
  });
}

async function postWebhook(embed) {
  await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
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

function pKey(gameName, tagLine) {
  return `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

async function main() {
  const players = await fetchPlayers();
  if (!players.length) return;

  // Fetch current rank for all players in parallel
  const results = await Promise.all(players.map(({ gameName, tagLine }) =>
    fetchRank(gameName, tagLine).then(rank => rank ? {
      gameName, tagLine,
      lp: rank.totalLP || computeLP(rank.tier, rank.rank, rank.leaguePoints),
      tier: rank.tier, rank: rank.rank
    } : null)
  ));
  const current = results.filter(Boolean);
  current.sort((a, b) => b.lp - a.lp);

  // Load last known state
  const prev = await kvGet();
  const isFirstRun = Object.keys(prev).length === 0;

  if (!isFirstRun) {
    for (let i = 0; i < current.length; i++) {
      const p = current[i];
      const key = pKey(p.gameName, p.tagLine);
      const last = prev[key];
      if (!last) continue;

      // Tier/rank change
      if (last.tier !== p.tier || last.rank !== p.rank) {
        const up = p.lp > last.lp;
        await postWebhook({
          color: up ? 0x50c878 : 0xff6b6b,
          description: up
            ? `⬆️ **${p.gameName}** ranked up to **${p.tier} ${p.rank}**!`
            : `⬇️ **${p.gameName}** dropped to **${p.tier} ${p.rank}**`
        });
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
      }

      // Position change — only notify if they moved up and passed someone
      if (last.pos !== undefined && last.pos > i) {
        const passed = current[last.pos];
        if (passed) {
          await postWebhook({
            color: 0xc89b3c,
            description: `🔄 **${p.gameName}** passed **${passed.gameName}** — now **#${i + 1}**!`
          });
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
  }

  // Save new state
  const newState = {};
  for (let i = 0; i < current.length; i++) {
    const p = current[i];
    newState[pKey(p.gameName, p.tagLine)] = { lp: p.lp, tier: p.tier, rank: p.rank, pos: i };
  }
  await kvSet(newState);

  console.log(`Done. Checked ${current.length} players.${isFirstRun ? ' (first run — state initialized)' : ''}`);
}

main().catch(err => { console.error(err); process.exit(1); });
