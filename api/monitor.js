// Monitor endpoint — called by cron-job.org every minute
// Checks for rank/position changes and posts to Discord webhook

const WEBHOOK   = process.env.DISCORD_WEBHOOK_URL;
const KV_URL    = process.env.KV_REST_API_URL;
const KV_TOKEN  = process.env.KV_REST_API_TOKEN;
const API       = process.env.VERCEL_API_URL;
const SECRET    = process.env.MONITOR_SECRET; // optional: guard against random callers
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
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', STATE_KEY, JSON.stringify(state)])
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error(`[monitor] KV SET failed: ${r.status} — ${body}`);
  }
}

async function postWebhook(embed) {
  if (!WEBHOOK) {
    console.error('[monitor] DISCORD_WEBHOOK_URL is not set — cannot post notification');
    return false;
  }
  const r = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error(`[monitor] Webhook POST failed: ${r.status} — ${body}`);
    return false;
  }
  return true;
}

function pKey(gameName, tagLine) {
  return `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

export default async function handler(req, res) {
  // Allow GET (cron-job.org) or POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }

  // Optional secret check — skip if MONITOR_SECRET not set
  if (SECRET) {
    const provided = req.headers['x-monitor-secret'] || req.query.secret;
    if (provided !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const apiBase = API || `https://${req.headers.host}`;

    const playersRes = await fetch(`${apiBase}/api/players`);
    const { players = [] } = await playersRes.json();
    if (!players.length) return res.status(200).json({ ok: true, message: 'No players' });

    const results = await Promise.all(players.map(({ gameName, tagLine }) =>
      fetch(`${apiBase}/api/summoner?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`)
        .then(r => r.ok ? r.json() : null)
        .then(rank => rank ? {
          gameName, tagLine,
          lp: computeLP(rank.tier, rank.rank, rank.leaguePoints),
          tier: rank.tier, rank: rank.rank
        } : null)
        .catch(() => null)
    ));

    const current = results.filter(Boolean).sort((a, b) => b.lp - a.lp);
    if (current.length === 0) {
      console.error('[monitor] All summoner lookups failed — Riot API key may be expired or rate-limited');
    }
    const prev = await kvGet();
    const isFirstRun = Object.keys(prev).length === 0;
    console.log(`[monitor] checked=${current.length} prevKeys=${Object.keys(prev).length} firstRun=${isFirstRun} webhook=${!!WEBHOOK}`);
    const notifications = [];

    if (!isFirstRun) {
      for (let i = 0; i < current.length; i++) {
        const p = current[i];
        const key = pKey(p.gameName, p.tagLine);
        const last = prev[key];
        if (!last) continue;

        if (last.tier !== p.tier || last.rank !== p.rank) {
          const up = p.lp > last.lp;
          await postWebhook({
            color: up ? 0x50c878 : 0xff6b6b,
            description: up
              ? `⬆️ **${p.gameName}** ranked up to **${p.tier} ${p.rank}**!`
              : `⬇️ **${p.gameName}** dropped to **${p.tier} ${p.rank}**`
          });
          notifications.push(`${p.gameName}: ${last.tier} ${last.rank} → ${p.tier} ${p.rank}`);
          await new Promise(r => setTimeout(r, 500));
        }

        if (last.pos !== undefined && last.pos > i) {
          const passed = current[last.pos];
          if (passed) {
            await postWebhook({
              color: 0xc89b3c,
              description: `🔄 **${p.gameName}** passed **${passed.gameName}** — now **#${i + 1}**!`
            });
            notifications.push(`${p.gameName} passed ${passed.gameName}`);
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    }

    const newState = {};
    for (let i = 0; i < current.length; i++) {
      const p = current[i];
      newState[pKey(p.gameName, p.tagLine)] = { lp: p.lp, tier: p.tier, rank: p.rank, pos: i };
    }
    await kvSet(newState);

    return res.status(200).json({
      ok: true,
      checked: current.length,
      firstRun: isFirstRun,
      notifications
    });

  } catch (err) {
    console.error('[monitor]', err);
    return res.status(500).json({ error: err.message });
  }
}
