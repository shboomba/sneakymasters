import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import cron from 'node-cron';
import fetch from 'node-fetch';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// In-memory last known state for change detection
// { "name#tag": { lp, tier, rank, pos } }
const lastState = {};

const TIER_BASE = {
  IRON: 0, BRONZE: 400, SILVER: 800, GOLD: 1200,
  PLATINUM: 1600, EMERALD: 2000, DIAMOND: 2400,
  MASTER: 2800, GRANDMASTER: 2800, CHALLENGER: 2800
};
const DIV_BASE = { IV: 0, III: 100, II: 200, I: 300 };
const MASTERS_T = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

function computeLP(tier, rank, lp) {
  if (!tier || tier === 'UNRANKED') return 0;
  if (MASTERS_T.has(tier)) return 2800 + (lp || 0);
  return (TIER_BASE[tier] || 0) + (DIV_BASE[rank] || 0) + (lp || 0);
}

function pKey(gameName, tagLine) {
  return `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

async function getChannel() {
  return client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
}

async function fetchPlayers() {
  const r = await fetch(`${process.env.VERCEL_API_URL}/api/players`);
  return (await r.json()).players || [];
}

async function fetchRank(gameName, tagLine) {
  try {
    const r = await fetch(
      `${process.env.VERCEL_API_URL}/api/summoner?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`
    );
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function fetchLPHistory() {
  try {
    const r = await fetch(`${process.env.VERCEL_API_URL}/api/lp-history`);
    return (await r.json()).history || {};
  } catch { return {}; }
}

// Returns best single-game kills + total stats for today
async function fetchTodayStats(puuid) {
  const empty = { bestKills: 0, totalKills: 0, totalDeaths: 0, totalAssists: 0, games: 0 };
  if (!puuid || !process.env.RIOT_API_KEY) return empty;
  try {
    const midnight = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const idsRes = await fetch(
      `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&start=0&count=20&startTime=${midnight}`,
      { headers: { 'X-Riot-Token': process.env.RIOT_API_KEY } }
    );
    if (!idsRes.ok) return empty;
    const ids = await idsRes.json();
    if (!ids.length) return empty;

    let bestKills = 0, totalKills = 0, totalDeaths = 0, totalAssists = 0;
    for (const id of ids) {
      const mr = await fetch(
        `https://americas.api.riotgames.com/lol/match/v5/matches/${id}`,
        { headers: { 'X-Riot-Token': process.env.RIOT_API_KEY } }
      );
      if (!mr.ok) continue;
      const m = await mr.json();
      const p = m?.info?.participants?.find(p => p.puuid === puuid);
      if (!p) continue;
      totalKills += p.kills;
      totalDeaths += p.deaths;
      totalAssists += p.assists;
      if (p.kills > bestKills) bestKills = p.kills;
    }
    return { bestKills, totalKills, totalDeaths, totalAssists, games: ids.length };
  } catch { return empty; }
}

async function postDailyUpdate() {
  try {
    const channel = await getChannel();
    const players = await fetchPlayers();
    const history = await fetchLPHistory();
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

    const stats = [];
    for (const { gameName, tagLine } of players) {
      const rank = await fetchRank(gameName, tagLine);
      if (!rank) continue;

      const key = pKey(gameName, tagLine);
      const hist = history[key] || [];
      const midnightMs = Date.now() - (Date.now() % 86400000);
      const todayStart = [...hist].reverse().find(e => e.ts < midnightMs);
      const lpNow = rank.totalLP || computeLP(rank.tier, rank.rank, rank.leaguePoints);
      const lpDelta = todayStart ? lpNow - todayStart.lp : null;
      const matchStats = await fetchTodayStats(rank.puuid);

      stats.push({ gameName, tagLine, rank, lpNow, lpDelta, ...matchStats });
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

    const withDelta = stats.filter(s => s.lpDelta !== null);
    const mostGain  = withDelta.length ? withDelta.reduce((a, b) => b.lpDelta > a.lpDelta ? b : a) : null;
    const leastGain = withDelta.length ? withDelta.reduce((a, b) => b.lpDelta < a.lpDelta ? b : a) : null;
    const withGames = stats.filter(s => s.games > 0);
    const mostKills = withGames.length ? withGames.reduce((a, b) => b.bestKills > a.bestKills ? b : a) : null;

    const highlights = [
      mostGain  ? `🏆 **Most LP gained:** ${mostGain.gameName} +${mostGain.lpDelta} LP` : null,
      leastGain && leastGain !== mostGain ? `📉 **Least LP gained:** ${leastGain.gameName} ${leastGain.lpDelta} LP` : null,
      mostKills && mostKills.bestKills > 0 ? `⚔️ **Best game (kills):** ${mostKills.gameName} — ${mostKills.bestKills} kills` : null,
    ].filter(Boolean);

    const description = lines.join('\n') + (highlights.length ? '\n\u200B\n' + highlights.join('\n') : '');

    const embed = new EmbedBuilder()
      .setTitle(`📊 Daily Leaderboard Update — ${today}`)
      .setColor(0xc89b3c)
      .setDescription(description)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Daily update error:', err);
  }
}

async function checkForChanges() {
  try {
    const channel = await getChannel();
    const players = await fetchPlayers();
    const current = [];

    for (const { gameName, tagLine } of players) {
      const rank = await fetchRank(gameName, tagLine);
      if (!rank) continue;
      const lp = rank.totalLP || computeLP(rank.tier, rank.rank, rank.leaguePoints);
      current.push({ gameName, tagLine, lp, tier: rank.tier, rank: rank.rank });
    }

    current.sort((a, b) => b.lp - a.lp);

    // Build previous position map
    const prevPositions = {};
    for (const [key, state] of Object.entries(lastState)) {
      prevPositions[key] = state.pos;
    }

    for (let i = 0; i < current.length; i++) {
      const p = current[i];
      const key = pKey(p.gameName, p.tagLine);
      const prev = lastState[key];

      if (prev) {
        // Tier/rank change
        if (prev.tier !== p.tier || prev.rank !== p.rank) {
          const up = p.lp > prev.lp;
          const embed = new EmbedBuilder()
            .setColor(up ? 0x50c878 : 0xff6b6b)
            .setDescription(up
              ? `⬆️ **${p.gameName}** ranked up to **${p.tier} ${p.rank}**!`
              : `⬇️ **${p.gameName}** dropped to **${p.tier} ${p.rank}**`
            );
          await channel.send({ embeds: [embed] });
        }

        // Position change — someone got passed
        if (prev.pos !== undefined && prev.pos > i) {
          const passed = current[prev.pos];
          if (passed) {
            const embed = new EmbedBuilder()
              .setColor(0xc89b3c)
              .setDescription(`🔄 **${p.gameName}** passed **${passed.gameName}** — now **#${i + 1}**!`);
            await channel.send({ embeds: [embed] });
          }
        }
      }

      lastState[key] = { lp: p.lp, tier: p.tier, rank: p.rank, pos: i };
    }
  } catch (err) {
    console.error('Change monitor error:', err);
  }
}

client.once('ready', () => {
  console.log(`Bot online: ${client.user.tag}`);

  // Daily update at 9am UTC
  // 11:59 PM PST (UTC-8) = 07:59 UTC
  // Note: during PDT (summer, UTC-7) this fires at 12:59 AM — set to 06:59 UTC if you prefer PDT
  cron.schedule('59 7 * * *', () => {
    console.log('Posting daily update...');
    postDailyUpdate();
  });

  // Change monitor every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    console.log('Checking for changes...');
    checkForChanges();
  });

  // Run initial state snapshot on startup (no notifications)
  checkForChanges().then(() => console.log('Initial state loaded.'));
});

client.login(process.env.DISCORD_BOT_TOKEN);
