import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createLobby, joinLobby, getLobby, startGame, submitAssignment, submitGuess, updateNotes } from './lobby.js';

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

// --- REST API ---

app.post('/api/lobby', (req, res) => {
  const { name, password, playerName } = req.body;
  if (!name || !password || !playerName) {
    return res.status(400).json({ error: 'Name, password, and player name required' });
  }
  try {
    const { lobby, player } = createLobby(name, password, playerName);
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

  socket.on('start-game', async ({ lobbyId, playerId }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      startGame(lobby, playerId);
      await broadcastLobbyState(lobbyId);
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
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('submit-guess', async ({ lobbyId, playerId, guess }) => {
    const lobby = getLobby(lobbyId);
    if (!lobby) return socket.emit('error', { message: 'Lobby not found' });
    try {
      const result = submitGuess(lobby, playerId, guess);
      await broadcastLobbyState(lobbyId);
      if (result) socket.emit('guess-result', result);
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
    socketToPlayer.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
