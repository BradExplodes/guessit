import { nanoid } from 'nanoid';

const lobbies = new Map();

function getLobby(lobbyId) {
  return lobbies.get(lobbyId);
}

function createLobby(name, password, playerName) {
  const trimmedName = name.trim();
  const exists = [...lobbies.values()].some(l => l.name.toLowerCase() === trimmedName.toLowerCase());
  if (exists) throw new Error('A lobby with this name already exists. Pick another name.');
  const id = nanoid(8);
  const player = { id: nanoid(8), name: playerName, wordForNext: '', ready: false, assignedWord: null, hasWon: false, roundsToWin: null, notes: '', roundCount: 0 };
  const lobby = {
    id,
    name: trimmedName,
    password,
    players: [player],
    phase: 'waiting',
    order: [],
    assignments: {},
    currentTurnIndex: 0,
    creatorId: player.id,
    lastWrongGuess: null,
    currentTurnWrongGuesses: [],
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
  const player = { id: nanoid(8), name: playerName.trim(), wordForNext: '', ready: false, assignedWord: null, hasWon: false, roundsToWin: null, notes: '', roundCount: 0 };
  lobby.players.push(player);
  return { lobby, player };
}

function setWordForNext(lobby, playerId, word) {
  if (lobby.phase !== 'waiting') throw new Error('Can only set word in lobby');
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
  if (!lobby.players.every(p => (p.wordForNext || '').trim())) throw new Error('Everyone must enter a word for the next player before starting');
  if (lobby.creatorId !== playerId) throw new Error('Only the host can start the game');
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
}

function submitAssignment(lobby, playerId, word) {
  if (lobby.phase !== 'assigning') throw new Error('Not in assigning phase');
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
  const currentIdx = lobby.phase === 'guessing' || lobby.phase === 'finished' ? lobby.order[lobby.currentTurnIndex] : null;
  const currentPlayer = currentIdx != null ? lobby.players[currentIdx] : null;

  return {
    id: lobby.id,
    name: lobby.name,
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
  });
  lobby.lastWrongGuess = null;
  lobby.currentTurnWrongGuesses = [];
  lobby.guessHistory = [];
}

export { getLobby, createLobby, joinLobby, reorderPlayers, randomizeOrder, setWordForNext, setReady, startGame, submitAssignment, submitGuess, skipTurn, updateNotes, returnToLobby };
