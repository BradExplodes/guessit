import { io } from 'socket.io-client';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
const API = API_BASE ? `${API_BASE.replace(/\/$/, '')}/api` : '/api';
let socket = null;
let state = null;
let lobbyId = null;
let playerId = null;
let hostPassword = null;
let turnCountdownIntervalId = null;

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
    const msg = e?.message || '';
    if (msg === 'Lobby not found' || msg === 'Player not found') {
      if (socket) socket.disconnect();
      socket = null;
      state = null;
      lobbyId = null;
      playerId = null;
      hostPassword = null;
      localStorage.removeItem('guessit_lobbyId');
      localStorage.removeItem('guessit_playerId');
      render();
    }
    if (msg) alert(msg);
  });
  socket.on('guess-result', (r) => {
    state = { ...state };
    render();
    const app = getEl('app');
    const div = document.createElement('div');
    div.className = `guess-result ${r.correct ? 'correct' : 'wrong'}`;
    const placementStr = r.placement ? ordinal(r.placement) : '';
    div.textContent = r.correct
      ? (placementStr ? `Correct! You got ${placementStr} place in ${r.roundsUsed} round(s).` : `Correct! You got it in ${r.roundsUsed} round(s).`)
      : 'Not quite — try again next turn!';
    const form = app.querySelector('.guess-form');
    if (form) form.after(div);
    else app.querySelector('.card')?.append(div);
    setTimeout(() => div.remove(), 3000);
  });
}

async function fetchState() {
  try {
    const res = await fetch(`${API}/lobby/${lobbyId}?playerId=${encodeURIComponent(playerId || '')}`);
    if (res.status === 404) {
      state = null;
      lobbyId = null;
      playerId = null;
      localStorage.removeItem('guessit_lobbyId');
      localStorage.removeItem('guessit_playerId');
      render();
      return;
    }
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

  let main = '';
  if (phase === 'waiting') {
    const isHost = state.isHost;
    const allReady = (state.players || []).every(p => p.ready);
    const me = state.players?.find(p => p.isYou);
    main = `
      <p class="lobby-name-display">Lobby: <strong>${escapeHtml(state.name)}</strong></p>
      ${me && state.nextPlayerForWord && (state.players?.length || 0) >= 2 ? `
      <div class="character-section card">
        <label>Word for <strong>${escapeHtml(state.nextPlayerForWord.playerName)}</strong></label>
        <p class="subtitle" style="margin:0 0 0.5rem; font-size:0.85rem;">The word that will go on their forehead. You can change this until you ready up.</p>
        <div class="character-row">
          <input type="text" id="word-for-next-input" placeholder="e.g. Einstein" value="${escapeHtml(state.myWordForNext || '')}" />
          <button class="btn ${me.ready ? 'btn-secondary' : ''}" id="btn-ready">${me.ready ? 'Unready' : 'Ready'}</button>
        </div>
      </div>
      ` : ''}
      ${isHost ? '<p class="subtitle" style="margin-bottom:0.5rem; font-size:0.85rem;">Order = who assigns for whom (first assigns for second, etc). Drag to reorder.</p>' : ''}
      <ul class="players-list ${isHost ? 'players-list-draggable' : ''}" id="waiting-players-list">
        ${(state.players || []).map((p, idx) => `
          <li class="${p.isYou ? 'is-you' : ''} ${isHost ? 'draggable' : ''}" data-player-id="${escapeHtml(p.id)}" ${isHost ? 'draggable="true"' : ''}>
            ${isHost ? '<span class="drag-handle" aria-hidden="true">⋮⋮</span>' : ''}
            <span>${escapeHtml(p.name)} ${p.isYou ? ' (you)' : ''}</span>
            <span class="ready-badge ${p.ready ? 'ready' : ''}">${p.ready ? '✓ Ready' : 'Not ready'}</span>
          </li>
        `).join('')}
      </ul>
      ${isHost ? '<div class="lobby-order-actions"><button class="btn btn-secondary" id="btn-random-order">Random order</button></div>' : ''}
      ${state.canStart ? '<button class="btn" id="btn-start">Start game</button>' : allReady ? '<p class="subtitle">Waiting for host to start.</p>' : '<p class="subtitle">Everyone must ready up before the host can start.</p>'}
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
          <input type="text" id="assign-word" placeholder="e.g. Einstein" value="${escapeHtml(state.preFilledWord || '')}" />
          <button class="btn" id="btn-assign">Submit</button>
        </div>
        `
        : '<p class="subtitle">You’ve submitted your word. Waiting for others…</p>'}
    `;
  } else if (phase === 'guessing' || phase === 'finished') {
    const isMyTurn = me?.isCurrentTurn;
    const placements = getPlacements(state.players || []);
    const turnSecondsLeft = state.turnStartedAt && phase === 'guessing'
      ? Math.max(0, 60 - Math.floor((Date.now() - state.turnStartedAt) / 1000))
      : null;
    const currentPlayer = state.players?.find(p => p.id === state.currentTurnPlayerId);
    const currentDisplayName = currentPlayer ? currentPlayer.name : '';
    main = `
      <p class="lobby-name-display">Lobby: <strong>${escapeHtml(state.name)}</strong></p>
      ${phase === 'finished'
        ? '<div class="finished-banner">Everyone has guessed their word! Game over.</div>'
        : isMyTurn
          ? '<div class="turn-banner you">Your turn — guess the name on your forehead!</div>'
          : `<div class="turn-banner">${escapeHtml(currentDisplayName)}'s turn</div>`}
      ${turnSecondsLeft != null ? `<p class="turn-timer">Time left: <strong id="turn-countdown">${turnSecondsLeft}</strong>s</p>` : ''}
      ${state.lastWrongGuess ? `<p class="wrong-guess-msg">${escapeHtml(state.lastWrongGuess.playerName)} guessed "${escapeHtml(state.lastWrongGuess.guess)}" — wrong!</p>` : ''}
      <ul class="players-list">
        ${(state.players || []).map(p => {
          const place = placements.get(p.id);
          return `
          <li class="${p.isYou ? 'is-you ' : ''}${p.isCurrentTurn ? 'is-turn' : ''}">
            <span>${escapeHtml(p.name)} ${p.isYou ? ' (you)' : ''}</span>
            <span>
              ${p.hasWon && place != null ? `<span class="badge badge-won">${ordinal(place)}</span> <span class="badge badge-rounds">${p.roundsToWin} round(s)</span>` : (p.isCurrentTurn ? '<span class="badge">Guessing…</span>' : '')}
            </span>
            ${p.word != null ? `<span class="player-word">${escapeHtml(p.word)}</span>` : ''}
          </li>
        `}).join('')}
      </ul>
      ${state.myAssignedWord ? `<p class="subtitle">Your word was: <strong>${escapeHtml(state.myAssignedWord)}</strong></p>` : ''}
      ${phase === 'guessing' && isMyTurn ? `
        <div class="guess-form">
          <input type="text" id="guess-input" placeholder="Your guess" autocomplete="off" />
          <button class="btn" id="btn-guess">Guess</button>
          <button class="btn btn-secondary" id="btn-skip">Skip</button>
        </div>
      ` : ''}
      ${phase === 'finished' && state.isHost ? `<button class="btn" id="btn-return-lobby">Return to lobby</button>` : ''}
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
  if (turnCountdownIntervalId) {
    clearInterval(turnCountdownIntervalId);
    turnCountdownIntervalId = null;
  }
  const countdownEl = getEl('turn-countdown');
  if (countdownEl && state?.turnStartedAt && state?.phase === 'guessing') {
    turnCountdownIntervalId = setInterval(() => {
      const el = getEl('turn-countdown');
      if (!el) {
        clearInterval(turnCountdownIntervalId);
        turnCountdownIntervalId = null;
        return;
      }
      const secs = Math.max(0, 60 - Math.floor((Date.now() - state.turnStartedAt) / 1000));
      el.textContent = secs;
    }, 1000);
  }
  const listEl = getEl('waiting-players-list');
  if (listEl && state?.isHost) {
    listEl.addEventListener('dragstart', (e) => {
      const li = e.target.closest('li[data-player-id]');
      if (!li) return;
      e.dataTransfer.setData('text/plain', li.dataset.playerId);
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    listEl.addEventListener('dragend', (e) => {
      e.target.closest('li')?.classList.remove('dragging');
    });
    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      listEl.querySelectorAll('li').forEach(el => el.classList.remove('drag-over'));
      const li = e.target.closest('li[data-player-id]');
      if (li) li.classList.add('drag-over');
    });
    listEl.addEventListener('dragleave', (e) => {
      if (!listEl.contains(e.relatedTarget)) {
        listEl.querySelectorAll('li').forEach(el => el.classList.remove('drag-over'));
      }
    });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      listEl.querySelectorAll('li').forEach(el => el.classList.remove('drag-over'));
      const draggedId = e.dataTransfer.getData('text/plain');
      const dropLi = e.target.closest('li[data-player-id]');
      if (!draggedId || !dropLi || dropLi.dataset.playerId === draggedId) return;
      const items = listEl.querySelectorAll('li[data-player-id]');
      const currentOrder = [...items].map(el => el.dataset.playerId);
      const without = currentOrder.filter(id => id !== draggedId);
      const dropId = dropLi.dataset.playerId;
      const insertIdx = without.indexOf(dropId);
      if (insertIdx === -1) return;
      without.splice(insertIdx, 0, draggedId);
      socket?.emit('reorder-players', { lobbyId, playerId, playerIds: without });
    });
  }
  getEl('word-for-next-input')?.addEventListener('blur', () => {
    const word = getEl('word-for-next-input')?.value?.trim() ?? '';
    socket?.emit('set-word-for-next', { lobbyId, playerId, word });
  });
  getEl('btn-ready')?.addEventListener('click', () => {
    const me = state?.players?.find(p => p.isYou);
    if (!me) return;
    socket?.emit('set-ready', { lobbyId, playerId, ready: !me.ready });
  });
  getEl('btn-random-order')?.addEventListener('click', () => {
    socket?.emit('randomize-order', { lobbyId, playerId });
  });
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
  const submitGuessFromForm = () => {
    const guess = getEl('guess-input')?.value?.trim();
    if (!guess) return;
    socket?.emit('submit-guess', { lobbyId, playerId, guess });
  };
  getEl('btn-guess')?.addEventListener('click', submitGuessFromForm);
  getEl('guess-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitGuessFromForm();
    }
  });
  getEl('btn-skip')?.addEventListener('click', () => {
    socket?.emit('skip-turn', { lobbyId, playerId });
  });
  getEl('btn-return-lobby')?.addEventListener('click', () => {
    socket?.emit('return-to-lobby', { lobbyId, playerId });
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

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getPlacements(players) {
  const won = players.filter(p => p.hasWon && p.roundsToWin != null).sort((a, b) => a.roundsToWin - b.roundsToWin);
  const map = new Map();
  won.forEach((p, i) => map.set(p.id, i + 1));
  return map;
}

const params = new URLSearchParams(location.search);
lobbyId = params.get('lobby') || localStorage.getItem('guessit_lobbyId');
playerId = params.get('player') || localStorage.getItem('guessit_playerId');
if (lobbyId && playerId) {
  connectSocket();
  fetchState();
}
render();
