# Who Am I? — Online Party Game

Play the classic "post-it on your forehead" game online. Each player is assigned a name (celebrity, character, etc.) by the person next to them. Take turns guessing your word; when you get it right, you win. Use Discord (or any voice chat) to ask each other questions — this app only manages the game and your notes.

## Quick start

```bash
npm install
npm run dev
```

- **App:** http://localhost:5173 (or http://YOUR_IP:5173 for other devices on your network)  
- **API:** http://localhost:3001  

## Multiplayer (important)

**Everyone must open the same game URL.** The host should use **Copy game link** in the lobby and share that link. Anyone joining (same browser, different browser, or different device) must open that exact URL, then use **Join lobby** with the lobby name and password. Lobby names are unique: you can’t create a second lobby with the same name.

## How to play

1. **Create a lobby** — Enter a unique lobby name, password, and your display name. Use **Copy game link** and share it; then **Copy lobby name & password** and share those too.
2. **Join** — Open the game link the host shared, then enter the lobby name, password, and your display name.
3. **Start** — Once at least 2 players are in, the host clicks "Start game".
4. **Assign words** — Each player enters a word for the *next* player in the list (the one “after” them). That word is the name on their forehead.
5. **Guess** — Players take turns guessing their word. Use Discord to ask yes/no questions. When it’s your turn, type your guess. Correct = you win and your turn count is recorded; wrong = next player’s turn.
6. **Notes** — Use the notes area to jot down clues from the conversation.
7. The game ends when everyone has guessed their word. You’ll see how many rounds it took each player.

## Hosting

**Easiest:** Deploy to **Render** only (frontend + backend in one place). See **[HOSTING.md](./HOSTING.md)** for the step-by-step guide. One URL to share with everyone.

## Tech

- **Backend:** Node, Express, Socket.io (in-memory lobbies; no DB).
- **Frontend:** Vanilla JS, Vite. Real-time updates via Socket.io.
