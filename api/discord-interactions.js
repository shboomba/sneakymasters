// Discord slash command handler — serverless via Vercel
// Handles: /leaderboard, /points, /bet create|join|list|resolve

export const config = { api: { bodyParser: false } };

const PUBLIC_KEY    = process.env.DISCORD_PUBLIC_KEY;
const KV_URL        = process.env.KV_REST_API_URL;
const KV_TOKEN      = process.env.KV_REST_API_TOKEN;
const VERCEL_URL    = process.env.VERCEL_API_URL;

const POINTS_KEY    = 'rtm_gamba_points';
const BETS_KEY      = 'rtm_gamba_bets';
const USERNAMES_KEY = 'rtm_gamba_usernames';
const STARTING_PTS  = 1000;

/* ─── Signature Verification ─────────────────────────────────────────────────── */
function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
}

async function verifySignature(rawBody, signature, timestamp) {
  if (!PUBLIC_KEY || !signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw', hexToBytes(PUBLIC_KEY),
      { name: 'Ed25519' }, false, ['verify']
    );
    return await crypto.subtle.verify(
      'Ed25519', key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + rawBody)
    );
  } catch { return false; }
}

/* ─── KV Helpers ─────────────────────────────────────────────────────────────── */
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

async function kvSet(key, value) {
  await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', key, JSON.stringify(value)])
  });
}

/* ─── Points ─────────────────────────────────────────────────────────────────── */
async function getPoints() { return (await kvGet(POINTS_KEY)) || {}; }

async function getUserPoints(userId) {
  const pts = await getPoints();
  return pts[userId] ?? STARTING_PTS;
}

async function trackUsername(userId, username) {
  const names = (await kvGet(USERNAMES_KEY)) || {};
  if (names[userId] === username) return; // no-op if unchanged
  names[userId] = username;
  await kvSet(USERNAMES_KEY, names);
}

/* ─── Bets ───────────────────────────────────────────────────────────────────── */
async function getBets() { return (await kvGet(BETS_KEY)) || {}; }
async function saveBets(bets) { await kvSet(BETS_KEY, bets); }

function genId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

/* ─── Leaderboard ────────────────────────────────────────────────────────────── */
const TIER_BASE = { IRON:0,BRONZE:400,SILVER:800,GOLD:1200,PLATINUM:1600,EMERALD:2000,DIAMOND:2400,MASTER:2800,GRANDMASTER:2800,CHALLENGER:2800 };
const DIV_BASE  = { IV:0,III:100,II:200,I:300 };
const MASTERS_T = new Set(['MASTER','GRANDMASTER','CHALLENGER']);
const MEDAL     = ['🥇','🥈','🥉'];
const TIER_ICON = { IRON:'⚫',BRONZE:'🟤',SILVER:'⚪',GOLD:'🟡',PLATINUM:'🩵',EMERALD:'🟢',DIAMOND:'🔵',MASTER:'🟣',GRANDMASTER:'🔴',CHALLENGER:'🟠',UNRANKED:'⬜' };

async function fetchLeaderboard() {
  const { players } = await fetch(`${VERCEL_URL}/api/players`).then(r => r.json());
  const ranks = await Promise.all(players.map(({ gameName, tagLine }) =>
    fetch(`${VERCEL_URL}/api/summoner?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`)
      .then(r => r.json())
      .then(d => ({
        gameName, tagLine,
        tier: d.tier, rank: d.rank, leaguePoints: d.leaguePoints,
        lp: MASTERS_T.has(d.tier) ? 2800 + (d.leaguePoints || 0) : (TIER_BASE[d.tier] || 0) + (DIV_BASE[d.rank] || 0) + (d.leaguePoints || 0)
      }))
      .catch(() => null)
  ));
  return ranks.filter(Boolean).sort((a, b) => b.lp - a.lp);
}

/* ─── Response Helpers ───────────────────────────────────────────────────────── */
// ephemeral = only visible to the user who ran the command
function ephemeral(content) { return { type: 4, data: { content, flags: 64 } }; }
function reply(embeds) { return { type: 4, data: { embeds } }; }

/* ─── Command Handlers ───────────────────────────────────────────────────────── */
async function cmdLeaderboard() {
  const players = await fetchLeaderboard();
  if (!players.length) return ephemeral('No players tracked yet.');

  const lines = players.map((p, i) => {
    const pos = MEDAL[i] || `#${i + 1}`;
    const icon = TIER_ICON[p.tier] || '';
    const rankStr = p.tier === 'UNRANKED' ? 'Unranked'
      : MASTERS_T.has(p.tier) ? `${p.tier} ${p.leaguePoints} LP`
      : `${p.tier} ${p.rank} ${p.leaguePoints} LP`;
    return `${pos} **${p.gameName}** — ${icon} ${rankStr}`;
  });

  return reply([{
    title: '🏆 Race to Masters — Standings',
    description: lines.join('\n'),
    color: 0xc89b3c,
    timestamp: new Date().toISOString()
  }]);
}

async function cmdPoints(userId, username) {
  const [pts] = await Promise.all([getUserPoints(userId), trackUsername(userId, username)]);
  return reply([{
    description: `💰 **${username}** has **${pts.toLocaleString()} Gamba points**.`,
    color: 0xc89b3c
  }]);
}

async function cmdBetCreate(userId, username, title, description) {
  const [bets] = await Promise.all([getBets(), trackUsername(userId, username)]);
  const id = genId();
  bets[id] = {
    id, title,
    description: description || '',
    creator: userId, creatorName: username,
    createdAt: Date.now(),
    status: 'open',
    choices: {},
    totalPot: 0,
    winner: null
  };
  await saveBets(bets);

  return reply([{
    title: '🎲 New Bet Created!',
    description: `**${title}**${description ? `\n${description}` : ''}`,
    fields: [
      { name: 'Bet ID', value: `\`${id}\``, inline: true },
      { name: 'Creator', value: username, inline: true },
      { name: 'Join with', value: `/bet join id:${id} choice:yes amount:100`, inline: false },
      { name: 'Note', value: 'You can use any string as your choice — e.g. `yes`, `no`, a player name, etc.', inline: false }
    ],
    color: 0x50c878
  }]);
}

async function cmdBetJoin(userId, username, betId, choice, amount) {
  if (!betId || !choice) return ephemeral('Provide both `id` and `choice`.');
  if (amount <= 0) return ephemeral('Amount must be positive.');

  const [bets, allPts] = await Promise.all([getBets(), getPoints(), trackUsername(userId, username)]);
  const bet = bets[betId];
  if (!bet) return ephemeral(`Bet \`${betId}\` not found.`);
  if (bet.status !== 'open') return ephemeral(`Bet \`${betId}\` is no longer open.`);

  const userPts = allPts[userId] ?? STARTING_PTS;
  if (userPts < amount) return ephemeral(`You only have **${userPts} points**. Wager less.`);

  const choiceKey = choice.toLowerCase().slice(0, 30);
  if (!bet.choices[choiceKey]) bet.choices[choiceKey] = [];

  if (bet.choices[choiceKey].find(e => e.userId === userId)) {
    return ephemeral('You already wagered on this choice. Pick a different choice or wait for resolution.');
  }

  bet.choices[choiceKey].push({ userId, username, amount });
  bet.totalPot += amount;
  allPts[userId] = Math.max(0, userPts - amount);

  await Promise.all([saveBets(bets), kvSet(POINTS_KEY, allPts)]);

  return reply([{
    description: `✅ **${username}** wagered **${amount} pts** on **"${choice}"** in bet \`${betId}\`.\nPot is now **${bet.totalPot} pts**.`,
    color: 0x50c878
  }]);
}

async function cmdBetList() {
  const bets = await getBets();
  const open = Object.values(bets).filter(b => b.status === 'open').slice(0, 10);
  if (!open.length) return ephemeral('No open bets. Use `/bet create` to start one!');

  const fields = open.map(b => ({
    name: `\`${b.id}\` — ${b.title}`,
    value: `By **${b.creatorName}** · Pot: **${b.totalPot} pts** · Choices: ${Object.keys(b.choices).map(c => `\`${c}\``).join(', ') || '_none yet_'}`,
    inline: false
  }));

  return reply([{ title: '🎲 Open Bets', fields, color: 0xc89b3c }]);
}

async function cmdBetResolve(betId, winnerChoice) {
  if (!betId || !winnerChoice) return ephemeral('Provide both `id` and `winner`.');

  const [bets, allPts] = await Promise.all([getBets(), getPoints()]);
  const bet = bets[betId];
  if (!bet) return ephemeral(`Bet \`${betId}\` not found.`);
  if (bet.status !== 'open') return ephemeral(`Bet \`${betId}\` is already resolved.`);

  const choiceKey = winnerChoice.toLowerCase().slice(0, 30);
  const winners = bet.choices[choiceKey] || [];
  const loserPot = Object.entries(bet.choices)
    .filter(([k]) => k !== choiceKey)
    .reduce((sum, [, entries]) => sum + entries.reduce((s, e) => s + e.amount, 0), 0);

  const winnerTotal = winners.reduce((s, e) => s + e.amount, 0);
  const payouts = [];

  if (winnerTotal > 0) {
    for (const w of winners) {
      const share = w.amount / winnerTotal;
      const payout = w.amount + Math.floor(loserPot * share);
      allPts[w.userId] = (allPts[w.userId] ?? STARTING_PTS) + payout;
      payouts.push(`**${w.username}** received **+${payout} pts**`);
    }
  }

  bet.status = 'resolved';
  bet.winner = choiceKey;

  await Promise.all([saveBets(bets), kvSet(POINTS_KEY, allPts)]);

  return reply([{
    title: `🏆 Bet Resolved: \`${betId}\``,
    description: `**Winning choice: ${winnerChoice}**\n\n${payouts.length ? payouts.join('\n') : 'No one bet on this side — pot rolls over.'}`,
    color: 0xc89b3c
  }]);
}

/* ─── Main Handler ───────────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Read raw body (needed for signature verification — bodyParser is disabled)
  const rawBody = await new Promise((resolve, reject) => {
    let d = '';
    req.on('data', chunk => d += chunk);
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });

  const sig = req.headers['x-signature-ed25519'];
  const ts  = req.headers['x-signature-timestamp'];

  if (!await verifySignature(rawBody, sig, ts)) {
    return res.status(401).end('Invalid signature');
  }

  let interaction;
  try { interaction = JSON.parse(rawBody); } catch { return res.status(400).end(); }

  // PING — required for Discord to verify the endpoint
  if (interaction.type === 1) {
    return res.status(200).json({ type: 1 });
  }

  // APPLICATION_COMMAND
  if (interaction.type === 2) {
    const { name, options = [] } = interaction.data;
    const user = interaction.member?.user || interaction.user || {};
    const userId = user.id;
    const username = user.global_name || user.username || 'Unknown';

    let response;
    try {
      if (name === 'leaderboard') {
        response = await cmdLeaderboard();

      } else if (name === 'points') {
        response = await cmdPoints(userId, username);

      } else if (name === 'bet') {
        const sub = options[0];
        if (!sub) { response = ephemeral('Use /bet create, /bet join, /bet list, or /bet resolve.'); }
        else {
          const sopt = key => (sub.options || []).find(o => o.name === key)?.value;
          if (sub.name === 'create') {
            response = await cmdBetCreate(userId, username, sopt('title'), sopt('description'));
          } else if (sub.name === 'join') {
            response = await cmdBetJoin(userId, username, sopt('id'), sopt('choice'), Number(sopt('amount')) || 100);
          } else if (sub.name === 'list') {
            response = await cmdBetList();
          } else if (sub.name === 'resolve') {
            response = await cmdBetResolve(sopt('id'), sopt('winner'));
          } else {
            response = ephemeral('Unknown subcommand.');
          }
        }
      } else {
        response = ephemeral('Unknown command.');
      }
    } catch (err) {
      console.error('[interactions] error:', err);
      response = ephemeral('Something went wrong. Try again.');
    }

    return res.status(200).json(response);
  }

  return res.status(400).end();
}
