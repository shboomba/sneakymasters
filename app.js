/* ─── Constants ──────────────────────────────────────────────────────────────── */
const STORAGE_KEY = 'rtm_players';
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

const MASTERS_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

/* ─── In-Memory State ────────────────────────────────────────────────────────── */
// Array of enriched player objects (rebuilt each refresh)
let enrichedPlayers = [];

/* ─── LP Math ────────────────────────────────────────────────────────────────── */
function computeTotalLP(tier, rank, lp) {
  if (!tier || tier === 'UNRANKED') return 0;
  if (MASTERS_TIERS.has(tier)) return MASTERS_THRESHOLD + (lp || 0);
  return (TIER_BASE[tier] ?? 0) + (DIVISION_BASE[rank] ?? 0) + (lp || 0);
}

function computeProgressPct(totalLP) {
  return Math.min((totalLP / MASTERS_THRESHOLD) * 100, 100);
}

/* ─── LocalStorage ───────────────────────────────────────────────────────────── */
function loadPlayers() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function savePlayers(players) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}

/* ─── API ────────────────────────────────────────────────────────────────────── */
async function fetchPlayerData(gameName, tagLine) {
  const url = `/api/summoner?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }

  const totalLP = computeTotalLP(data.tier, data.rank, data.leaguePoints);
  const progressPct = computeProgressPct(totalLP);
  const totalGames = data.wins + data.losses;
  const winRate = totalGames > 0 ? ((data.wins / totalGames) * 100).toFixed(1) : null;
  const atMasters = MASTERS_TIERS.has(data.tier);

  return {
    gameName: data.gameName,
    tagLine: data.tagLine,
    tier: data.tier,
    rank: data.rank,
    leaguePoints: data.leaguePoints,
    wins: data.wins,
    losses: data.losses,
    totalLP,
    progressPct,
    winRate,
    atMasters,
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
    // Preserve stale rank data if refresh fails but we had prior data
    if (data.error && enrichedPlayers[idx].tier) {
      enrichedPlayers[idx] = { ...enrichedPlayers[idx], loading: false, error: data.error };
    } else {
      enrichedPlayers[idx] = data;
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

/* ─── Rendering ──────────────────────────────────────────────────────────────── */
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

  // Sort: atMasters first, then by totalLP desc, loading/error cards go to bottom
  const sorted = [...enrichedPlayers].sort((a, b) => {
    if (a.loading && !b.loading) return 1;
    if (!a.loading && b.loading) return -1;
    return (b.totalLP || 0) - (a.totalLP || 0);
  });

  board.innerHTML = sorted.map((player, i) => renderCard(player, i + 1)).join('');
}

function renderCard(player, position) {
  const tier = player.tier || 'UNRANKED';
  const rankClasses = ['rank-first', 'rank-second', 'rank-third'];
  const rankClass = position <= 3 ? rankClasses[position - 1] : '';
  const posLabel = `#${position}`;

  if (player.loading) {
    return `
      <div class="player-card card-loading" data-tier="UNRANKED">
        <div class="card-header">
          <div class="card-rank-badge">${posLabel}</div>
          <div class="card-identity">
            <div class="skeleton skeleton-name"></div>
            <div class="skeleton skeleton-tag"></div>
          </div>
        </div>
        <div class="skeleton skeleton-badge"></div>
        <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
      </div>`;
  }

  const tierDisplay = player.atMasters
    ? `${TIER_DISPLAY[tier]}`
    : tier === 'UNRANKED'
    ? 'Unranked'
    : `${TIER_DISPLAY[tier]} ${player.rank || ''}`;

  const lpDisplay = player.atMasters
    ? `${player.leaguePoints} LP`
    : tier === 'UNRANKED'
    ? '—'
    : `${player.leaguePoints} LP`;

  const totalGames = (player.wins || 0) + (player.losses || 0);
  const recordHtml = totalGames > 0
    ? `${player.wins}W / ${player.losses}L &mdash; <span class="win-rate ${player.winRate >= 50 ? 'positive' : 'negative'}">${player.winRate}% WR</span>`
    : 'No games played';

  const progressLabelLeft = player.atMasters
    ? `Masters — ${player.leaguePoints} LP`
    : `${player.totalLP} / ${MASTERS_THRESHOLD} LP`;

  const progressLabelRight = `<span class="progress-pct">${player.progressPct.toFixed(1)}%</span>`;

  const mastersBanner = player.atMasters
    ? `<div class="masters-banner">&#9733; Reached ${TIER_DISPLAY[tier]}!</div>`
    : '';

  const errorMsg = player.error
    ? `<div class="card-error-msg">&#9888; ${player.error}</div>`
    : '';

  return `
    <div class="player-card ${rankClass}" data-tier="${tier}" data-game-name="${escHtml(player.gameName)}" data-tag-line="${escHtml(player.tagLine)}">
      <div class="card-header">
        <div class="card-rank-badge">${posLabel}</div>
        <div class="card-identity">
          <div class="card-game-name">${escHtml(player.gameName)}</div>
          <div class="card-tag-line">#${escHtml(player.tagLine)}</div>
        </div>
        <button class="btn-remove" data-game-name="${escHtml(player.gameName)}" data-tag-line="${escHtml(player.tagLine)}" title="Remove player">&#10005;</button>
      </div>
      <div class="card-rank-info">
        <span class="tier-badge">${tierDisplay}</span>
        <span class="lp-display">${lpDisplay}</span>
      </div>
      <div class="card-record">${recordHtml}</div>
      <div class="progress-section">
        <div class="progress-label">
          <span>${progressLabelLeft}</span>
          ${progressLabelRight}
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${player.progressPct}%"></div>
        </div>
      </div>
      ${mastersBanner}
      ${errorMsg}
    </div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── Refresh ────────────────────────────────────────────────────────────────── */
async function refreshAll() {
  const players = loadPlayers();
  if (players.length === 0) {
    renderLeaderboard();
    return;
  }

  const refreshBtn = document.getElementById('btn-refresh-all');
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing...';

  // Set all to loading state first
  for (const p of players) {
    const existing = enrichedPlayers.find(e => playerKey(e.gameName, e.tagLine) === playerKey(p.gameName, p.tagLine));
    if (!existing) {
      upsertPlayer({ gameName: p.gameName, tagLine: p.tagLine, loading: true, totalLP: 0, progressPct: 0 });
    } else {
      existing.loading = true;
    }
  }
  renderLeaderboard();

  // Fetch sequentially to respect rate limits
  for (const p of players) {
    try {
      const data = await fetchPlayerData(p.gameName, p.tagLine);
      upsertPlayer(data);
    } catch (err) {
      upsertPlayer({ gameName: p.gameName, tagLine: p.tagLine, loading: false, error: err.message, totalLP: 0, progressPct: 0 });
    }
    renderLeaderboard();
  }

  refreshBtn.disabled = false;
  refreshBtn.textContent = 'Refresh All';
}

/* ─── Add Player ─────────────────────────────────────────────────────────────── */
async function addPlayer(riotId) {
  const hashIdx = riotId.lastIndexOf('#');
  if (hashIdx === -1 || hashIdx === 0 || hashIdx === riotId.length - 1) {
    throw new Error('Use format: GameName#TAG');
  }

  const gameName = riotId.slice(0, hashIdx).trim();
  const tagLine = riotId.slice(hashIdx + 1).trim();

  if (!gameName || !tagLine) {
    throw new Error('Use format: GameName#TAG');
  }

  const players = loadPlayers();
  const key = playerKey(gameName, tagLine);
  if (players.some(p => playerKey(p.gameName, p.tagLine) === key)) {
    throw new Error('Player already added');
  }

  const data = await fetchPlayerData(gameName, tagLine);

  players.push({ gameName: data.gameName, tagLine: data.tagLine });
  savePlayers(players);
  upsertPlayer(data);
  renderLeaderboard();
}

function removePlayer(gameName, tagLine) {
  const players = loadPlayers().filter(p => playerKey(p.gameName, p.tagLine) !== playerKey(gameName, tagLine));
  savePlayers(players);
  removePlayerFromState(gameName, tagLine);
  renderLeaderboard();
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

  if (!input) {
    showModalError('Enter a Riot ID');
    return;
  }

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

/* ─── Event Listeners ────────────────────────────────────────────────────────── */
function setupEventListeners() {
  document.getElementById('btn-add-player').addEventListener('click', openModal);
  document.getElementById('btn-refresh-all').addEventListener('click', refreshAll);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-modal-confirm').addEventListener('click', handleModalConfirm);

  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Close modal on Escape, confirm on Enter
  document.getElementById('input-riot-id').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleModalConfirm();
    if (e.key === 'Escape') closeModal();
  });

  // Event delegation for remove buttons
  document.getElementById('leaderboard').addEventListener('click', e => {
    const btn = e.target.closest('.btn-remove');
    if (btn) {
      removePlayer(btn.dataset.gameName, btn.dataset.tagLine);
    }
  });
}

/* ─── Init ───────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  refreshAll();
});
