# Hosting “Who Am I?”

**Easiest: use Render for everything** — one deployment, one URL. No env vars to wire up.

---

## Option A: Render only (recommended)

Frontend and backend run in a single Render Web Service. Everyone uses one URL.

### Steps

1. Go to [render.com](https://render.com) and sign in (or create an account).
2. Click **New** → **Web Service**.
3. Connect your GitHub (or GitLab) and select the **guessit** repo.
4. Configure:
   - **Name:** `guessit` (or any name).
   - **Region:** Choose one close to you.
   - **Branch:** `main` (or your default branch).
   - **Runtime:** **Node**.
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run server`
   - **Instance type:** Free (or paid if you prefer).

5. Click **Create Web Service**. Wait for the first deploy to finish.
6. Copy the service URL (e.g. `https://guessit-xxxx.onrender.com`). That’s your game link — share it with everyone.

**Using the repo’s `render.yaml`:**  
You can instead use **New** → **Blueprint**, connect the repo, and let Render create the web service from the YAML (build and start commands are already set).

### No extra config

- You do **not** set `VITE_API_URL`. The frontend is served by the same server as the API and Socket.io, so it uses the same origin.
- One URL for the whole app.

---

## Option B: Vercel (frontend) + Render (backend)

Use this only if you want the frontend on Vercel and the backend on Render (two deployments, two URLs to configure).

1. **Deploy the backend on Render**  
   Same as Option A, but use:
   - **Build Command:** `npm install` (no `npm run build`)
   - **Start Command:** `npm run server`  
   Copy the Render URL (e.g. `https://guessit-api.onrender.com`).

2. **Deploy the frontend on Vercel**  
   - Import the **guessit** repo as a new project.
   - Add an **environment variable:**  
     **Name:** `VITE_API_URL`  
     **Value:** your Render URL (e.g. `https://guessit-api.onrender.com`) — no trailing slash, use **https**.
   - Deploy. Share the **Vercel URL** as the game link.

---

## Troubleshooting

- **“Can’t reach the server” when joining:** (Option B only) Redeploy on Vercel after setting or updating `VITE_API_URL`.
- **Lobby not found / wrong password:** Use the exact lobby name and password the host shared. Lobby names are unique.
- **Render free tier:** The service may spin down after inactivity; the first load after a while can be slow. Paid plans keep it always on.
