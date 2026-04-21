import { nanoid } from 'nanoid';

const lobbies = new Map();

const GAME_TYPES = /** @type {const} */ ({
  GUESSIT: 'guessit',
  WAVELENGTH: 'wavelength',
});

const DEFAULT_WAVELENGTH_POINTS_TO_WIN = 10;
const DEFAULT_WAVELENGTH_CLUE_SECONDS = 90;
const DEFAULT_WAVELENGTH_GUESS_SECONDS = 45;

const WAVELENGTH_CATEGORIES = [
  ['Hot', 'Cold'],
  ['Good Movie', 'Bad Movie'],
  ['Introvert', 'Extrovert'],
  ['Sweet', 'Savory'],
  ['Underrated', 'Overrated'],
  ['Best Music', 'Worst Music'],
  ['Soft', 'Hard'],
  ['Clean', 'Messy'],
  ['Simple', 'Complicated'],
  ['Cat Person', 'Dog Person'],
  ['Bad Habit', 'Good Habit'],
  ['Least Scary', 'Most Scary'],
  ['Unethical', 'Ethical'],
  ['Hard to Find', 'Easy to Find'],
  ['Quiet', 'Loud'],
  ['Casual', 'Formal'],
  ['Old', 'New'],
  ['Boring', 'Exciting'],
  ['Relaxing', 'Stressful'],
  ['Cheap', 'Expensive'],
  ['Low Quality', 'High Quality'],
  ['Not Art', 'Art'],
  ['Unpopular', 'Popular'],
  ['Wouldn’t Eat', 'Would Eat'],
  ['Bad Gift', 'Good Gift'],
  ['Unreliable', 'Reliable'],
  ['Bad Advice', 'Good Advice'],
  ['Weak', 'Strong'],
  ['Short', 'Long'],
  ['Plain', 'Fancy'],
  ['Trashy', 'Classy'],
  ['For Kids', 'For Adults'],
  ['Bad Smell', 'Good Smell'],
  ['Not Addictive', 'Addictive'],
  ['Useless', 'Useful'],
  ['Forgettable', 'Memorable'],
  ['Bad Vacation', 'Good Vacation'],
  ['Worst Day', 'Best Day'],
  ['Nothing', 'Something'],
  ['Low Effort', 'High Effort'],
  ['Hard to Use', 'Easy to Use'],
  ['Not Funny', 'Funny'],
  ['Wouldn’t Buy', 'Would Buy'],
  ['Hard to Spell', 'Easy to Spell'],
  ['Basic', 'Hipster'],
  ['Bad Superpower', 'Good Superpower'],
  ['Not a Sport', 'A Sport'],
  ['Not a Sandwich', 'A Sandwich'],
  ['Not a Dessert', 'A Dessert'],
];

function getLobby(lobbyId) {
  return lobbies.get(lobbyId);
}

function createLobby(name, password, playerName, opts = {}) {
  const trimmedName = name.trim();
  const exists = [...lobbies.values()].some(l => l.name.toLowerCase() === trimmedName.toLowerCase());
  if (exists) throw new Error('A lobby with this name already exists. Pick another name.');
  const id = nanoid(8);
  const gameType = String(opts.gameType || GAME_TYPES.GUESSIT);
  if (![GAME_TYPES.GUESSIT, GAME_TYPES.WAVELENGTH].includes(gameType)) throw new Error('Invalid game type');

  const player = {
    id: nanoid(8),
    name: playerName,
    wordForNext: '',
    ready: false,
    // Guess It fields
    assignedWord: null,
    hasWon: false,
    roundsToWin: null,
    notes: '',
    roundCount: 0,
    // Wavelength fields
    score: 0,
  };
  const lobby = {
    id,
    name: trimmedName,
    password,
    gameType,
    settings: normalizeSettings(gameType, opts.settings),
    players: [player],
    phase: 'waiting',
    order: [],
    assignments: {},
    currentTurnIndex: 0,
    creatorId: player.id,
    lastWrongGuess: null,
    currentTurnWrongGuesses: [],
    wavelength: null,
    toClient(forPlayerId) { return toClient(this, forPlayerId); },
  };
  lobbies.set(id, lobby);
  return { lobby, player };
}

function joinLobby(lobbyName, password, playerName) {
  const name = lobbyName.trim();
  const lobby = [...lobbies.values()].find(l => l.name.toLowerCase() === name.toLowerCase());
  if (!lobby) throw new Error('Lobby not found');
  if (lobby.password !== password) throw new Error('Wrong password');
  if (lobby.phase !== 'waiting') throw new Error('Game already started');
  if (lobby.players.some(p => p.name.toLowerCase() === playerName.trim().toLowerCase())) throw new Error('Name already taken');
  const player = {
    id: nanoid(8),
    name: playerName.trim(),
    wordForNext: '',
    ready: false,
    // Guess It fields
    assignedWord: null,
    hasWon: false,
    roundsToWin: null,
    notes: '',
    roundCount: 0,
    // Wavelength fields
    score: 0,
  };
  lobby.players.push(player);
  return { lobby, player };
}

function setWordForNext(lobby, playerId, word) {
  if (lobby.phase !== 'waiting') throw new Error('Can only set word in lobby');
  if (lobby.gameType !== GAME_TYPES.GUESSIT) throw new Error('Not used in this game');
  const player = lobby.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');
  player.wordForNext = String(word ?? '').trim();
}

function setReady(lobby, playerId, ready) {
  if (lobby.phase !== 'waiting') throw new Error('Can only ready up in lobby');
  const player = lobby.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');
  player.ready = !!ready;
}

function reorderPlayers(lobby, playerId, playerIds) {
  if (lobby.phase !== 'waiting') throw new Error('Can only reorder in lobby');
  if (lobby.creatorId !== playerId) throw new Error('Only the host can reorder');
  const currentIds = new Set(lobby.players.map(p => p.id));
  const requested = [...new Set(playerIds)];
  if (requested.length !== lobby.players.length || requested.some(id => !currentIds.has(id))) {
    throw new Error('Invalid order');
  }
  const byId = new Map(lobby.players.map(p => [p.id, p]));
  lobby.players = requested.map(id => byId.get(id));
}

function randomizeOrder(lobby, playerId) {
  if (lobby.phase !== 'waiting') throw new Error('Can only randomize in lobby');
  if (lobby.creatorId !== playerId) throw new Error('Only the host can randomize');
  const arr = [...lobby.players];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  lobby.players = arr;
}

function startGame(lobby, playerId) {
  if (lobby.phase !== 'waiting') throw new Error('Game already started');
  if (lobby.players.length < 2) throw new Error('Need at least 2 players');
  if (!lobby.players.every(p => p.ready)) throw new Error('Everyone must be ready before starting');
  if (lobby.creatorId !== playerId) throw new Error('Only the host can start the game');
  if (lobby.gameType === GAME_TYPES.GUESSIT) {
    if (!lobby.players.every(p => (p.wordForNext || '').trim())) throw new Error('Everyone must enter a word for the next player before starting');
    lobby.order = lobby.players.map((_, i) => i);
    const n = lobby.players.length;
    lobby.assignments = {};
    for (let i = 0; i < n; i++) {
      const nextIdx = (i + 1) % n;
      const nextPlayer = lobby.players[nextIdx];
      lobby.assignments[nextPlayer.id] = { word: String(lobby.players[i].wordForNext || '').trim(), fromPlayerId: lobby.players[i].id };
    }
    lobby.players.forEach(p => {
      p.assignedWord = lobby.assignments[p.id]?.word ?? null;
    });
    lobby.phase = 'guessing';
    lobby.currentTurnIndex = 0;
    lobby.turnStartedAt = Date.now();
    lobby.currentTurnWrongGuesses = [];
    lobby.guessHistory = [];
    return;
  }

  if (lobby.gameType === GAME_TYPES.WAVELENGTH) {
    lobby.order = lobby.players.map((_, i) => i);
    lobby.currentTurnIndex = 0;
    lobby.players.forEach(p => { p.score = 0; p.ready = false; });
    lobby.guessHistory = [];
    startNextWavelengthRound(lobby);
    return;
  }

  throw new Error('Unsupported game type');
}

function submitAssignment(lobby, playerId, word) {
  if (lobby.phase !== 'assigning') throw new Error('Not in assigning phase');
  if (lobby.gameType !== GAME_TYPES.GUESSIT) throw new Error('Not used in this game');
  const idx = lobby.players.findIndex(p => p.id === playerId);
  if (idx === -1) throw new Error('Player not found');
  const nextIdx = (idx + 1) % lobby.players.length;
  const nextPlayerId = lobby.players[nextIdx].id;
  lobby.assignments[nextPlayerId] = { word: String(word).trim(), fromPlayerId: playerId };
  if (Object.keys(lobby.assignments).length === lobby.players.length) {
    lobby.players.forEach(p => {
      p.assignedWord = lobby.assignments[p.id]?.word ?? null;
    });
    lobby.phase = 'guessing';
    lobby.currentTurnIndex = 0;
    lobby.turnStartedAt = Date.now();
  }
}

function submitGuess(lobby, playerId, guess) {
  if (lobby.phase !== 'guessing') throw new Error('Not in guessing phase');
  if (lobby.gameType !== GAME_TYPES.GUESSIT) throw new Error('Not used in this game');
  const orderIdx = lobby.order.indexOf(lobby.players.findIndex(p => p.id === playerId));
  if (orderIdx === -1) throw new Error('Player not in order');
  const currentIdx = lobby.order[lobby.currentTurnIndex];
  const currentPlayer = lobby.players[currentIdx];
  if (currentPlayer.id !== playerId) throw new Error('Not your turn');
  currentPlayer.roundCount += 1;
  const correct = currentPlayer.assignedWord && currentPlayer.assignedWord.toLowerCase() === String(guess).trim().toLowerCase();
  const guessStr = String(guess).trim();
  if (!lobby.guessHistory) lobby.guessHistory = [];
  lobby.guessHistory.push({ playerName: currentPlayer.name, guess: guessStr, correct, round: currentPlayer.roundCount });
  if (correct) {
    currentPlayer.hasWon = true;
    currentPlayer.roundsToWin = currentPlayer.roundCount;
    lobby.lastWrongGuess = null;
    lobby.currentTurnWrongGuesses = [];
  } else {
    const wrong = { playerName: currentPlayer.name, guess: guessStr };
    lobby.lastWrongGuess = wrong;
    lobby.currentTurnWrongGuesses = lobby.currentTurnWrongGuesses || [];
    lobby.currentTurnWrongGuesses.push(wrong);
  }
  advanceTurn(lobby);
  const placement = correct ? lobby.players.filter(p => p.hasWon).length : null;
  return { correct, roundsUsed: currentPlayer.roundCount, placement };
}

function skipTurn(lobby, playerId) {
  if (lobby.phase !== 'guessing') throw new Error('Not in guessing phase');
  if (lobby.gameType !== GAME_TYPES.GUESSIT) throw new Error('Not used in this game');
  const currentIdx = lobby.order[lobby.currentTurnIndex];
  const currentPlayer = lobby.players[currentIdx];
  if (currentPlayer.id !== playerId) throw new Error('Not your turn');
  currentPlayer.roundCount += 1;
  if (!lobby.guessHistory) lobby.guessHistory = [];
  lobby.guessHistory.push({ playerName: currentPlayer.name, guess: null, correct: false, skipped: true });
  lobby.lastWrongGuess = null;
  lobby.currentTurnWrongGuesses = [];
  advanceTurn(lobby);
}

function advanceTurn(lobby) {
  lobby.lastWrongGuess = null;
  lobby.currentTurnWrongGuesses = [];
  const total = lobby.players.length;
  let next = (lobby.currentTurnIndex + 1) % total;
  let steps = 0;
  while (lobby.players[lobby.order[next]].hasWon && steps < total) {
    next = (next + 1) % total;
    steps++;
  }
  lobby.currentTurnIndex = next;
  lobby.turnStartedAt = Date.now();
  if (lobby.players.every(p => p.hasWon)) lobby.phase = 'finished';
}

function updateNotes(lobby, playerId, notes) {
  const player = lobby.players.find(p => p.id === playerId);
  if (player) player.notes = String(notes ?? '');
}

function toClient(lobby, forPlayerId) {
  const isPlayer = (p) => p.id === forPlayerId;
  const me = lobby.players.find(isPlayer);
  const isGuessItTurnPhase = lobby.gameType === GAME_TYPES.GUESSIT && (lobby.phase === 'guessing' || lobby.phase === 'finished');
  const isWavelengthTurnPhase = lobby.gameType === GAME_TYPES.WAVELENGTH && (String(lobby.phase || '').startsWith('wavelength_') || lobby.phase === 'finished');
  const currentIdx = (isGuessItTurnPhase || isWavelengthTurnPhase) ? lobby.order[lobby.currentTurnIndex] : null;
  const currentPlayer = currentIdx != null ? lobby.players[currentIdx] : null;

  const wavelengthForClient = (() => {
    if (lobby.gameType !== GAME_TYPES.WAVELENGTH) return null;
    const w = lobby.wavelength;
    if (!w) return null;
    const isClueGiver = currentPlayer?.id && forPlayerId === currentPlayer.id;
    const targetVisible = lobby.phase !== 'wavelength_clue';
    return {
      round: w.round,
      categoryLeft: w.categoryLeft,
      categoryRight: w.categoryRight,
      clueText: targetVisible ? (w.clueText ?? '') : null,
      target: (targetVisible || isClueGiver) ? w.target : null,
      guesses: w.guesses ? Object.fromEntries(Object.entries(w.guesses).map(([pid, g]) => [pid, g])) : {},
      lastRound: w.lastRound ?? null,
      clueSeconds: w.clueSeconds,
      guessSeconds: w.guessSeconds,
    };
  })();

  return {
    id: lobby.id,
    name: lobby.name,
    gameType: lobby.gameType,
    settings: lobby.settings ?? {},
    phase: lobby.phase,
    turnStartedAt: lobby.turnStartedAt ?? null,
    players: lobby.players.map(p => ({
      id: p.id,
      name: p.name,
      wordForNext: p.wordForNext ?? '',
      ready: p.ready ?? false,
      hasWon: p.hasWon,
      roundsToWin: p.roundsToWin,
      roundCount: p.roundCount ?? 0,
      score: p.score ?? 0,
      isYou: p.id === forPlayerId,
      isCurrentTurn: currentPlayer && p.id === currentPlayer.id,
      word: p.id !== forPlayerId ? (p.assignedWord ?? null) : undefined,
    })),
    currentTurnPlayerId: currentPlayer?.id ?? null,
    myNotes: me?.notes ?? '',
    myAssignedWord: me?.hasWon ? me.assignedWord : null,
    assigningTarget: (() => {
      if (lobby.phase !== 'assigning' || !forPlayerId) return null;
      const idx = lobby.players.findIndex(p => p.id === forPlayerId);
      if (idx === -1) return null;
      const nextIdx = (idx + 1) % lobby.players.length;
      const next = lobby.players[nextIdx];
      const alreadySubmitted = lobby.assignments[next.id];
      return alreadySubmitted ? null : { playerId: next.id, playerName: next.name };
    })(),
    preFilledWord: (() => {
      if (lobby.phase !== 'assigning' || !me) return null;
      const idx = lobby.players.findIndex(p => p.id === forPlayerId);
      if (idx === -1) return null;
      return me.wordForNext ?? null;
    })(),
    nextPlayerForWord: (() => {
      if (lobby.phase !== 'waiting' || !forPlayerId) return null;
      const idx = lobby.players.findIndex(p => p.id === forPlayerId);
      if (idx === -1) return null;
      const nextIdx = (idx + 1) % lobby.players.length;
      const next = lobby.players[nextIdx];
      return next ? { playerId: next.id, playerName: next.name } : null;
    })(),
    myWordForNext: me?.wordForNext ?? '',
    canStart: lobby.phase === 'waiting' && lobby.players.length >= 2 && lobby.players.every(p => p.ready) && lobby.creatorId === forPlayerId,
    allAssignmentsIn: lobby.phase === 'assigning' && Object.keys(lobby.assignments).length === lobby.players.length,
    isHost: lobby.creatorId === forPlayerId,
    lastWrongGuess: lobby.lastWrongGuess ?? null,
    currentTurnWrongGuesses: lobby.currentTurnWrongGuesses ?? [],
    guessHistory: lobby.guessHistory ?? [],
    wavelength: wavelengthForClient,
  };
}


function returnToLobby(lobby, playerId) {
  if (lobby.phase !== 'finished') throw new Error('Game is not finished');
  if (lobby.creatorId !== playerId) throw new Error('Only the host can return to lobby');
  lobby.phase = 'waiting';
  lobby.order = [];
  lobby.assignments = {};
  lobby.currentTurnIndex = 0;
  lobby.players.forEach(p => {
    p.assignedWord = null;
    p.hasWon = false;
    p.roundsToWin = null;
    p.notes = '';
    p.roundCount = 0;
    p.ready = false;
    p.score = 0;
  });
  lobby.lastWrongGuess = null;
  lobby.currentTurnWrongGuesses = [];
  lobby.guessHistory = [];
  lobby.wavelength = null;
}

function getJoinToken(lobby, playerId) {
  const player = lobby.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');
  const payload = JSON.stringify({ lobbyId: lobby.id, lobbyName: lobby.name, password: lobby.password });
  return Buffer.from(payload, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function redeemJoinToken(token, playerName) {
  try {
    let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const { lobbyName, password } = payload;
    if (!lobbyName || !password) throw new Error('Invalid token');
    return joinLobby(lobbyName, password, playerName);
  } catch (e) {
    const known = ['Lobby not found', 'Wrong password', 'Game already started', 'Name already taken'];
    if (e.message && known.some(k => e.message === k)) throw e;
    throw new Error('Invalid or expired join link. Ask the host for a new link.');
  }
}

export { getLobby, createLobby, joinLobby, reorderPlayers, randomizeOrder, setWordForNext, setReady, startGame, submitAssignment, submitGuess, skipTurn, updateNotes, returnToLobby, getJoinToken, redeemJoinToken };

function normalizeSettings(gameType, settings) {
  if (gameType === GAME_TYPES.WAVELENGTH) {
    const pointsToWinRaw = settings?.pointsToWin;
    let pointsToWin = Number.isFinite(Number(pointsToWinRaw)) ? Math.floor(Number(pointsToWinRaw)) : DEFAULT_WAVELENGTH_POINTS_TO_WIN;
    if (pointsToWin < 1) pointsToWin = 1;
    if (pointsToWin > 99) pointsToWin = 99;

    const clueSecondsRaw = settings?.clueSeconds;
    let clueSeconds = Number.isFinite(Number(clueSecondsRaw)) ? Math.floor(Number(clueSecondsRaw)) : DEFAULT_WAVELENGTH_CLUE_SECONDS;
    if (clueSeconds < 15) clueSeconds = 15;
    if (clueSeconds > 300) clueSeconds = 300;

    const guessSecondsRaw = settings?.guessSeconds;
    let guessSeconds = Number.isFinite(Number(guessSecondsRaw)) ? Math.floor(Number(guessSecondsRaw)) : DEFAULT_WAVELENGTH_GUESS_SECONDS;
    if (guessSeconds < 10) guessSeconds = 10;
    if (guessSeconds > 300) guessSeconds = 300;

    return { pointsToWin, clueSeconds, guessSeconds };
  }
  return {};
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function startNextWavelengthRound(lobby) {
  const currentIdx = lobby.order[lobby.currentTurnIndex];
  const currentPlayer = lobby.players[currentIdx];
  if (!currentPlayer) throw new Error('Invalid turn');

  const [left, right] = randomChoice(WAVELENGTH_CATEGORIES);
  const target = 1 + Math.floor(Math.random() * 20);

  const round = (lobby.wavelength?.round ?? 0) + 1;
  lobby.wavelength = {
    round,
    categoryLeft: left,
    categoryRight: right,
    target,
    clueText: '',
    guesses: {},
    lastRound: lobby.wavelength?.lastRound ?? null,
    clueSeconds: lobby.settings?.clueSeconds ?? DEFAULT_WAVELENGTH_CLUE_SECONDS,
    guessSeconds: lobby.settings?.guessSeconds ?? DEFAULT_WAVELENGTH_GUESS_SECONDS,
  };
  lobby.phase = 'wavelength_clue';
  lobby.turnStartedAt = Date.now();
}

function submitWavelengthClue(lobby, playerId, clueText) {
  if (lobby.gameType !== GAME_TYPES.WAVELENGTH) throw new Error('Not used in this game');
  if (lobby.phase !== 'wavelength_clue') throw new Error('Not in clue phase');
  const currentIdx = lobby.order[lobby.currentTurnIndex];
  const currentPlayer = lobby.players[currentIdx];
  if (!currentPlayer || currentPlayer.id !== playerId) throw new Error('Not your turn');
  if (!lobby.wavelength) throw new Error('Round not initialized');
  lobby.wavelength.clueText = String(clueText ?? '').trim();
  lobby.phase = 'wavelength_guessing';
  lobby.turnStartedAt = Date.now();
}

function submitWavelengthGuess(lobby, playerId, guess) {
  if (lobby.gameType !== GAME_TYPES.WAVELENGTH) throw new Error('Not used in this game');
  if (lobby.phase !== 'wavelength_guessing') throw new Error('Not in guessing phase');
  const me = lobby.players.find(p => p.id === playerId);
  if (!me) throw new Error('Player not found');
  const currentIdx = lobby.order[lobby.currentTurnIndex];
  const currentPlayer = lobby.players[currentIdx];
  if (!currentPlayer) throw new Error('Invalid turn');
  if (currentPlayer.id === playerId) throw new Error('Clue giver cannot guess');
  if (!lobby.wavelength) throw new Error('Round not initialized');
  const n = Number(guess);
  if (!Number.isFinite(n)) throw new Error('Guess must be a number');
  const g = Math.max(1, Math.min(20, Math.round(n)));
  lobby.wavelength.guesses[playerId] = g;
  // If everyone except clue giver has guessed, score immediately.
  const eligibleGuessers = lobby.players.filter(p => p.id !== currentPlayer.id);
  const allIn = eligibleGuessers.every(p => lobby.wavelength.guesses[p.id] != null);
  if (allIn) scoreAndAdvanceWavelengthRound(lobby);
}

function scoreAndAdvanceWavelengthRound(lobby) {
  if (lobby.gameType !== GAME_TYPES.WAVELENGTH) throw new Error('Not used in this game');
  if (!lobby.wavelength) throw new Error('Round not initialized');
  const currentIdx = lobby.order[lobby.currentTurnIndex];
  const currentPlayer = lobby.players[currentIdx];
  const target = lobby.wavelength.target;
  const guesses = lobby.wavelength.guesses || {};
  const entries = Object.entries(guesses)
    .map(([pid, g]) => ({ playerId: pid, guess: g }))
    .filter(e => e.guess != null);

  const perfectGuessers = entries.filter(e => Math.abs(e.guess - target) === 0).map(e => e.playerId);
  const withinOneGuessers = entries.filter(e => Math.abs(e.guess - target) === 1).map(e => e.playerId);

  // Scoring rules (award to everyone who qualifies):
  // - Spot on: +3 to every perfect guesser; clue giver gets +1 per perfect guesser
  // - Within 1: +1 to every within-1 guesser (even if someone else is closer / perfect)
  perfectGuessers.forEach(pid => {
    const p = lobby.players.find(x => x.id === pid);
    if (p) p.score = (p.score ?? 0) + 3;
  });
  withinOneGuessers.forEach(pid => {
    const p = lobby.players.find(x => x.id === pid);
    if (p) p.score = (p.score ?? 0) + 1;
  });
  if (currentPlayer && perfectGuessers.length) {
    currentPlayer.score = (currentPlayer.score ?? 0) + perfectGuessers.length;
  }

  lobby.wavelength.lastRound = {
    clueGiverId: currentPlayer?.id ?? null,
    target,
    clueText: lobby.wavelength.clueText ?? '',
    perfectGuessers,
    withinOneGuessers,
    guesses,
  };

  const pointsToWin = lobby.settings?.pointsToWin ?? DEFAULT_WAVELENGTH_POINTS_TO_WIN;
  const maxScore = Math.max(...lobby.players.map(p => p.score ?? 0));
  const hasWinner = maxScore >= pointsToWin;
  if (hasWinner) {
    lobby.phase = 'finished';
    lobby.turnStartedAt = null;
    return;
  }

  lobby.currentTurnIndex = (lobby.currentTurnIndex + 1) % lobby.players.length;
  startNextWavelengthRound(lobby);
}

function handleWavelengthTimeout(lobby) {
  if (lobby.gameType !== GAME_TYPES.WAVELENGTH) return false;
  if (lobby.phase === 'wavelength_clue') {
    // Auto-advance even with empty clue.
    const currentIdx = lobby.order[lobby.currentTurnIndex];
    const currentPlayer = lobby.players[currentIdx];
    if (!currentPlayer) return false;
    if (!lobby.wavelength) return false;
    lobby.wavelength.clueText = String(lobby.wavelength.clueText ?? '').trim();
    lobby.phase = 'wavelength_guessing';
    lobby.turnStartedAt = Date.now();
    return true;
  }
  if (lobby.phase === 'wavelength_guessing') {
    scoreAndAdvanceWavelengthRound(lobby);
    return true;
  }
  return false;
}

function getLobbyPhaseTimerSeconds(lobby) {
  if (lobby.gameType === GAME_TYPES.GUESSIT && lobby.phase === 'guessing') return 60;
  if (lobby.gameType === GAME_TYPES.WAVELENGTH && lobby.phase === 'wavelength_clue') return lobby.settings?.clueSeconds ?? DEFAULT_WAVELENGTH_CLUE_SECONDS;
  if (lobby.gameType === GAME_TYPES.WAVELENGTH && lobby.phase === 'wavelength_guessing') return lobby.settings?.guessSeconds ?? DEFAULT_WAVELENGTH_GUESS_SECONDS;
  return null;
}

export {
  GAME_TYPES,
  submitWavelengthClue,
  submitWavelengthGuess,
  handleWavelengthTimeout,
  getLobbyPhaseTimerSeconds,
};
