# PPT Maker API

Hono + Bun backend. Async job queue pattern (submit → worker → SSE).

## Develop

```bash
bun install
bun run db:push   # create/migrate schema (needs postgres running)
bun run dev       # start API on :8080
```

Copy `.env.example` → `.env` and fill in `DATABASE_URL`.
