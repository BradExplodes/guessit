import { io } from 'socket.io-client';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
const API = API_BASE ? `${API_BASE.replace(/\/$/, '')}/api` : '/api';
let socket = null;
let state = null;
let lobbyId = null;
let playerId = null;
let hostPassword = null;
let turnCountdownIntervalId = null;
let lastCountdownSecs = -1;
let gameNotesLocal = null;
let gameNotesCaret = null;
let pendingJoinToken = null;
let createGameType = 'guessit';

function getEl(id) {
  return document.getElementById(id);
}

function render() {
  const app = getEl('app');
  if (!app) return;

  const hashMatch = location.hash.slice(1).match(/^t=([^&]+)/);
  if (hashMatch) {
    pendingJoinToken = decodeURIComponent(hashMatch[1]);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    if (socket) socket.disconnect();
    socket = null;
    state = null;
    lobbyId = null;
    playerId = null;
    localStorage.removeItem('guessit_lobbyId');
    localStorage.removeItem('guessit_playerId');
  }
  if (!lobbyId || !playerId) {
    app.innerHTML = renderHome();
    bindHome();
    return;
  }

  if (!state) {
    app.innerHTML = '<p class="subtitle">Connecting…</p>';
    return;
  }

  let hadNotesFocus = false;
  if (state && (state.phase === 'guessing' || state.phase === 'finished')) {
    const notesEl = getEl('notes-field');
    hadNotesFocus = !!(notesEl && document.activeElement === notesEl);
    if (notesEl) {
      gameNotesLocal = notesEl.value;
      if (hadNotesFocus) {
        gameNotesCaret = {
          start: notesEl.selectionStart ?? 0,
          end: notesEl.selectionEnd ?? 0,
          scrollTop: notesEl.scrollTop ?? 0,
        };
      }
    }
  } else {
    gameNotesLocal = null;
    gameNotesCaret = null;
  }
  app.innerHTML = renderLobby();
  const isGameScreen = state && (
    state.phase === 'guessing' ||
    state.phase === 'wavelength_clue' ||
    state.phase === 'wavelength_guessing' ||
    state.phase === 'finished'
  );
  app.classList.toggle('game-screen', !!isGameScreen);
  bindLobby();
  if (hadNotesFocus) {
    const el = getEl('notes-field');
    if (el) {
      el.focus();
      if (gameNotesCaret) {
        try { el.setSelectionRange(gameNotesCaret.start, gameNotesCaret.end); } catch (_) {}
        try { el.scrollTop = gameNotesCaret.scrollTop; } catch (_) {}
      }
    }
  }
}

function renderHome() {
  if (pendingJoinToken) {
    return `
    <h1>Minigames</h1>
    <p class="subtitle">You opened an invite link. Enter your name to join the lobby.</p>
    <div class="card">
      <h2 style="margin:0 0 1rem; font-size:1.1rem;">Join with invite link</h2>
      <div id="join-by-token-error" class="error" style="display:none;"></div>
      <label>Your name</label>
      <input type="text" id="join-by-token-player" placeholder="Your display name" autofocus />
      <button class="btn" id="btn-join-by-token">Join lobby</button>
      <p class="subtitle" style="margin-top:0.75rem; font-size:0.85rem;"><a href="${escapeHtml(location.pathname + location.search)}" id="join-with-name-link">Join with lobby name &amp; password instead</a></p>
    </div>
  `;
  }
  return `
    <h1>Minigames</h1>
    <p class="subtitle">Create or join a lobby to play. Use Discord for voice/chat if you want.</p>
    <div class="card">
      <h2 style="margin:0 0 1rem; font-size:1.1rem;">Create lobby</h2>
      <div id="create-error" class="error" style="display:none;"></div>
      <label>Lobby name</label>
      <input type="text" id="create-name" placeholder="e.g. Saturday Night" />
      <label>Password</label>
      <input type="password" id="create-password" placeholder="••••••" />
      <label>Game</label>
      <select id="create-game" class="select">
        <option value="guessit">Guess It</option>
        <option value="wavelength">Wavelength</option>
      </select>
      <div id="wavelength-settings" style="display:none;">
        <label>Points to win</label>
        <input type="text" id="create-points-to-win" inputmode="numeric" placeholder="e.g. 10" value="10" />
      </div>
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
  const gameSel = getEl('create-game');
  const wavelengthSettings = getEl('wavelength-settings');
  const syncCreateGameUi = () => {
    const v = gameSel?.value || 'guessit';
    createGameType = v;
    if (wavelengthSettings) wavelengthSettings.style.display = v === 'wavelength' ? 'block' : 'none';
  };
  gameSel?.addEventListener('change', syncCreateGameUi);
  syncCreateGameUi();

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
      const gameType = (getEl('create-game')?.value || 'guessit').trim();
      const pointsToWin = getEl('create-points-to-win')?.value?.trim();
      const settings = gameType === 'wavelength' ? { pointsToWin } : undefined;
      const res = await fetch(`${API}/lobby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password, playerName, gameType, settings }),
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

  getEl('btn-join-by-token')?.addEventListener('click', async () => {
    const playerName = getEl('join-by-token-player')?.value?.trim();
    const errEl = getEl('join-by-token-error');
    errEl.style.display = 'none';
    if (!playerName) {
      errEl.textContent = 'Enter your name';
      errEl.style.display = 'block';
      return;
    }
    if (!pendingJoinToken) {
      errEl.textContent = 'Invite link expired. Use lobby name & password to join.';
      errEl.style.display = 'block';
      return;
    }
    try {
      const res = await fetch(`${API}/lobby/join-by-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinToken: pendingJoinToken, playerName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Join failed');
      pendingJoinToken = null;
      lobbyId = data.lobbyId;
      playerId = data.playerId;
      localStorage.setItem('guessit_lobbyId', lobbyId);
      localStorage.setItem('guessit_playerId', playerId);
      connectSocket();
      fetchState();
    } catch (e) {
      errEl.textContent = e.message || 'Join failed';
      errEl.style.display = 'block';
    }
  });
  getEl('join-by-token-player')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') getEl('btn-join-by-token')?.click();
  });
  getEl('join-with-name-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    pendingJoinToken = null;
    render();
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
        ? "Can't reach the server. Open the exact game link the host shared (the same URL everyone uses to play)."
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

    if (state.gameType === 'wavelength') {
      main = `
        <p class="lobby-name-display">Lobby: <strong>${escapeHtml(state.name)}</strong></p>
        <p class="subtitle" style="margin-bottom:0.75rem;">Game: <strong>Wavelength</strong> • First to <strong>${escapeHtml(String(state.settings?.pointsToWin ?? ''))}</strong> points wins.</p>
        <div class="character-section card">
          <label>Ready status</label>
          <div class="character-row">
            <button class="btn ${me?.ready ? 'btn-secondary' : ''}" id="btn-ready">${me?.ready ? 'Unready' : 'Ready'}</button>
          </div>
        </div>
        ${isHost ? '<p class="subtitle" style="margin-bottom:0.5rem; font-size:0.85rem;">Drag to reorder turn order.</p>' : ''}
        <ul class="players-list ${isHost ? 'players-list-draggable' : ''}" id="waiting-players-list">
          ${(state.players || []).map((p) => `
            <li class="${p.isYou ? 'is-you' : ''} ${isHost ? 'draggable' : ''}" data-player-id="${escapeHtml(p.id)}" ${isHost ? 'draggable="true"' : ''}>
              ${isHost ? '<span class="drag-handle" aria-hidden="true">⋮⋮</span>' : ''}
              <span>${escapeHtml(p.name)} ${p.isYou ? ' (you)' : ''}</span>
              <span class="ready-badge ${p.ready ? 'ready' : ''}">${p.ready ? '✓ Ready' : 'Not ready'}</span>
            </li>
          `).join('')}
        </ul>
        ${isHost ? '<div class="lobby-order-actions"><button class="btn btn-secondary" id="btn-random-order">Random order</button></div>' : ''}
        ${state.canStart ? '<button class="btn" id="btn-start">Start game</button>' : allReady ? '<p class="subtitle">Waiting for host to start.</p>' : '<p class="subtitle">Everyone must ready up before the host can start.</p>'}
        <p class="subtitle" style="margin-top:1rem; font-size:0.85rem;"><strong>Multiplayer:</strong> Everyone must open the same game link. Share an invite link so friends can join with one click (they only enter their name).</p>
        <button class="btn btn-secondary" id="btn-copy-link">Copy game link</button>
        <button class="btn btn-secondary" id="btn-copy-join-link">Copy invite link</button>
        ${state.canStart && hostPassword ? ` <button class="btn btn-secondary" id="btn-copy-invite">Copy lobby name &amp; password</button>` : ''}
      `;
    } else {
      main = `
        <p class="lobby-name-display">Lobby: <strong>${escapeHtml(state.name)}</strong></p>
        ${me && state.nextPlayerForWord && (state.players?.length || 0) >= 2 ? `
        <div class="character-section card">
          <label>Targeting <strong>${escapeHtml(state.nextPlayerForWord.playerName)}</strong></label>
          <p class="subtitle" style="margin:0 0 0.5rem; font-size:0.85rem;">The word that will go on their forehead. You can change this until you ready up.</p>
          <div class="character-row">
            <input type="text" id="word-for-next-input" placeholder="e.g. Einstein" value="${escapeHtml(state.myWordForNext || '')}" />
            <button class="btn ${me.ready ? 'btn-secondary' : ''}" id="btn-ready">${me.ready ? 'Unready' : 'Ready'}</button>
          </div>
        <div class="character-row" style="margin-top:0.75rem;">
          <div style="flex:1;">
            <label style="margin-bottom:0.35rem;">Optional image (jpg/png)</label>
            <input type="file" id="image-for-next-input" accept="image/png,image/jpeg" />
            ${state.myImageForNext ? `<div class="image-preview-row"><img class="character-image-preview" src="${escapeHtml(state.myImageForNext)}" alt="Character preview" /><button class="btn btn-secondary" id="btn-clear-image">Clear image</button></div>` : ''}
          </div>
        </div>
        </div>
        ` : ''}
        ${isHost ? '<p class="subtitle" style="margin-bottom:0.5rem; font-size:0.85rem;">Order = who assigns for whom (first assigns for second, etc). Drag to reorder.</p>' : ''}
        <ul class="players-list ${isHost ? 'players-list-draggable' : ''}" id="waiting-players-list">
          ${(state.players || []).map((p, idx) => {
            const n = state.players.length;
            const nextPlayer = n >= 2 ? state.players[(idx + 1) % n] : null;
            const targetLabel = nextPlayer ? `Targeting ${escapeHtml(nextPlayer.name)}` : '';
            return `
            <li class="${p.isYou ? 'is-you' : ''} ${isHost ? 'draggable' : ''}" data-player-id="${escapeHtml(p.id)}" ${isHost ? 'draggable="true"' : ''}>
              ${isHost ? '<span class="drag-handle" aria-hidden="true">⋮⋮</span>' : ''}
              <span>${escapeHtml(p.name)} ${p.isYou ? ' (you)' : ''}</span>
              ${targetLabel ? `<span class="player-target">${targetLabel}</span>` : ''}
              <span class="ready-badge ${p.ready ? 'ready' : ''}">${p.ready ? '✓ Ready' : 'Not ready'}</span>
            </li>
          `; }).join('')}
        </ul>
        ${isHost ? '<div class="lobby-order-actions"><button class="btn btn-secondary" id="btn-random-order">Random order</button></div>' : ''}
        ${state.canStart ? '<button class="btn" id="btn-start">Start game</button>' : allReady ? '<p class="subtitle">Waiting for host to start.</p>' : '<p class="subtitle">Everyone must ready up before the host can start.</p>'}
        <p class="subtitle" style="margin-top:1rem; font-size:0.85rem;"><strong>Multiplayer:</strong> Everyone must open the same game link. Share an invite link so friends can join with one click (they only enter their name).</p>
        <button class="btn btn-secondary" id="btn-copy-link">Copy game link</button>
        <button class="btn btn-secondary" id="btn-copy-join-link">Copy invite link</button>
        ${state.canStart && hostPassword ? ` <button class="btn btn-secondary" id="btn-copy-invite">Copy lobby name &amp; password</button>` : ''}
      `;
    }
  } else if (phase === 'assigning') {
    const target = state.assigningTarget;
    main = `
      <p class="lobby-name-display">Lobby: <strong>${escapeHtml(state.name)}</strong></p>
      ${target
        ? `
        <p class="subtitle">Enter the word (e.g. celebrity, character) for the player below. It will appear on their "forehead" for others to see.</p>
        <label>Targeting <strong>${escapeHtml(target.playerName)}</strong></label>
        <div class="guess-form">
          <input type="text" id="assign-word" placeholder="e.g. Einstein" value="${escapeHtml(state.preFilledWord || '')}" />
          <button class="btn" id="btn-assign">Submit</button>
        </div>
        `
        : '<p class="subtitle">You’ve submitted your word. Waiting for others…</p>'}
    `;
  } else if (state.gameType === 'wavelength' && (phase === 'wavelength_clue' || phase === 'wavelength_guessing' || phase === 'finished')) {
    main = renderWavelengthLayout();
  } else if (phase === 'guessing' || phase === 'finished') {
    const isMyTurn = me?.isCurrentTurn;
    const placements = getPlacements(state.players || []);
    const turnSecondsLeft = state.turnStartedAt && phase === 'guessing'
      ? Math.max(0, 60 - Math.floor((Date.now() - state.turnStartedAt) / 1000))
      : null;
    const currentPlayer = state.players?.find(p => p.id === state.currentTurnPlayerId);
    const currentDisplayName = currentPlayer ? currentPlayer.name : '';
    const players = state.players || [];
    const n = players.length;
    const currentIdx = currentPlayer ? players.findIndex(p => p.id === currentPlayer.id) : 0;
    const orderedPlayers = n ? [...players.slice(currentIdx), ...players.slice(0, currentIdx)] : [];
    const turnLabel = phase === 'finished'
      ? 'Game over'
      : isMyTurn
        ? "It's your turn to guess!"
        : `It's ${escapeHtml(currentDisplayName)}'s turn to guess`;
    const currentRound = currentPlayer ? (currentPlayer.roundCount || 0) + 1 : 1;
    const notesForLayout = gameNotesLocal !== null ? gameNotesLocal : (state.myNotes || '');
    main = renderGameLayout({
      orderedPlayers,
      placements,
      turnLabel,
      phase,
      turnSecondsLeft,
      lastWrongGuess: state.lastWrongGuess,
      currentTurnWrongGuesses: state.currentTurnWrongGuesses || [],
      guessHistory: state.guessHistory || [],
      myAssignedWord: state.myAssignedWord,
      isMyTurn,
      isHost: state.isHost,
      myNotes: notesForLayout,
      lobbyName: state.name,
      currentRound,
    });
  } else {
    main = '<p class="subtitle">Loading…</p>';
  }

  const isGameScreen = state && (
    state.phase === 'guessing' ||
    state.phase === 'wavelength_clue' ||
    state.phase === 'wavelength_guessing' ||
    state.phase === 'finished'
  );
  if (isGameScreen) {
    return main;
  }
  return `
    <h1>Minigames</h1>
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
  if (countdownEl && state?.turnStartedAt && (state?.phase === 'guessing' || state?.phase === 'wavelength_clue' || state?.phase === 'wavelength_guessing')) {
    lastCountdownSecs = -1;
    turnCountdownIntervalId = setInterval(() => {
      const el = getEl('turn-countdown');
      if (!el) {
        clearInterval(turnCountdownIntervalId);
        turnCountdownIntervalId = null;
        return;
      }
      const total = state.phase === 'guessing'
        ? 60
        : state.phase === 'wavelength_clue'
          ? (state.wavelength?.clueSeconds ?? 90)
          : state.phase === 'wavelength_guessing'
            ? (state.wavelength?.guessSeconds ?? 45)
            : 0;
      const secs = Math.max(0, total - Math.floor((Date.now() - state.turnStartedAt) / 1000));
      el.textContent = secs;
      if (state.gameType === 'guessit' && secs === 0 && lastCountdownSecs !== 0 && state?.currentTurnPlayerId === playerId) {
        lastCountdownSecs = 0;
        socket?.emit('skip-turn', { lobbyId, playerId });
      } else {
        lastCountdownSecs = secs;
      }
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
  getEl('btn-clear-image')?.addEventListener('click', (e) => {
    e.preventDefault();
    socket?.emit('set-image-for-next', { lobbyId, playerId, imageDataUrl: null });
    const fileEl = getEl('image-for-next-input');
    if (fileEl) fileEl.value = '';
  });
  getEl('image-for-next-input')?.addEventListener('change', async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const isOk = file.type === 'image/png' || file.type === 'image/jpeg';
    if (!isOk) {
      alert('Please upload a JPG or PNG.');
      e.target.value = '';
      return;
    }
    if (file.size > 2_000_000) {
      alert('Image too large. Please use an image under 2MB.');
      e.target.value = '';
      return;
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file, 512);
      socket?.emit('set-image-for-next', { lobbyId, playerId, imageDataUrl: dataUrl });
    } catch (_) {
      alert('Could not process image. Try a different file.');
      e.target.value = '';
    }
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
    const url = window.location.origin + window.location.pathname + window.location.search;
    navigator.clipboard.writeText(url).then(() => alert('Game link copied! Share this URL so others open the same game.'), () => alert('Could not copy'));
  });
  getEl('btn-copy-join-link')?.addEventListener('click', async () => {
    try {
      const res = await fetch(`${API}/lobby/${encodeURIComponent(lobbyId)}/join-link?playerId=${encodeURIComponent(playerId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to get invite link');
      const base = window.location.origin + window.location.pathname + (window.location.search || '');
      const joinUrl = base + '#t=' + encodeURIComponent(data.joinToken);
      await navigator.clipboard.writeText(joinUrl);
      alert('Invite link copied! Anyone who opens this link only needs to enter their name to join.');
    } catch (e) {
      alert(e.message || 'Could not copy invite link');
    }
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
  getEl('btn-leave')?.addEventListener('click', () => {
    try { socket?.emit('leave-lobby', { lobbyId, playerId }); } catch (_) {}
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

  // Wavelength bindings
  getEl('btn-wavelength-submit-clue')?.addEventListener('click', () => {
    const clueText = getEl('wavelength-clue-input')?.value ?? '';
    socket?.emit('submit-wavelength-clue', { lobbyId, playerId, clueText });
  });
  getEl('wavelength-clue-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      getEl('btn-wavelength-submit-clue')?.click();
    }
  });
  const submitWavelengthGuessFromForm = () => {
    const guess = getEl('wavelength-guess-input')?.value?.trim();
    if (!guess) return;
    socket?.emit('submit-wavelength-guess', { lobbyId, playerId, guess });
  };
  getEl('btn-wavelength-guess')?.addEventListener('click', submitWavelengthGuessFromForm);
  getEl('wavelength-guess-input')?.addEventListener('input', () => {
    const v = getEl('wavelength-guess-input')?.value;
    const out = getEl('wavelength-guess-value');
    if (out && v != null) out.textContent = String(v);
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderGameLayout(opts) {
  const {
    orderedPlayers,
    placements,
    turnLabel,
    phase,
    turnSecondsLeft,
    lastWrongGuess,
    currentTurnWrongGuesses,
    guessHistory,
    myAssignedWord,
    isMyTurn,
    isHost,
    myNotes,
    currentRound,
  } = opts;
  const n = orderedPlayers.length;
  const radius = 50;
  const dotHalf = 58;
  const wrongGuessesList = (currentTurnWrongGuesses && currentTurnWrongGuesses.length)
    ? currentTurnWrongGuesses.map(w => `${escapeHtml(w.playerName)}: "${escapeHtml(w.guess)}"`).join(' • ')
    : (lastWrongGuess ? `${escapeHtml(lastWrongGuess.playerName)} guessed "${escapeHtml(lastWrongGuess.guess)}" — wrong!` : '');
  const guessHistoryFiltered = (guessHistory || []).filter(e => !e.skipped);
  const guessHistoryHtml = guessHistoryFiltered.length
    ? guessHistoryFiltered.map(entry => {
        const roundLabel = entry.round != null ? `Round ${entry.round} — ` : '';
        const mark = entry.correct ? ' ✓' : ' ✗';
        const guess = entry.guess != null ? ` "${escapeHtml(entry.guess)}"` : '';
        return `<li class="guess-history-item ${entry.correct ? 'correct' : 'wrong'}">${roundLabel}${escapeHtml(entry.playerName)}:${guess}${mark}</li>`;
      }).join('')
    : '';
  const playerDots = orderedPlayers.map((p, i) => {
    const angleDeg = n ? (i / n) * 360 : 0;
    const angleRad = (angleDeg - 90) * (Math.PI / 180);
    const left = 50 + radius * Math.cos(angleRad);
    const top = 50 + radius * Math.sin(angleRad);
    const active = p.isCurrentTurn;
    const place = placements.get(p.id);
    const label = p.name;
    const wordSticky = !p.isYou && p.word ? `<span class="player-word-sticky">${escapeHtml(p.word)}</span>` : '';
    const imageSticky = !p.isYou && p.image ? `<img class="player-image-sticky" src="${escapeHtml(p.image)}" alt="Character" />` : '';
    return `
      <div class="player-dot ${active ? 'active' : 'inactive'} ${p.isYou ? 'you' : ''}" style="left:${left}%;top:${top}%;margin-left:-${dotHalf}px;margin-top:-${dotHalf}px;" title="${escapeHtml(p.name)}${p.isYou ? ' (you)' : ''}">
        ${wordSticky}
        ${imageSticky}
        ${label}
        ${p.hasWon && place != null ? `<span class="badge badge-won">${ordinal(place)}</span>` : ''}
      </div>
    `;
  }).join('');

  const centerContent = phase === 'guessing' && isMyTurn
    ? `
      <p class="turn-label">${escapeHtml(turnLabel)}</p>
      <p class="center-round">Round ${currentRound}</p>
      <div class="guess-form center-guess-form">
        <input type="text" id="guess-input" placeholder="Your guess" autocomplete="off" />
        <div class="center-guess-buttons">
          <button class="btn" id="btn-guess">Guess</button>
          <button class="btn btn-secondary" id="btn-skip">Skip</button>
        </div>
      </div>
    `
    : `
      <span class="turn-arrow"></span>
      <p class="center-round">Round ${currentRound}</p>
      <p class="turn-label">${escapeHtml(turnLabel)}</p>
    `;

  return `
    <div class="game-layout">
      <div class="game-left">
        <div class="player-circle">
          <div class="player-circle-center">
            ${centerContent}
          </div>
          <div class="player-dots">${playerDots}</div>
        </div>
      </div>
      <div class="game-right">
        <div class="game-info-panel card">
          <h3>Game info</h3>
          <p class="lobby-name-display" style="margin-bottom:0.5rem;">Lobby: <strong>${escapeHtml((opts.lobbyName || ''))}</strong></p>
          ${turnSecondsLeft != null ? `<p class="turn-timer">Time left: <strong id="turn-countdown">${turnSecondsLeft}</strong>s</p>` : ''}
          ${wrongGuessesList ? `<p class="wrong-guess-msg">Wrong: ${wrongGuessesList}</p>` : ''}
          ${guessHistoryHtml ? `<div class="guess-history"><h4>Guess history</h4><ul class="guess-history-list">${guessHistoryHtml}</ul></div>` : ''}
          ${myAssignedWord ? `<p class="subtitle" style="margin-bottom:0.5rem;">Your word was: <strong>${escapeHtml(myAssignedWord)}</strong></p>` : ''}
        </div>
        <div class="notepad-panel card">
          <label>Your notes</label>
          <textarea id="notes-field" placeholder="Jot down clues from Discord…" rows="6">${escapeHtml(myNotes || '')}</textarea>
        </div>
        <div class="game-leave-row">
          <button class="btn btn-secondary" id="btn-leave">Leave lobby</button>
          ${phase === 'finished' && isHost ? '<button class="btn" id="btn-return-lobby">Return to lobby</button>' : ''}
        </div>
      </div>
    </div>
  `;
}

function renderWavelengthLayout() {
  const me = state.players?.find(p => p.isYou);
  const phase = state.phase;
  const w = state.wavelength;
  const currentPlayer = state.players?.find(p => p.id === state.currentTurnPlayerId);
  const isClueGiver = !!(me && currentPlayer && me.id === currentPlayer.id);
  const pointsToWin = state.settings?.pointsToWin ?? 10;
  const scores = [...(state.players || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const total = phase === 'wavelength_clue' ? (w?.clueSeconds ?? 90) : phase === 'wavelength_guessing' ? (w?.guessSeconds ?? 45) : 0;
  const secsLeft = state.turnStartedAt && total
    ? Math.max(0, total - Math.floor((Date.now() - state.turnStartedAt) / 1000))
    : null;

  const category = w ? `${escapeHtml(w.categoryLeft)}  ↔  ${escapeHtml(w.categoryRight)}` : '';
  const targetBlock = w?.target != null
    ? `<p class="wavelength-target">Target: <strong>${escapeHtml(String(w.target))}</strong> <span class="subtitle" style="margin:0; font-size:0.85rem;">(1–20)</span></p>`
    : '';
  const clueBlock = (phase !== 'wavelength_clue' && w?.clueText != null)
    ? `<p class="wavelength-clue"><strong>Clue:</strong> ${escapeHtml(w.clueText || '(no clue)')}</p>`
    : '';

  const alreadyGuessed = w?.guesses && playerId ? (w.guesses[playerId] != null) : false;
  const guessers = (state.players || []).filter(p => p.id !== state.currentTurnPlayerId);
  const guessesList = (phase !== 'wavelength_clue' && w?.guesses)
    ? `<ul class="wavelength-guesses">
        ${guessers.map(p => {
          const g = w.guesses[p.id];
          const show = (phase === 'wavelength_guessing') ? (g != null ? String(g) : '—') : (g != null ? String(g) : '—');
          return `<li><span>${escapeHtml(p.name)}${p.isYou ? ' (you)' : ''}</span><span class="wavelength-guess-num">${escapeHtml(show)}</span></li>`;
        }).join('')}
      </ul>`
    : '';

  const lastRound = w?.lastRound;
  const lastRoundBlock = lastRound
    ? (() => {
        const clueGiverName = state.players?.find(p => p.id === lastRound.clueGiverId)?.name || 'Unknown';
        const perfect = (lastRound.perfectGuessers || []).map(pid => state.players?.find(p => p.id === pid)?.name).filter(Boolean);
        const within1 = (lastRound.withinOneGuessers || []).map(pid => state.players?.find(p => p.id === pid)?.name).filter(Boolean);
        const perfectLabel = perfect.length ? perfect.map(escapeHtml).join(', ') : 'No one';
        const within1Label = within1.length ? within1.map(escapeHtml).join(', ') : 'No one';
        const clueGiverPts = (lastRound.perfectGuessers || []).length;
        const lastGuesses = lastRound.guesses || {};
        const guessLines = (state.players || [])
          .filter(p => p.id !== lastRound.clueGiverId)
          .map(p => {
            const g = lastGuesses[p.id];
            return `<li><span>${escapeHtml(p.name)}</span><span class="wavelength-guess-num">${g != null ? escapeHtml(String(g)) : '—'}</span></li>`;
          }).join('');
        return `
          <div class="card wavelength-last-round">
            <h3 style="margin:0 0 0.5rem; font-size:0.9rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted);">Last round</h3>
            <p style="margin:0.25rem 0;"><strong>Clue giver:</strong> ${escapeHtml(clueGiverName)}</p>
            <p style="margin:0.25rem 0;"><strong>Target:</strong> ${escapeHtml(String(lastRound.target))}</p>
            <p style="margin:0.25rem 0;"><strong>Clue:</strong> ${escapeHtml(lastRound.clueText || '(no clue)')}</p>
            <p style="margin:0.25rem 0;"><strong>Perfect (+3):</strong> ${perfectLabel}</p>
            <p style="margin:0.25rem 0;"><strong>Within 1 (+1):</strong> ${within1Label}</p>
            ${clueGiverPts ? `<p style="margin:0.25rem 0;"><strong>Clue giver bonus:</strong> +${escapeHtml(String(clueGiverPts))}</p>` : ''}
            <div style="margin-top:0.75rem;">
              <p style="margin:0 0 0.35rem;"><strong>Guesses</strong></p>
              <ul class="wavelength-guesses">${guessLines || ''}</ul>
            </div>
          </div>
        `;
      })()
    : '';

  let center = '';
  if (phase === 'wavelength_clue') {
    center = isClueGiver
      ? `
        <p class="turn-label">Your turn</p>
        <p class="wavelength-category">${category}</p>
        ${targetBlock}
        ${secsLeft != null ? `<p class="turn-timer">Time left: <strong id="turn-countdown">${secsLeft}</strong>s</p>` : ''}
        <div class="guess-form center-guess-form">
          <input type="text" id="wavelength-clue-input" placeholder="Type your clue…" autocomplete="off" />
          <div class="center-guess-buttons">
            <button class="btn" id="btn-wavelength-submit-clue">Reveal</button>
          </div>
        </div>
      `
      : `
        <span class="turn-arrow"></span>
        <p class="turn-label">${escapeHtml(currentPlayer?.name || 'Someone')}'s turn</p>
        <p class="wavelength-category">${category}</p>
        ${secsLeft != null ? `<p class="turn-timer">Clue timer: <strong id="turn-countdown">${secsLeft}</strong>s</p>` : ''}
        <p class="subtitle" style="margin:0.75rem 0 0;">Waiting for the clue…</p>
      `;
  } else if (phase === 'wavelength_guessing') {
    const canGuess = !isClueGiver && !alreadyGuessed;
    center = `
      <p class="turn-label">Guess the number</p>
      <p class="wavelength-category">${category}</p>
      ${clueBlock}
      ${secsLeft != null ? `<p class="turn-timer">Time left: <strong id="turn-countdown">${secsLeft}</strong>s</p>` : ''}
      ${isClueGiver
        ? `<p class="subtitle" style="margin:0.75rem 0 0;">You’re the clue giver — waiting for guesses.</p>`
        : `
          <div class="guess-form center-guess-form">
            <div class="wavelength-slider-row">
              <input type="range" id="wavelength-guess-input" min="1" max="20" step="1" value="10" ${canGuess ? '' : 'disabled'} />
              <div class="wavelength-slider-value"><span id="wavelength-guess-value">10</span></div>
            </div>
            <div class="center-guess-buttons">
              <button class="btn" id="btn-wavelength-guess" ${canGuess ? '' : 'disabled'}>${alreadyGuessed ? 'Guessed' : 'Submit'}</button>
            </div>
          </div>
        `}
    `;
  } else if (phase === 'finished') {
    const winners = scores.filter(p => (p.score ?? 0) >= pointsToWin);
    const winnerNames = winners.length ? winners.map(p => escapeHtml(p.name)).join(', ') : 'Winner';
    center = `
      <p class="turn-label">Game over</p>
      <p class="subtitle" style="margin:0.25rem 0 0.75rem;">Winner: <strong>${winnerNames}</strong></p>
      ${lastRoundBlock ? '' : `<p class="subtitle" style="margin:0;">Thanks for playing.</p>`}
    `;
  }

  const players = state.players || [];
  const n = players.length;
  const currentIdx = currentPlayer ? players.findIndex(p => p.id === currentPlayer.id) : 0;
  const orderedPlayers = n ? [...players.slice(currentIdx), ...players.slice(0, currentIdx)] : [];

  const radius = 50;
  const dotHalf = 58;
  const circleDots = orderedPlayers.map((p, i) => {
    const angleDeg = n ? (i / n) * 360 : 0;
    const angleRad = (angleDeg - 90) * (Math.PI / 180);
    const left = 50 + radius * Math.cos(angleRad);
    const top = 50 + radius * Math.sin(angleRad);
    const active = p.isCurrentTurn;
    return `
      <div class="player-dot ${active ? 'active' : 'inactive'} ${p.isYou ? 'you' : ''}" style="left:${left}%;top:${top}%;margin-left:-${dotHalf}px;margin-top:-${dotHalf}px;" title="${escapeHtml(p.name)}${p.isYou ? ' (you)' : ''}">
        <span class="wavelength-score-badge" aria-label="Score">${escapeHtml(String(p.score ?? 0))}</span>
        ${escapeHtml(p.name)}${p.isYou ? ' (you)' : ''}
      </div>
    `;
  }).join('');

  const scoreboardList = scores.map(p => `
    <li>
      <span>${escapeHtml(p.name)}${p.isYou ? ' (you)' : ''}</span>
      <span class="wavelength-guess-num">${escapeHtml(String(p.score ?? 0))}</span>
    </li>
  `).join('');

  return `
    <div class="game-layout">
      <div class="game-left">
        <div class="player-circle" style="width:min( min(80vw, 420px), 100% );">
          <div class="player-circle-center">
            ${center}
          </div>
          <div class="player-dots">${circleDots}</div>
        </div>
      </div>
      <div class="game-right">
        <div class="game-info-panel card">
          <h3>Wavelength</h3>
          <p class="lobby-name-display" style="margin-bottom:0.5rem;">Lobby: <strong>${escapeHtml(state.name || '')}</strong></p>
          <p class="subtitle" style="margin:0 0 0.75rem;">First to <strong>${escapeHtml(String(pointsToWin))}</strong> points.</p>
          <div class="wavelength-scoreboard">
            <h4 style="margin:0 0 0.5rem; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted);">Scores</h4>
            <ul class="wavelength-guesses">${scoreboardList}</ul>
          </div>
          ${phase === 'wavelength_guessing' ? `<div class="wavelength-guesses-wrap"><h4 style="margin:0.75rem 0 0.5rem; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted);">Guesses</h4>${guessesList || '<p class="subtitle" style="margin:0;">No guesses yet.</p>'}</div>` : ''}
        </div>
        ${lastRoundBlock}
        <div class="game-leave-row">
          <button class="btn btn-secondary" id="btn-leave">Leave lobby</button>
          ${phase === 'finished' && state.isHost ? '<button class="btn" id="btn-return-lobby">Return to lobby</button>' : ''}
        </div>
      </div>
    </div>
  `;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function resizeImageToDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('img'));
      img.onload = () => {
        const w = img.width;
        const h = img.height;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const outW = Math.max(1, Math.round(w * scale));
        const outH = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('ctx'));
        ctx.drawImage(img, 0, 0, outW, outH);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const quality = mime === 'image/jpeg' ? 0.82 : undefined;
        const dataUrl = canvas.toDataURL(mime, quality);
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function getPlacements(players) {
  const won = players.filter(p => p.hasWon && p.roundsToWin != null).sort((a, b) => a.roundsToWin - b.roundsToWin);
  const map = new Map();
  won.forEach((p, i) => map.set(p.id, i + 1));
  return map;
}

function initDarkMode() {
  const stored = localStorage.getItem('guessit_theme');
  const prefersDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  if (!stored) localStorage.setItem('guessit_theme', theme);
  getEl('dark-mode-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('guessit_theme', next);
  });
}

const params = new URLSearchParams(location.search);
lobbyId = params.get('lobby') || localStorage.getItem('guessit_lobbyId');
playerId = params.get('player') || localStorage.getItem('guessit_playerId');
initDarkMode();
if (lobbyId && playerId) {
  connectSocket();
  fetchState();
}
render();
