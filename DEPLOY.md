# Production deployment checklist

## Host

Railway, Render, Fly.io, or any VPS with Node 18+.

| Step | Action |
|------|--------|
| 1 | Upload this project (without `node_modules`) |
| 2 | Build: `npm install` |
| 3 | Start: `npm start` |
| 4 | Set env vars if you have keys (see `.env.example`) |
| 5 | Ensure `data/` and `uploads/` persist (volume or sticky disk) |

## Persist data

Without a persistent disk, **user accounts and photos are lost on every redeploy**.

- Attach a volume mounted at the app root or at `./data` and `./uploads`
- Or back up those folders on a schedule

## Optional: SQLite

```bash
npm install better-sqlite3
```

Restart the app. Status at `/api/status` should show `"database": "sqlite"`.

## Leadership

Seeded on first start:

- **CEO** `ceo` / `CEOGlobal2026!` — Sultanic the iconic  
- **Founder** `founder` / `FounderGlobal2026!` — Maridiyat Salaudeen  

Open `/admin.html` after login.

## Security before public launch

- [ ] Change CEO and Founder passwords  
- [ ] HTTPS only  
- [ ] Confirm moderation works (`/moderation.html`)  
- [ ] Read Privacy + Terms (`/privacy.html`, `/policy.html`)  
- [ ] Optional: Anthropic / GNews / Paystack keys  

## Scaling later

1. Postgres instead of SQLite/JSON  
2. Object storage (S3/R2) for uploads  
3. Rate limits on register, AI, posts  
4. Session cookies + bcrypt  

## Health check

`GET /api/status` — should return `"status": "online"` and service flags.
