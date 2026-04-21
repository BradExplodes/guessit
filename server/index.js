import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  createLobby,
  joinLobby,
  getLobby,
  startGame,
  submitAssignment,
  submitGuess,
  skipTurn,
  updateNotes,
  returnToLobby,
  reorderPlayers,
  randomizeOrder,
  setWordForNext,
  setReady,
  getJoinToken,
  redeemJoinToken,
  submitWavelengthClue,
  submitWavelengthGuess,
  handleWavelengthTimeout,
  getLobbyPhaseTimerSeconds,
  removePlayer,
  markPlayerConnected,
  markPlayerDisconnected,
  setImageForNext,
} from './lobby.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });

// In-memory: socket id -> { lobbyId, playerId }
const socketToPlayer = new Map();
// Per-lobby turn timer: lobbyId -> { timeoutId }
const lobbyTurnTimers = new Map();
// Disconnect grace removal: `${lobbyId}:${playerId}` -> timeoutId
const lobbyDisconnectTimers = new Map();
const DISCONNECT_GRACE_MS = 15000;

// --- REST API ---

app.post('/api/lobby', (req, res) => {
  const { name, password, playerName, gameType, settings } = req.body;
  if (!name || !password || !playerName) {
    return res.status(400).json({ error: 'Name, password, and player name required' });
  }
  try {
    const { lobby, player } = createLobby(name, password, playerName, { gameType, settings });
    return res.json({ lobbyId: lobby.id, playerId: player.id, lobbyName: lobby.name });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post('/api/lobby/join', (req, res) => {
  const { lobbyName, password, playerName } = req.body;
  if (!lobbyName || !password || !playerName) {
    return res.status(400).json({ error: 'Lobby name, password, and player name required' });
  }
  try {
    const { lobby, player } = joinLobby(lobbyName, password, playerName);
    return res.json({ lobbyId: lobby.id, playerId: player.id, lobbyName: lobby.name });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.get('/api/lobby/:lobbyId', (req, res) => {
  const lobby = getLobby(req.params.lobbyId);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  const playerId = req.query.playerId || null;
  return res.json(lobby.toClient(playerId));
});

app.get('/api/lobby/:lobbyId/join-link', (req, res) => {
  const lobby = getLobby(req.params.lobbyId);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  const playerId = req.query.playerId;
  if (!playerId) return res.status(400).json({ error: 'playerId required' });
  try {
    const joinToken = getJoinToken(lobby, playerId);
    return res.json({ joinToken });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post('/api/lobby/join-by-token', (req, res) => {
  const { joinToken, playerName } = req.body;
  if (!joinToken || !playerName || !String(playerName).trim()) {
    return res.status(400).json({ error: 'Join token and player name required' });
  }
  try {
    const { lobby, player } = redeemJoinToken(joinToken, String(playerName).trim());
    return res.json({ lobbyId: lobby.id, playerId: player.id, lobbyName: lobby.name });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

// --- Serve frontend when dist exists (e.g. single Render deployment) ---
const distExists = fs.existsSync(distPath);
if (distExists) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// --- Socket.io ---

io.on('connection', (socket) => {
  socket.on('join-lobby', async ({ lobbyId, playerId }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    const player = lobby.players.find(p => p.id === playerId);
    if (!player) return socket.emit('error', { message: 'Player not found' });
    socket.join(lobbyId);
    socketToPlayer.set(socket.id, { lobbyId, playerId });
    markPlayerConnected(lobby, playerId);
    const key = `${lobbyId}:${playerId}`;
    const t = lobbyDisconnectTimers.get(key);
    if (t) clearTimeout(t);
    lobbyDisconnectTimers.delete(key);
    await broadcastLobbyState(lobbyId);
  });

  async function broadcastLobbyState(lobbyId) {
    const lobby = getLobby(lobbyId);
    if (!lobby) return;
    const sockets = await io.in(lobbyId).fetchSockets();
    for (const s of sockets) {
      const info = socketToPlayer.get(s.id);
      if (info && info.lobbyId === lobbyId) {
        s.emit('state', lobby.toClient(info.playerId));
      }
    }
  }

  function clearLobbyTurnTimer(lobbyId) {
    const entry = lobbyTurnTimers.get(lobbyId);
    if (entry?.timeoutId) clearTimeout(entry.timeoutId);
    lobbyTurnTimers.delete(lobbyId);
  }

  function setLobbyTurnTimer(lobbyId) {
    clearLobbyTurnTimer(lobbyId);
    const lobby = getLobby(lobbyId);
    if (!lobby) return;
    const seconds = getLobbyPhaseTimerSeconds(lobby);
    if (!seconds) return;
    const timeoutId = setTimeout(async () => {
      lobbyTurnTimers.delete(lobbyId);
      try {
        const handled = handleWavelengthTimeout(lobby);
        if (!handled && lobby.phase === 'guessing') {
          const currentIdx = lobby.order[lobby.currentTurnIndex];
          const currentPlayer = lobby.players[currentIdx];
          if (currentPlayer) skipTurn(lobby, currentPlayer.id);
        }
        await broadcastLobbyState(lobbyId);
      } catch (_) {
        // Turn may have already advanced (e.g. player guessed); ensure next turn still has a timer
      }
      setLobbyTurnTimer(lobbyId);
    }, seconds * 1000);
    lobbyTurnTimers.set(lobbyId, { timeoutId });
  }

  socket.on('leave-lobby', async ({ lobbyId, playerId }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return;
    try {
      clearLobbyTurnTimer(lobbyId);
      removePlayer(lobby, playerId);
      await broadcastLobbyState(lobbyId);
      setLobbyTurnTimer(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('start-game', async ({ lobbyId, playerId }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      startGame(lobby, playerId);
      await broadcastLobbyState(lobbyId);
      setLobbyTurnTimer(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('submit-assignment', async ({ lobbyId, playerId, word }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      submitAssignment(lobby, playerId, word);
      await broadcastLobbyState(lobbyId);
      if (lobby.phase === 'guessing') setLobbyTurnTimer(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('submit-guess', async ({ lobbyId, playerId, guess }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      clearLobbyTurnTimer(lobbyId);
      const result = submitGuess(lobby, playerId, guess);
      await broadcastLobbyState(lobbyId);
      setLobbyTurnTimer(lobbyId);
      if (result) socket.emit('guess-result', result);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('submit-wavelength-clue', async ({ lobbyId, playerId, clueText }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      clearLobbyTurnTimer(lobbyId);
      submitWavelengthClue(lobby, playerId, clueText);
      await broadcastLobbyState(lobbyId);
      setLobbyTurnTimer(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('submit-wavelength-guess', async ({ lobbyId, playerId, guess }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      // Do not reset the guess-phase deadline on each partial submission — that would
      // postpone the server timeout indefinitely. Only reschedule when the round ends.
      const wasGuessing = lobby.phase === 'wavelength_guessing';
      submitWavelengthGuess(lobby, playerId, guess);
      await broadcastLobbyState(lobbyId);
      if (!wasGuessing || lobby.phase !== 'wavelength_guessing') {
        clearLobbyTurnTimer(lobbyId);
        setLobbyTurnTimer(lobbyId);
      }
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('skip-turn', async ({ lobbyId, playerId }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      clearLobbyTurnTimer(lobbyId);
      skipTurn(lobby, playerId);
      await broadcastLobbyState(lobbyId);
      setLobbyTurnTimer(lobbyId);
    } catch (e) {
      if (e.message !== 'Not your turn') socket.emit('error', { message: e.message });
    }
  });

  socket.on('return-to-lobby', async ({ lobbyId, playerId }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      clearLobbyTurnTimer(lobbyId);
      returnToLobby(lobby, playerId);
      await broadcastLobbyState(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('reorder-players', async ({ lobbyId, playerId, playerIds }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      reorderPlayers(lobby, playerId, playerIds);
      await broadcastLobbyState(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('randomize-order', async ({ lobbyId, playerId }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      randomizeOrder(lobby, playerId);
      await broadcastLobbyState(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('set-word-for-next', async ({ lobbyId, playerId, word }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      setWordForNext(lobby, playerId, word);
      await broadcastLobbyState(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('set-image-for-next', async ({ lobbyId, playerId, imageDataUrl }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      setImageForNext(lobby, playerId, imageDataUrl);
      await broadcastLobbyState(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('set-ready', async ({ lobbyId, playerId, ready }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      setReady(lobby, playerId, ready);
      await broadcastLobbyState(lobbyId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('update-notes', ({ lobbyId, playerId, notes }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return;
    updateNotes(lobby, playerId, notes);
    socket.emit('state', lobby.toClient(playerId));
  });

  socket.on('disconnect', () => {
    const info = socketToPlayer.get(socket.id);
    socketToPlayer.delete(socket.id);
    if (!info) return;
    const { lobbyId, playerId } = info;
    const lobby = getLobby(lobbyId);
    if (!lobby) return;
    markPlayerDisconnected(lobby, playerId);
    const key = `${lobbyId}:${playerId}`;
    const existing = lobbyDisconnectTimers.get(key);
    if (existing) clearTimeout(existing);
    const timeoutId = setTimeout(async () => {
      lobbyDisconnectTimers.delete(key);
      const l = getLobby(lobbyId);
      if (!l) return;
      // If they reconnected, disconnectedAt will be cleared.
      const p = l.players.find(x => x.id === playerId);
      if (!p || !p.disconnectedAt) return;
      clearLobbyTurnTimer(lobbyId);
      removePlayer(l, playerId);
      await broadcastLobbyState(lobbyId);
      setLobbyTurnTimer(lobbyId);
    }, DISCONNECT_GRACE_MS);
    lobbyDisconnectTimers.set(key, timeoutId);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
