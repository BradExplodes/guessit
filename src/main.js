import { io } from 'socket.io-client';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
const API = API_BASE ? `${API_BASE.replace(/\/$/, '')}/api` : '/api';
let socket = null;
let state = null;
let lobbyId = null;
let playerId = null;
let hostPassword = null;

function getEl(id) {
  return document.getElementById(id);
}

function render() {
  const app = getEl('app');
  if (!app) return;

  if (!lobbyId || !playerId) {
    app.innerHTML = renderHome();
    bindHome();
    return;
  }

  if (!state) {
    app.innerHTML = '<p class="subtitle">Connecting…</p>';
    return;
  }

  app.innerHTML = renderLobby();
  bindLobby();
}

function renderHome() {
  return `
    <h1>Who Am I?</h1>
    <p class="subtitle">Create or join a lobby to play. Use Discord to ask each other questions!</p>
    <div class="card">
      <h2 style="margin:0 0 1rem; font-size:1.1rem;">Create lobby</h2>
      <div id="create-error" class="error" style="display:none;"></div>
      <label>Lobby name</label>
      <input type="text" id="create-name" placeholder="e.g. Saturday Night" />
      <label>Password</label>
      <input type="password" id="create-password" placeholder="••••••" />
      <label>Your name</label>
      <input type="text" id="create-player" placeholder="How others see you" />
      <button class="btn" id="btn-create">Create & join</button>
    </div>
    <div class="card">
      <h2 style="margin:0 0 1rem; font-size:1.1rem;">Join lobby</h2>
      <p class="subtitle" style="margin-bottom:0.75rem; font-size:0.85rem;">Use the <strong>exact game link</strong> the host shared (same URL in your address bar).</p>
      <div id="join-error" class="error" style="display:none;"></div>
      <label>Lobby name</label>
      <input type="text" id="join-name" placeholder="Same name as host" />
      <label>Password</label>
      <input type="password" id="join-password" placeholder="••••••" />
      <label>Your name</label>
      <input type="text" id="join-player" placeholder="Your display name" />
      <button class="btn btn-secondary" id="btn-join">Join</button>
    </div>
  `;
}

function bindHome() {
  getEl('btn-create')?.addEventListener('click', async () => {
    const name = getEl('create-name')?.value?.trim();
    const password = getEl('create-password')?.value;
    const playerName = getEl('create-player')?.value?.trim();
    const errEl = getEl('create-error');
    errEl.style.display = 'none';
    if (!name || !password || !playerName) {
      errEl.textContent = 'Fill in lobby name, password, and your name';
      errEl.style.display = 'block';
      return;
    }
    try {
      const res = await fetch(`${API}/lobby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password, playerName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      lobbyId = data.lobbyId;
      playerId = data.playerId;
      hostPassword = password;
      localStorage.setItem('guessit_lobbyId', lobbyId);
      localStorage.setItem('guessit_playerId', playerId);
      connectSocket();
      fetchState();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });

  getEl('btn-join')?.addEventListener('click', async () => {
    const lobbyName = getEl('join-name')?.value?.trim();
    const password = getEl('join-password')?.value;
    const playerName = getEl('join-player')?.value?.trim();
    const errEl = getEl('join-error');
    errEl.style.display = 'none';
    if (!lobbyName || !password || !playerName) {
      errEl.textContent = 'Fill in lobby name, password, and your name';
      errEl.style.display = 'block';
      return;
    }
    try {
      const res = await fetch(`${API}/lobby/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobbyName, password, playerName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Join failed');
      lobbyId = data.lobbyId;
      playerId = data.playerId;
      localStorage.setItem('guessit_lobbyId', lobbyId);
      localStorage.setItem('guessit_playerId', playerId);
      connectSocket();
      fetchState();
    } catch (e) {
      const isNetworkError = e.name === 'TypeError' && (e.message === 'Failed to fetch' || e.message.includes('fetch'));
      errEl.textContent = isNetworkError
        ? "Can't reach the server. Open the exact game link the host shared (same URL in your browser). If on another device, use the host's Network URL (e.g. http://192.168.x.x:5173)."
        : e.message;
      errEl.style.display = 'block';
    }
  });
}

function connectSocket() {
  if (socket) socket.disconnect();
  socket = API_BASE
    ? io(API_BASE.replace(/\/$/, ''), { path: '/socket.io', transports: ['websocket', 'polling'] })
    : io({ path: '/socket.io', transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    socket.emit('join-lobby', { lobbyId, playerId });
  });
  socket.on('state', (s) => {
    state = s;
    render();
  });
  socket.on('error', (e) => {
    if (e?.message) alert(e.message);
  });
  socket.on('guess-result', (r) => {
    state = { ...state };
    render();
    const app = getEl('app');
    const div = document.createElement('div');
    div.className = `guess-result ${r.correct ? 'correct' : 'wrong'}`;
    div.textContent = r.correct ? `Correct! You got it in ${r.roundsUsed} round(s).` : 'Not quite — try again next turn!';
    const form = app.querySelector('.guess-form');
    if (form) form.after(div);
    else app.querySelector('.card')?.append(div);
    setTimeout(() => div.remove(), 3000);
  });
}

async function fetchState() {
  try {
    const res = await fetch(`${API}/lobby/${lobbyId}?playerId=${encodeURIComponent(playerId || '')}`);
    if (!res.ok) return;
    state = await res.json();
    render();
  } catch (_) {
    render();
  }
}

function renderLobby() {
  const phase = state.phase;
  const me = state.players?.find(p => p.isYou);
  const currentName = state.players?.find(p => p.id === state.currentTurnPlayerId)?.name;

  let main = '';
  if (phase === 'waiting') {
    main = `
      <p class="lobby-name-display">Lobby: <strong>${escapeHtml(state.name)}</strong></p>
      <ul class="players-list">
        ${(state.players || []).map(p => `
          <li class="${p.isYou ? 'is-you' : ''}">
            <span>${escapeHtml(p.name)} ${p.isYou ? ' (you)' : ''}</span>
          </li>
        `).join('')}
      </ul>
      ${state.canStart ? '<button class="btn" id="btn-start">Start game</button>' : '<p class="subtitle">Waiting for host to start (need at least 2 players).</p>'}
      <p class="subtitle" style="margin-top:1rem; font-size:0.85rem;"><strong>Multiplayer:</strong> Everyone must open the same game link. Copy the link below and share it. If friends are on other devices, open this page via your network URL (e.g. http://192.168.1.x:5173) first, then copy that link.</p>
      <button class="btn btn-secondary" id="btn-copy-link">Copy game link</button>
      ${state.canStart && hostPassword ? ` <button class="btn btn-secondary" id="btn-copy-invite">Copy lobby name &amp; password</button>` : ''}
    `;
  } else if (phase === 'assigning') {
    const target = state.assigningTarget;
    main = `
      <p class="lobby-name-display">Lobby: <strong>${escapeHtml(state.name)}</strong></p>
      ${target
        ? `
        <p class="subtitle">Enter the word (e.g. celebrity, character) for the player below. It will appear on their "forehead" for others to see.</p>
        <label>Word for <strong>${escapeHtml(target.playerName)}</strong></label>
        <div class="guess-form">
          <input type="text" id="assign-word" placeholder="e.g. Einstein" />
          <button class="btn" id="btn-assign">Submit</button>
        </div>
        `
        : '<p class="subtitle">You’ve submitted your word. Waiting for others…</p>'}
    `;
  } else if (phase === 'guessing' || phase === 'finished') {
    const isMyTurn = me?.isCurrentTurn;
    main = `
      <p class="lobby-name-display">Lobby: <strong>${escapeHtml(state.name)}</strong></p>
      ${phase === 'finished'
        ? '<div class="finished-banner">Everyone has guessed their word! Game over.</div>'
        : isMyTurn
          ? '<div class="turn-banner you">Your turn — guess the name on your forehead!</div>'
          : `<div class="turn-banner">${escapeHtml(currentName || '')}’s turn</div>`}
      <ul class="players-list">
        ${(state.players || []).map(p => `
          <li class="${p.isYou ? 'is-you ' : ''}${p.isCurrentTurn ? 'is-turn' : ''}">
            <span>${escapeHtml(p.name)} ${p.isYou ? ' (you)' : ''}</span>
            <span>
              ${p.hasWon ? `<span class="badge badge-won">Won</span> <span class="badge badge-rounds">${p.roundsToWin} round(s)</span>` : (p.isCurrentTurn ? '<span class="badge">Guessing…</span>' : '')}
            </span>
          </li>
        `).join('')}
      </ul>
      ${state.myAssignedWord ? `<p class="subtitle">Your word was: <strong>${escapeHtml(state.myAssignedWord)}</strong></p>` : ''}
      ${phase === 'guessing' && isMyTurn ? `
        <div class="guess-form">
          <input type="text" id="guess-input" placeholder="Your guess" />
          <button class="btn" id="btn-guess">Guess</button>
        </div>
      ` : ''}
      <div class="notes-section card">
        <label>Your notes</label>
        <textarea id="notes-field" placeholder="Jot down clues from Discord…">${escapeHtml(state.myNotes || '')}</textarea>
        <button class="btn btn-secondary" id="btn-save-notes">Save notes</button>
      </div>
    `;
  } else {
    main = '<p class="subtitle">Loading…</p>';
  }

  return `
    <h1>Who Am I?</h1>
    <div class="card">
      ${main}
    </div>
    <p style="margin-top:1rem;"><button class="btn btn-secondary" id="btn-leave">Leave lobby</button></p>
  `;
}

function bindLobby() {
  getEl('btn-start')?.addEventListener('click', () => {
    socket?.emit('start-game', { lobbyId, playerId });
  });
  getEl('btn-copy-link')?.addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => alert('Game link copied! Share this URL so others open the same game.'), () => alert('Could not copy'));
  });
  getEl('btn-copy-invite')?.addEventListener('click', () => {
    const text = `Lobby: ${state.name}\nPassword: ${hostPassword || '(set when creating)'}`;
    navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard!'), () => alert('Could not copy'));
  });
  getEl('btn-assign')?.addEventListener('click', () => {
    const word = getEl('assign-word')?.value?.trim();
    if (!word) return;
    socket?.emit('submit-assignment', { lobbyId, playerId, word });
  });
  getEl('btn-guess')?.addEventListener('click', () => {
    const guess = getEl('guess-input')?.value?.trim();
    if (!guess) return;
    socket?.emit('submit-guess', { lobbyId, playerId, guess });
  });
  getEl('btn-save-notes')?.addEventListener('click', () => {
    const notes = getEl('notes-field')?.value ?? '';
    socket?.emit('update-notes', { lobbyId, playerId, notes });
  });
  getEl('btn-leave')?.addEventListener('click', () => {
    if (socket) socket.disconnect();
    socket = null;
    state = null;
    lobbyId = null;
    playerId = null;
    hostPassword = null;
    localStorage.removeItem('guessit_lobbyId');
    localStorage.removeItem('guessit_playerId');
    render();
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

const params = new URLSearchParams(location.search);
lobbyId = params.get('lobby') || localStorage.getItem('guessit_lobbyId');
playerId = params.get('player') || localStorage.getItem('guessit_playerId');
if (lobbyId && playerId) {
  connectSocket();
  fetchState();
}
render();
