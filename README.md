# GLOBAL Organisation

**From Nigeria, building solutions for Africa and the world.**

Online-ready Node.js app: problems → ideas → teams → projects → opportunities, with feed, AI, moderation, and leadership accounts.

---

## Requirements

- **Node.js 18+**
- No paid API keys required to run (optional keys unlock more features)

---

## Quick start (local)

```bash
npm install
npm start
```

Open **http://localhost:3000**

Optional (better for real users):

```bash
npm install better-sqlite3
npm start
```

---

## Deploy online (Railway / Render / Fly / VPS)

### 1. Upload or connect this folder

### 2. Build & start

| Setting | Value |
|---------|--------|
| **Build** | `npm install` |
| **Start** | `npm start` |
| **Node** | 18 or 20 |

`Procfile` and `render.yaml` are included.

### 3. Environment variables (optional)

Copy from `.env.example` or set in the host dashboard:

| Variable | Purpose | Required? |
|----------|---------|-----------|
| `PORT` | Server port (hosts usually set this) | Auto |
| `ANTHROPIC_API_KEY` | Full GLOBAL AI (Claude) | No — local AI works without it |
| `GNEWS_API_KEY` | Live news | No — falls back to platform news |
| `PAYSTACK_SECRET_KEY` | Featured opportunity payments | No — payments stay off |

### 4. Important for production

### Critical: writable disk

The app **must** be able to write to:

- `data/` — accounts, posts, problems, ideas  
- `uploads/` — profile photos and post media  

On Railway/Render free tiers, enable a **persistent volume** or disk for these folders, or data is lost on every redeploy.



- Server listens on **`0.0.0.0`** (reachable from the internet)
- All API calls use **relative** `/api/...` paths (works on any domain)
- Persist the **`data/`** folder (database) and **`uploads/`** (photos/videos) across deploys
- Use **HTTPS** (Railway/Render/Fly provide this)

### 5. After first deploy — test checklist

- [ ] Home and Feed open
- [ ] Register + Login work
- [ ] Post text + photo on Feed
- [ ] Create a Problem / Idea / Project
- [ ] Search (type in header + Enter)
- [ ] Login as CEO or Founder → `/admin.html` and `/moderation.html`
- [ ] Settings → upload profile photo

---

## Leadership logins (seeded automatically)

| Role | Name | Username | Password |
|------|------|----------|----------|
| **CEO** | Sultanic the iconic | `ceo` | `CEOGlobal2026!` |
| **Founder** | Maridiyat Salaudeen | `founder` | `FounderGlobal2026!` |

Both are **admins**. Change passwords after first login.

- Admin dashboard: `/admin.html`
- Moderation: `/moderation.html`
- Privacy: `/privacy.html`
- Terms: `/policy.html`

---

## Features

| Area | Status |
|------|--------|
| Feed (infinite scroll + photos/video) | Yes |
| Ideas, Problems, Projects, Opportunities, Teams | Yes |
| Auth, Profile, photo upload | Yes |
| Messages, Notifications | Yes |
| GLOBAL AI (Claude or local) | Yes |
| News, Research (OpenAlex) | Yes |
| Search | Yes |
| Reports + Moderation | Yes |
| Admin / CEO dashboard | Yes |
| Paystack featured listings | When key set |

---

## Database

| Mode | How | Files |
|------|-----|--------|
| **SQLite** (recommended) | `npm install better-sqlite3` | `data/global.sqlite` |
| **JSON** (default) | Works out of the box | `data/global-db.json` |

Back up `data/` and `uploads/` regularly.

---

## Project structure

```
server.js          Express API (0.0.0.0)
db.js              SQLite or atomic JSON
assets/            CSS + JS (feed, shell)
data/              Database (create on first run)
uploads/           Avatars + post media
Procfile           Heroku/Railway-style start
render.yaml        Render blueprint
.env.example       Env var template
DEPLOY.md          Extra production checklist
```

---

## Architecture

```
Browser  →  /api/... (same domain)
              ↓
Express on 0.0.0.0:PORT
              ↓
data/  +  uploads/  +  optional Anthropic / GNews / Paystack / OpenAlex
```

---

## More detail

See **DEPLOY.md** for the full production checklist (backups, admin, scaling).

## License

Prototype for GLOBAL Organisation.
