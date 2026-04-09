/* ─── Constants ──────────────────────────────────────────────────────────────── */
const STARRED_KEY     = 'rtm_starred';
const POS_HISTORY_KEY = 'rtm_pos_history';
const CHAMPIONS_KEY   = 'rtm_champions';

const LP_HISTORY_MAX     = 200;
const CHAMPION_TTL       = 12 * 60 * 60 * 1000; // 12 hours
const POS_HISTORY_MAX_AGE = 35 * 24 * 60 * 60 * 1000; // 35 days

const MASTERS_THRESHOLD = 2800;

const TIER_BASE = {
  IRON: 0, BRONZE: 400, SILVER: 800, GOLD: 1200,
  PLATINUM: 1600, EMERALD: 2000, DIAMOND: 2400,
  MASTER: 2800, GRANDMASTER: 2800, CHALLENGER: 2800
};

const DIVISION_BASE = { IV: 0, III: 100, II: 200, I: 300 };

const TIER_DISPLAY = {
  IRON: 'Iron', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold',
  PLATINUM: 'Platinum', EMERALD: 'Emerald', DIAMOND: 'Diamond',
  MASTER: 'Master', GRANDMASTER: 'Grandmaster', CHALLENGER: 'Challenger',
  UNRANKED: 'Unranked'
};

const TIER_COLORS = {
  IRON: '#6b6b6b', BRONZE: '#cd853f', SILVER: '#c0c0c0', GOLD: '#ffd700',
  PLATINUM: '#40e0d0', EMERALD: '#50c878', DIAMOND: '#b9d4f5',
  MASTER: '#d7a2e8', GRANDMASTER: '#ff6b6b', CHALLENGER: '#ffd700'
};

const MASTERS_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

const ROLE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const ROLE_DISPLAY = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
const ROLE_SLUG = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'bottom', UTILITY: 'support' };

function roleIconUrl(role) {
  const slug = ROLE_SLUG[role];
  return slug
    ? `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/position-${slug}.svg`
    : null;
}

// Number line layout
const NL_TRACK_WIDTH   = 3200;
const NL_LP_MAX        = 2900;
const NL_PADDING_LEFT  = 80;
const NL_PADDING_RIGHT = 80;

const NL_ZONES = [
  { tier: 'IRON',     start: 0,    end: 400,  color: '#6b6b6b' },
  { tier: 'BRONZE',   start: 400,  end: 800,  color: '#cd853f' },
  { tier: 'SILVER',   start: 800,  end: 1200, color: '#c0c0c0' },
  { tier: 'GOLD',     start: 1200, end: 1600, color: '#ffd700' },
  { tier: 'PLATINUM', start: 1600, end: 2000, color: '#40e0d0' },
  { tier: 'EMERALD',  start: 2000, end: 2400, color: '#50c878' },
  { tier: 'DIAMOND',  start: 2400, end: 2800, color: '#b9d4f5' },
  { tier: 'MASTER+',  start: 2800, end: 2900, color: '#d7a2e8' },
];

const ARRANGE_KEY = 'rtm_arrange_order';

/* ─── In-Memory State ────────────────────────────────────────────────────────── */
let enrichedPlayers = [];
let activeTab = 'cards';
let viewMode = 'leaderboard'; // 'leaderboard' | 'role' | 'arrange'
let lpHistoryOpen = false;
let ddVersion = null; // cached Data Dragon version

function getSavedOrder() {
  try { return JSON.parse(localStorage.getItem(ARRANGE_KEY)) || []; } catch { return []; }
}
function saveOrder(keys) { localStorage.setItem(ARRANGE_KEY, JSON.stringify(keys)); }

/* ─── LP Math ────────────────────────────────────────────────────────────────── */
function computeTotalLP(tier, rank, lp) {
  if (!tier || tier === 'UNRANKED') return 0;
  if (MASTERS_TIERS.has(tier)) return MASTERS_THRESHOLD + (lp || 0);
  return (TIER_BASE[tier] ?? 0) + (DIVISION_BASE[rank] ?? 0) + (lp || 0);
}

/* ─── Shared Player List (API) ───────────────────────────────────────────────── */
async function loadPlayers() {
  try {
    const res = await fetch('/api/players');
    const data = await res.json();
    return data.players || [];
  } catch { return []; }
}

async function addPlayerToList(gameName, tagLine) {
  const res = await fetch('/api/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameName, tagLine })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to add player');
}

async function removePlayerFromList(gameName, tagLine) {
  await fetch('/api/players', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameName, tagLine })
  });
}

/* ─── LocalStorage: Starred ──────────────────────────────────────────────────── */
function loadStarred() {
  try { return new Set(JSON.parse(localStorage.getItem(STARRED_KEY)) || []); }
  catch { return new Set(); }
}

function saveStarred(set) {
  localStorage.setItem(STARRED_KEY, JSON.stringify([...set]));
}

function toggleStar(gameName, tagLine) {
  const starred = loadStarred();
  const key = playerKey(gameName, tagLine);
  if (starred.has(key)) starred.delete(key);
  else starred.add(key);
  saveStarred(starred);
}

function isStarred(gameName, tagLine) {
  return loadStarred().has(playerKey(gameName, tagLine));
}

/* ─── LP History (shared via KV) ─────────────────────────────────────────────── */
let lpHistoryCache = {};

async function fetchLPHistory() {
  try {
    const res = await fetch('/api/lp-history');
    const data = await res.json();
    lpHistoryCache = data.history || {};
  } catch {
    lpHistoryCache = {};
  }
}

async function recordLPSnapshot(gameName, tagLine, totalLP) {
  const key = playerKey(gameName, tagLine);
  const snapshot = { ts: Date.now(), lp: totalLP };

  // Update local cache immediately
  if (!lpHistoryCache[key]) lpHistoryCache[key] = [];
  lpHistoryCache[key].push(snapshot);
  if (lpHistoryCache[key].length > LP_HISTORY_MAX) {
    lpHistoryCache[key] = lpHistoryCache[key].slice(-LP_HISTORY_MAX);
  }

  // Persist to shared KV (fire and forget — don't block rendering)
  fetch('/api/lp-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, snapshot })
  }).catch(() => {});
}

function getPlayerLPHistory(gameName, tagLine) {
  return lpHistoryCache[playerKey(gameName, tagLine)] || [];
}

/* ─── LocalStorage: Position History ────────────────────────────────────────── */
function loadPosHistory() {
  try { return JSON.parse(localStorage.getItem(POS_HISTORY_KEY)) || {}; }
  catch { return {}; }
}

function savePosHistory(h) {
  localStorage.setItem(POS_HISTORY_KEY, JSON.stringify(h));
}

function recordPositionSnapshots(sortedPlayers) {
  const h = loadPosHistory();
  const now = Date.now();
  const cutoff = now - POS_HISTORY_MAX_AGE;
  sortedPlayers.forEach((p, i) => {
    if (p.loading || p.error) return;
    const key = playerKey(p.gameName, p.tagLine);
    if (!h[key]) h[key] = [];
    h[key].push({ ts: now, position: i + 1 });
    h[key] = h[key].filter(e => e.ts > cutoff);
  });
  savePosHistory(h);
}

function getWeeklyPositionChange(gameName, tagLine, currentPosition) {
  const h = loadPosHistory();
  const entries = h[playerKey(gameName, tagLine)] || [];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekEntries = entries.filter(e => e.ts >= sevenDaysAgo);
  if (weekEntries.length === 0) return null;
  return weekEntries[0].position - currentPosition; // positive = moved up
}

/* ─── LocalStorage: Champion Cache ──────────────────────────────────────────── */
function loadChampionCache() {
  try { return JSON.parse(localStorage.getItem(CHAMPIONS_KEY)) || {}; }
  catch { return {}; }
}

function saveChampionCache(c) {
  localStorage.setItem(CHAMPIONS_KEY, JSON.stringify(c));
}

function getCachedChampions(gameName, tagLine) {
  const c = loadChampionCache();
  const entry = c[playerKey(gameName, tagLine)];
  if (!entry) return null;
  if (Date.now() - entry.ts > CHAMPION_TTL) return null;
  return { champions: entry.champions, streak: entry.streak || null, roles: entry.roles || [] };
}

function cacheChampions(gameName, tagLine, champions, streak, roles) {
  const c = loadChampionCache();
  c[playerKey(gameName, tagLine)] = { ts: Date.now(), champions, streak: streak || null, roles: roles || [] };
  saveChampionCache(c);
}

/* ─── Data Dragon ────────────────────────────────────────────────────────────── */
async function getDDragonVersion() {
  if (ddVersion) return ddVersion;
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versions = await res.json();
    ddVersion = versions[0];
  } catch {
    ddVersion = '15.7.1';
  }
  return ddVersion;
}

function championIconUrl(championName, version) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${encodeURIComponent(championName)}.png`;
}

/* ─── Champions API ──────────────────────────────────────────────────────────── */
async function fetchChampions(puuid) {
  try {
    const res = await fetch(`/api/champions?puuid=${encodeURIComponent(puuid)}`);
    if (!res.ok) return { champions: [], streak: null, roles: [] };
    const data = await res.json();
    return { champions: data.champions || [], streak: data.streak || null, roles: data.roles || [] };
  } catch {
    return { champions: [], streak: null, roles: [] };
  }
}

/* ─── Riot API ───────────────────────────────────────────────────────────────── */
async function fetchPlayerData(gameName, tagLine) {
  const url = `/api/summoner?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

  const totalLP = computeTotalLP(data.tier, data.rank, data.leaguePoints);
  const totalGames = data.wins + data.losses;
  const winRate = totalGames > 0 ? ((data.wins / totalGames) * 100).toFixed(1) : null;
  const atMasters = MASTERS_TIERS.has(data.tier);

  return {
    gameName: data.gameName,
    tagLine: data.tagLine,
    puuid: data.puuid,
    tier: data.tier,
    rank: data.rank,
    leaguePoints: data.leaguePoints,
    wins: data.wins,
    losses: data.losses,
    totalLP,
    winRate,
    atMasters,
    champions: [],
    loading: false,
    error: null
  };
}

/* ─── State Management ───────────────────────────────────────────────────────── */
function upsertPlayer(data) {
  const key = playerKey(data.gameName, data.tagLine);
  const idx = enrichedPlayers.findIndex(p => playerKey(p.gameName, p.tagLine) === key);
  if (idx === -1) {
    enrichedPlayers.push(data);
  } else {
    if (data.error && enrichedPlayers[idx].tier) {
      enrichedPlayers[idx] = { ...enrichedPlayers[idx], loading: false, error: data.error };
    } else {
      // Preserve existing champions array if not yet updated
      const existingChampions = enrichedPlayers[idx].champions;
      enrichedPlayers[idx] = { ...data, champions: data.champions || existingChampions || [] };
    }
  }
}

function removePlayerFromState(gameName, tagLine) {
  const key = playerKey(gameName, tagLine);
  enrichedPlayers = enrichedPlayers.filter(p => playerKey(p.gameName, p.tagLine) !== key);
}

function playerKey(gameName, tagLine) {
  return `${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

function getTierColor(tier) {
  return TIER_COLORS[tier] || '#4a5568';
}

/* ─── Refresh ────────────────────────────────────────────────────────────────── */
async function refreshAll() {
  const [players] = await Promise.all([loadPlayers(), fetchLPHistory()]);
  if (players.length === 0) {
    renderLeaderboard();
    return;
  }

  const refreshBtn = document.getElementById('btn-refresh-all');
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing...';

  // Set all to loading
  for (const p of players) {
    const existing = enrichedPlayers.find(e => playerKey(e.gameName, e.tagLine) === playerKey(p.gameName, p.tagLine));
    if (!existing) {
      upsertPlayer({ gameName: p.gameName, tagLine: p.tagLine, loading: true, totalLP: 0, champions: [] });
    } else {
      existing.loading = true;
    }
  }
  renderLeaderboard();

  // Fetch rank data sequentially
  for (const p of players) {
    try {
      const data = await fetchPlayerData(p.gameName, p.tagLine);
      upsertPlayer(data);
    } catch (err) {
      upsertPlayer({ gameName: p.gameName, tagLine: p.tagLine, loading: false, error: err.message, totalLP: 0, champions: [] });
    }
    renderLeaderboard();
  }

  // Sort for snapshots
  const sorted = [...enrichedPlayers]
    .filter(p => !p.loading && !p.error && p.tier)
    .sort((a, b) => (b.totalLP || 0) - (a.totalLP || 0));

  // Record LP + position history
  for (const p of sorted) {
    recordLPSnapshot(p.gameName, p.tagLine, p.totalLP);
  }
  recordPositionSnapshots(sorted);

  // Fetch champions (cache-aware, sequential)
  await getDDragonVersion();
  for (const p of sorted) {
    let cached = getCachedChampions(p.gameName, p.tagLine);
    if (cached === null && p.puuid) {
      cached = await fetchChampions(p.puuid);
      cacheChampions(p.gameName, p.tagLine, cached.champions, cached.streak, cached.roles);
    }
    const state = enrichedPlayers.find(e => playerKey(e.gameName, e.tagLine) === playerKey(p.gameName, p.tagLine));
    if (state) {
      state.champions = cached?.champions || [];
      state.streak = cached?.streak || null;
      state.roles = cached?.roles || [];
    }
  }

  renderLeaderboard();
  if (activeTab === 'rankings') renderRankingsTab();
  if (activeTab === 'numberline') renderNumberLineTab();

  refreshBtn.disabled = false;
  refreshBtn.textContent = 'Refresh All';
}

/* ─── Card Rendering ─────────────────────────────────────────────────────────── */
function renderLeaderboard() {
  const board = document.getElementById('leaderboard');

  if (enrichedPlayers.length === 0) {
    board.innerHTML = `
      <div class="empty-state">
        <h2>No players yet</h2>
        <p>Add players to start tracking the race to Masters.</p>
      </div>`;
    return;
  }

  const starred = loadStarred();
  let sorted;

  if (viewMode === 'arrange') {
    const savedOrder = getSavedOrder();
    if (savedOrder.length > 0) {
      sorted = [...enrichedPlayers].sort((a, b) => {
        const aIdx = savedOrder.indexOf(playerKey(a.gameName, a.tagLine));
        const bIdx = savedOrder.indexOf(playerKey(b.gameName, b.tagLine));
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return (b.totalLP || 0) - (a.totalLP || 0);
      });
    } else {
      sorted = [...enrichedPlayers].sort((a, b) => (b.totalLP || 0) - (a.totalLP || 0));
    }
  } else {
    sorted = [...enrichedPlayers].sort((a, b) => {
      if (a.loading && !b.loading) return 1;
      if (!a.loading && b.loading) return -1;
      const aStarred = starred.has(playerKey(a.gameName, a.tagLine));
      const bStarred = starred.has(playerKey(b.gameName, b.tagLine));
      if (aStarred && !bStarred) return -1;
      if (!aStarred && bStarred) return 1;
      return (b.totalLP || 0) - (a.totalLP || 0);
    });
  }

  const draggable = viewMode === 'arrange';

  if (viewMode === 'role') {
    // Group by primary role, render section headers
    let html = '';
    for (const role of ROLE_ORDER) {
      const inRole = sorted.filter(p => p.roles && p.roles[0] === role);
      if (inRole.length === 0) continue;
      html += `<div class="role-section-header"><img class="role-section-icon" src="${roleIconUrl(role)}" alt="${ROLE_DISPLAY[role]}"><span>${ROLE_DISPLAY[role]}</span></div>`;
      html += `<div class="role-section-grid">`;
      html += inRole.map((player, i) => renderCard(player, i + 1, draggable)).join('');
      html += `</div>`;
    }
    // Players with no role data go at the end
    const noRole = sorted.filter(p => !p.roles || p.roles.length === 0);
    if (noRole.length > 0) {
      html += `<div class="role-section-header"><span>Unassigned</span></div><div class="role-section-grid">`;
      html += noRole.map((player, i) => renderCard(player, i + 1, draggable)).join('');
      html += `</div>`;
    }
    board.innerHTML = html;
  } else {
    board.innerHTML = sorted.map((player, i) => renderCard(player, i + 1, draggable)).join('');
  }

  if (draggable) {
    let dragSrc = null;
    board.querySelectorAll('.player-card').forEach(card => {
      card.addEventListener('dragstart', () => { dragSrc = card; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => {
        dragSrc = null;
        board.querySelectorAll('.player-card').forEach(c => c.classList.remove('drag-over', 'dragging'));
      });
      card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', e => {
        e.preventDefault();
        if (!dragSrc || dragSrc === card) return;
        card.classList.remove('drag-over');
        const cards = [...board.querySelectorAll('.player-card')];
        const srcIdx = cards.indexOf(dragSrc);
        const dstIdx = cards.indexOf(card);
        cards.splice(srcIdx, 1);
        cards.splice(dstIdx, 0, dragSrc);
        saveOrder(cards.map(c => c.dataset.playerKey));
        renderLeaderboard();
      });
    });
  }
}

function renderCard(player, position, draggable = false) {
  const tier = player.tier || 'UNRANKED';
  const rankClasses = ['rank-first', 'rank-second', 'rank-third'];
  const rankClass = position <= 3 ? rankClasses[position - 1] : '';
  const pKey = playerKey(player.gameName, player.tagLine);

  if (player.loading) {
    return `
      <div class="player-card card-loading" data-tier="UNRANKED" data-player-key="${pKey}">
        <div class="card-header">
          <div class="card-identity">
            <div class="skeleton skeleton-name"></div>
            <div class="skeleton skeleton-tag"></div>
          </div>
        </div>
        <div class="skeleton skeleton-badge"></div>
      </div>`;
  }

  const tierDisplay = player.atMasters
    ? TIER_DISPLAY[tier]
    : tier === 'UNRANKED' ? 'Unranked'
    : `${TIER_DISPLAY[tier]} ${player.rank || ''}`;

  const lpDisplay = player.atMasters
    ? `${player.leaguePoints} LP`
    : tier === 'UNRANKED' ? '—'
    : `${player.leaguePoints} LP`;

  const totalGames = (player.wins || 0) + (player.losses || 0);
  const recordHtml = totalGames > 0
    ? `${player.wins}W / ${player.losses}L &mdash; <span class="win-rate ${player.winRate >= 50 ? 'positive' : 'negative'}">${player.winRate}% WR</span>`
    : 'No games played';

  const mastersBanner = player.atMasters
    ? `<div class="masters-banner">&#9733; Reached ${TIER_DISPLAY[tier]}!</div>`
    : '';

  const streakBanner = player.streak && player.streak.count >= 3
    ? `<div class="streak-banner streak-banner-${player.streak.type}">${player.streak.type === 'win' ? '🔥' : '💀'} ${player.streak.count} ${player.streak.type === 'win' ? 'Win' : 'Loss'} Streak</div>`
    : '';

  const errorMsg = player.error
    ? `<div class="card-error-msg">&#9888; ${player.error}</div>`
    : '';

  const champHtml = renderChampions(player);
  const graphHtml = renderGraphPanel(player);
  const graphKey = pKey.replace(/[^a-z0-9]/g, '-');
  const starred = isStarred(player.gameName, player.tagLine);

  return `
    <div class="player-card ${rankClass}${starred ? ' card-starred' : ''}${draggable ? ' draggable-card' : ''}" data-tier="${tier}" data-game-name="${escHtml(player.gameName)}" data-tag-line="${escHtml(player.tagLine)}" data-player-key="${pKey}"${draggable ? ' draggable="true"' : ''}>
      <div class="card-header">
        <div class="card-identity">
          <div class="card-name-row">
            <div class="card-game-name">${escHtml(player.gameName)}</div>
            ${player.roles && player.roles.length > 0
              ? player.roles.map((r, i) => (i > 0 ? `<span class="role-sep">/</span>` : '') + `<img class="card-role-icon" src="${roleIconUrl(r)}" alt="${ROLE_DISPLAY[r] || r}" title="${ROLE_DISPLAY[r] || r}">`).join('')
              : ''}
          </div>
          <div class="card-tag-line">#${escHtml(player.tagLine)}</div>
        </div>
        <button class="btn-star ${starred ? 'starred' : ''}" data-game-name="${escHtml(player.gameName)}" data-tag-line="${escHtml(player.tagLine)}" title="${starred ? 'Unpin' : 'Pin to top'}">&#9733;</button>
        <button class="btn-remove" data-game-name="${escHtml(player.gameName)}" data-tag-line="${escHtml(player.tagLine)}" title="Remove player">&#10005;</button>
      </div>
      <div class="card-rank-info">
        <span class="tier-badge">${tierDisplay}</span>
        <span class="lp-display">${lpDisplay}</span>
      </div>
      ${champHtml}
      <div class="card-record">${recordHtml}</div>
      ${mastersBanner}
      ${streakBanner}
      ${errorMsg}
      <div class="card-footer">
        <button class="btn-graph-toggle" data-graph-key="${graphKey}">LP History</button>
        <div class="graph-panel" id="graph-${graphKey}">
          ${graphHtml}
        </div>
      </div>
    </div>`;
}

function renderChampions(player) {
  if (!player.champions || player.champions.length === 0) return '';
  const ver = ddVersion || '15.7.1';
  const icons = player.champions.map(name =>
    `<img class="champion-icon" src="${championIconUrl(name, ver)}" alt="${escHtml(name)}" title="${escHtml(name)}" loading="lazy">`
  ).join('');
  return `<div class="card-champions">${icons}</div>`;
}

function renderGraphPanel(player) {
  const history = getPlayerLPHistory(player.gameName, player.tagLine);

  function lpChangeSince(ms) {
    const cutoff = Date.now() - ms;
    const inRange = history.filter(e => e.ts >= cutoff);
    if (inRange.length === 0 || history.length === 0) return null;
    return history[history.length - 1].lp - inRange[0].lp;
  }

  function formatChange(val) {
    if (val === null) return `<span class="neutral">—</span>`;
    if (val > 0)  return `<span class="positive">+${val} LP</span>`;
    if (val < 0)  return `<span class="negative">${val} LP</span>`;
    return `<span class="neutral">±0 LP</span>`;
  }

  const change7  = lpChangeSince(7  * 24 * 60 * 60 * 1000);
  const change30 = lpChangeSince(30 * 24 * 60 * 60 * 1000);

  const statsHtml = `
    <div class="graph-stats">
      <div class="graph-stat">Last 7 days<span>${formatChange(change7)}</span></div>
      <div class="graph-stat">Last 30 days<span>${formatChange(change30)}</span></div>
    </div>`;

  const chartHtml = history.length >= 2
    ? buildSVGChart(history)
    : `<p class="graph-no-data">Refresh a few more times to build history.</p>`;

  return statsHtml + chartHtml;
}

function buildSVGChart(history) {
  const W = 300, H = 80;
  const PAD = { top: 8, right: 8, bottom: 8, left: 8 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const lps = history.map(e => e.lp);
  const minLP = Math.min(...lps);
  const maxLP = Math.max(...lps);
  const range = maxLP - minLP || 1;

  const pts = history.map((e, i) => {
    const x = PAD.left + (i / (history.length - 1)) * cW;
    const y = PAD.top + (1 - (e.lp - minLP) / range) * cH;
    return [x.toFixed(1), y.toFixed(1)];
  });

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
  const bottomY  = (PAD.top + cH).toFixed(1);
  const areaPath = `${linePath} L${pts[pts.length - 1][0]} ${bottomY} L${pts[0][0]} ${bottomY} Z`;

  const [lastX, lastY] = pts[pts.length - 1];

  return `
    <svg class="lp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path class="chart-area" d="${areaPath}"/>
      <path class="chart-line" d="${linePath}"/>
      <circle class="chart-dot" cx="${lastX}" cy="${lastY}" r="3"/>
    </svg>`;
}

/* ─── Rankings Tab ───────────────────────────────────────────────────────────── */
function renderRankingsTab() {
  const container = document.getElementById('rankings-list');
  if (!container) return;

  const sorted = [...enrichedPlayers]
    .filter(p => !p.loading)
    .sort((a, b) => (b.totalLP || 0) - (a.totalLP || 0));

  if (sorted.length === 0) {
    container.innerHTML = `<div class="empty-state"><h2>No players</h2><p>Add players on the Cards tab.</p></div>`;
    return;
  }

  container.innerHTML = sorted.map((p, i) => {
    const pos = i + 1;
    const change = getWeeklyPositionChange(p.gameName, p.tagLine, pos);
    let changeBadge;
    if (change === null || change === 0) {
      changeBadge = `<span class="pos-change same">&#8212;</span>`;
    } else if (change > 0) {
      changeBadge = `<span class="pos-change up">↑${change}</span>`;
    } else {
      changeBadge = `<span class="pos-change down">↓${Math.abs(change)}</span>`;
    }

    const tier = p.tier || 'UNRANKED';
    const tierStr = tier === 'UNRANKED' ? 'Unranked'
      : MASTERS_TIERS.has(tier) ? `${TIER_DISPLAY[tier]} — ${p.leaguePoints} LP`
      : `${TIER_DISPLAY[tier]} ${p.rank} — ${p.leaguePoints} LP`;

    const opggName = `${encodeURIComponent(p.gameName)}-${encodeURIComponent(p.tagLine)}`;

    return `
      <div class="ranking-row" data-tier="${tier}">
        <div class="ranking-pos">#${pos}</div>
        <div class="ranking-name">
          <div class="game-name">${escHtml(p.gameName)}</div>
          <div class="tag-line">#${escHtml(p.tagLine)}</div>
        </div>
        <div class="ranking-rank">${tierStr}</div>
        <a href="https://www.op.gg/summoners/na/${opggName}" target="_blank" rel="noopener" class="btn-opgg">op.gg</a>
        ${changeBadge}
      </div>`;
  }).join('');
}

/* ─── Number Line Tab ────────────────────────────────────────────────────────── */
const NL_LABEL_H     = 36;  // px height of name + LP label block
const NL_LABEL_V_GAP = 10;  // px gap between label edge and baseline
const NL_MIN_X_GAP   = 130; // min horizontal px between labels in the same lane
const NL_LANE_ORDER  = [1, 2, 3, 4, 5, 6, 7, 8]; // above-baseline only

function lpToX(lp) {
  const usable = NL_TRACK_WIDTH - NL_PADDING_LEFT - NL_PADDING_RIGHT;
  return NL_PADDING_LEFT + (Math.min(lp, NL_LP_MAX) / NL_LP_MAX) * usable;
}

// Greedy lane assignment — only above-baseline lanes
function nlAssignLanes(items) {
  const laneLastX = {};
  const sorted = [...items].sort((a, b) => a.x - b.x);
  for (const item of sorted) {
    let placed = false;
    for (const lane of NL_LANE_ORDER) {
      if (laneLastX[lane] === undefined || item.x - laneLastX[lane] >= NL_MIN_X_GAP) {
        item.lane = lane;
        laneLastX[lane] = item.x;
        placed = true;
        break;
      }
    }
    if (!placed) item.lane = NL_LANE_ORDER[NL_LANE_ORDER.length - 1];
  }
}

// Render one horizontal track for a group of players
function renderNLTrack(players, title) {
  if (players.length === 0) return '';

  const items = players.map(p => ({ p, x: lpToX(p.totalLP) }));
  nlAssignLanes(items);

  const maxLane = items.reduce((m, i) => Math.max(m, i.lane), 1);
  const baselineY = 20 + maxLane * (NL_LABEL_H + NL_LABEL_V_GAP);
  const trackH = baselineY + 50;

  let html = `<div class="nl-track-title">${title}</div>`;
  html += `<div class="nl-track-section" style="height:${trackH}px;">`;

  // Baseline
  html += `<div class="nl-baseline" style="top:${baselineY}px;"></div>`;

  // Tier zones & labels
  NL_ZONES.forEach(zone => {
    const x1 = lpToX(zone.start);
    const x2 = lpToX(zone.end);
    const w  = x2 - x1;
    html += `<div class="nl-zone" style="left:${x1}px;width:${w}px;top:${baselineY - 10}px;background:${zone.color}18;border-bottom:2px solid ${zone.color}55;"></div>`;
    html += `<div class="nl-tier-label" style="left:${x1}px;top:${baselineY + 16}px;color:${zone.color};">${zone.tier}</div>`;
  });

  // Iron— label on far left
  html += `<div class="nl-tier-label nl-tier-label-left" style="left:${NL_PADDING_LEFT}px;top:${baselineY + 16}px;color:#6b6b6b;">Iron—</div>`;

  // Players
  items.forEach(({ p, x, lane }) => {
    const color = getTierColor(p.tier);
    const badgeStr = `${p.totalLP} LP`;
    const labelTop = baselineY - lane * (NL_LABEL_H + NL_LABEL_V_GAP);
    const connTop = labelTop + NL_LABEL_H;
    const connH = baselineY - connTop;
    const dotTop = baselineY - 7;

    html += `
      <div class="nl-player-label" style="left:${x}px;top:${labelTop}px;">
        <span class="nl-player-name">${escHtml(p.gameName)}</span>
        <span class="nl-player-tier" style="color:${color};">${badgeStr}</span>
      </div>
      ${connH > 0 ? `<div class="nl-connector" style="left:${x}px;top:${connTop}px;height:${connH}px;"></div>` : ''}
      <div class="nl-dot" style="left:${x}px;top:${dotTop}px;background:${color};" title="${escHtml(p.gameName)} — ${badgeStr}"></div>`;
  });

  html += `</div>`;
  return html;
}

function renderNumberLineTab() {
  const track = document.getElementById('numberline-track');
  if (!track) return;

  const players = [...enrichedPlayers]
    .filter(p => !p.loading && !p.error && p.tier && p.tier !== 'UNRANKED')
    .sort((a, b) => (b.totalLP || 0) - (a.totalLP || 0));

  if (players.length === 0) {
    track.style.height = '200px';
    track.innerHTML = `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--text-muted);font-size:13px;">No ranked players to display</div>`;
    return;
  }

  const mid = Math.ceil(players.length / 2);
  const topGroup    = players.slice(0, mid);   // higher LP
  const bottomGroup = players.slice(mid);       // lower LP

  track.style.height = 'auto';
  track.innerHTML =
    renderNLTrack(topGroup, 'Higher LP') +
    `<div class="nl-track-divider"></div>` +
    renderNLTrack(bottomGroup, 'Lower LP');

  const scrollEl = document.getElementById('numberline-scroll');
  scrollEl.scrollLeft = scrollEl.scrollWidth;
}

/* ─── Add / Remove Player ────────────────────────────────────────────────────── */
async function addPlayer(riotId) {
  const hashIdx = riotId.lastIndexOf('#');
  if (hashIdx === -1 || hashIdx === 0 || hashIdx === riotId.length - 1) {
    throw new Error('Use format: GameName#TAG');
  }

  const gameName = riotId.slice(0, hashIdx).trim();
  const tagLine  = riotId.slice(hashIdx + 1).trim();

  if (!gameName || !tagLine) throw new Error('Use format: GameName#TAG');

  // Validate with Riot API first
  const data = await fetchPlayerData(gameName, tagLine);
  await fetchLPHistory();

  // Save to shared list (throws if already added)
  await addPlayerToList(data.gameName, data.tagLine);

  // Fetch champions immediately on add
  await getDDragonVersion();
  let cached = getCachedChampions(data.gameName, data.tagLine);
  if (cached === null && data.puuid) {
    cached = await fetchChampions(data.puuid);
    cacheChampions(data.gameName, data.tagLine, cached.champions, cached.streak, cached.roles);
  }
  data.champions = cached?.champions || [];
  data.streak = cached?.streak || null;
  data.roles = cached?.roles || [];

  upsertPlayer(data);
  recordLPSnapshot(data.gameName, data.tagLine, data.totalLP);
  renderLeaderboard();
}

async function removePlayer(gameName, tagLine) {
  await removePlayerFromList(gameName, tagLine);
  removePlayerFromState(gameName, tagLine);
  renderLeaderboard();
  if (activeTab === 'rankings') renderRankingsTab();
  if (activeTab === 'numberline') renderNumberLineTab();
}

/* ─── Modal ──────────────────────────────────────────────────────────────────── */
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('input-riot-id').value = '';
  hideModalError();
  setTimeout(() => document.getElementById('input-riot-id').focus(), 50);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function showModalError(msg) {
  const el = document.getElementById('modal-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideModalError() {
  document.getElementById('modal-error').classList.add('hidden');
}

async function handleModalConfirm() {
  const input = document.getElementById('input-riot-id').value.trim();
  const confirmBtn = document.getElementById('btn-modal-confirm');

  if (!input) { showModalError('Enter a Riot ID'); return; }

  hideModalError();
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Adding...';

  try {
    await addPlayer(input);
    closeModal();
  } catch (err) {
    showModalError(err.message);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Add Player';
  }
}

/* ─── HTML Escape ────────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── Event Listeners ────────────────────────────────────────────────────────── */
function setupEventListeners() {
  document.getElementById('btn-add-player').addEventListener('click', openModal);
  document.getElementById('btn-refresh-all').addEventListener('click', refreshAll);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-modal-confirm').addEventListener('click', handleModalConfirm);

  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.getElementById('input-riot-id').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleModalConfirm();
    if (e.key === 'Escape') closeModal();
  });

  // Card event delegation (remove + star + graph toggle)
  document.getElementById('leaderboard').addEventListener('click', e => {
    const removeBtn = e.target.closest('.btn-remove');
    if (removeBtn) {
      removePlayer(removeBtn.dataset.gameName, removeBtn.dataset.tagLine);
      return;
    }

    const starBtn = e.target.closest('.btn-star');
    if (starBtn) {
      toggleStar(starBtn.dataset.gameName, starBtn.dataset.tagLine);
      renderLeaderboard();
      return;
    }

    const graphBtn = e.target.closest('.btn-graph-toggle');
    if (graphBtn) {
      const panel = document.getElementById(`graph-${graphBtn.dataset.graphKey}`);
      if (panel) panel.classList.toggle('open');
    }
  });

  // Filter dropdown
  document.getElementById('filter-select').addEventListener('change', e => {
    viewMode = e.target.value;
    renderLeaderboard();
  });

  // Toggle LP History
  document.getElementById('btn-toggle-lp-history').addEventListener('click', () => {
    lpHistoryOpen = !lpHistoryOpen;
    document.querySelectorAll('.graph-panel').forEach(p => p.classList.toggle('open', lpHistoryOpen));
  });

  // Number line arrows
  document.getElementById('nl-left').addEventListener('click', () => {
    document.getElementById('numberline-scroll').scrollBy({ left: -window.innerWidth, behavior: 'smooth' });
  });
  document.getElementById('nl-right').addEventListener('click', () => {
    document.getElementById('numberline-scroll').scrollBy({ left: window.innerWidth, behavior: 'smooth' });
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === activeTab) return;
      activeTab = tab;

      document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tab));
      document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `tab-${tab}`));

      document.querySelector('main').style.display = tab === 'numberline' ? 'none' : '';

      if (tab === 'rankings') renderRankingsTab();
      if (tab === 'numberline') renderNumberLineTab();
    });
  });
}

/* ─── Suggestion Widget ──────────────────────────────────────────────────────── */
function setupSuggestionWidget() {
  const fab     = document.getElementById('suggestion-fab');
  const panel   = document.getElementById('suggestion-panel');
  const close   = document.getElementById('suggestion-close');
  const submit  = document.getElementById('suggestion-submit');
  const textarea = document.getElementById('suggestion-text');
  const status  = document.getElementById('suggestion-status');

  fab.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) textarea.focus();
  });

  close.addEventListener('click', () => panel.classList.add('hidden'));

  submit.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) return;

    submit.disabled = true;
    submit.textContent = 'Sending...';
    status.className = 'hidden';

    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion: text })
      });

      if (res.ok) {
        textarea.value = '';
        status.textContent = 'Suggestion sent!';
        status.className = 'success';
        setTimeout(() => panel.classList.add('hidden'), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        status.textContent = data.error || 'Failed to send. Try again.';
        status.className = 'error';
      }
    } catch {
      status.textContent = 'Network error. Try again.';
      status.className = 'error';
    }

    submit.disabled = false;
    submit.textContent = 'Send';
  });
}

/* ─── Init ───────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupSuggestionWidget();
  getDDragonVersion(); // warm up version cache
  refreshAll();
});
