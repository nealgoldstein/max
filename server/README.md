# Max Server

Backend for the Max travel planner. Provides:

- **Auth** — bearer-token sessions (dev mode now; OAuth/magic-link in the next round)
- **Trip sync** — CRUD over each user's trips, with last-write-wins conflict detection so desktop and mobile stay in step
- **LLM proxy** *(next round)* — server-side Anthropic calls so users don't paste their own API keys

## Stack

| Layer        | Choice                          | Why                                                                                       |
|--------------|---------------------------------|-------------------------------------------------------------------------------------------|
| Runtime      | Node 20+ via `tsx`              | Native everywhere; switch to Bun later if you want                                        |
| Framework    | [Hono](https://hono.dev)        | Tiny, runs on Node / Bun / Cloudflare / Vercel — won't lock you in                        |
| ORM          | [Drizzle](https://orm.drizzle.team) | TypeScript-first; SQLite for dev, Postgres for prod, same schema                      |
| DB driver    | `@libsql/client`                | Prebuilt binaries for every platform; works locally as a file, on Turso as a remote DB    |
| Validation   | Zod                             | Same pattern as the Anthropic SDK                                                         |

## First run

```bash
cd server
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY (used by the LLM proxy in the next round)
npm install
npm run db:push        # creates max.db with the schema
npm run dev            # starts http://localhost:3030
```

Hit it:

```bash
# Health
curl http://localhost:3030/health

# Dev login — get a bearer token
TOKEN=$(curl -s -X POST http://localhost:3030/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}' | jq -r '.token')

# Create a trip
curl -X POST http://localhost:3030/trips \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"t1","name":"Iceland","body":{"destinations":[]}}'

# List your trips
curl -H "Authorization: Bearer $TOKEN" http://localhost:3030/trips

# Update (sync write — include your local updatedAt)
curl -X PUT http://localhost:3030/trips/t1 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"body\":{\"destinations\":[{\"place\":\"Reykjavik\"}]},\"updatedAt\":$(date +%s)000}"
```

## Layout

```
server/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env.example
├── drizzle/                       # Generated SQL migrations
│   └── 0000_bored_sleeper.sql
├── src/
│   ├── index.ts                   # Server entry
│   ├── db/
│   │   ├── client.ts              # libsql + drizzle init
│   │   └── schema.ts              # Tables: users, sessions, trips
│   ├── lib/
│   │   └── auth.ts                # Bearer-token middleware + devLogin
│   └── routes/
│       ├── auth.ts                # POST /auth/dev-login
│       └── trips.ts               # CRUD + sync
└── test/                          # (next round)
```

## Sync model — last-write-wins (LWW)

Each `trips` row carries an `updatedAt` (ms since epoch). On `PUT /trips/:id`, the
client sends its local `updatedAt`. If the server's row is newer, we return **409
Conflict** with the server's full row, and the client decides whether to overwrite
(`force: true` on retry) or accept the server version.

This is intentionally simple. v1 is fine for "I edit on desktop, then mobile picks
up the change" — the only conflict surface is when the same user edits the same
trip on two devices simultaneously, which is rare. If that gets common we add
per-field merge in a later round.

## What's NOT here yet (and where it's coming)

- **Real auth.** Replace `devLogin` with email magic-link or Google OAuth. The
  rest of the server doesn't change — `requireAuth` already abstracts the
  user lookup.
- **LLM proxy.** `POST /llm/messages` will accept the same payload `callMax` in
  the desktop client sends, forward to Anthropic with the server's API key,
  return the response. Per-user rate limiting + caching go here.
- **Billing.** Stripe + a usage table; users get N free tokens/month, then a
  paid tier. Hooks into the LLM proxy.
- **Push notifications.** Cancel-deadline reminders, trip-day-reached
  notifications. Web Push for PWA, APNs/FCM via Capacitor wrap.
- **Production deploy.** Postgres + Fly/Cloudflare/Railway. The Drizzle schema
  is dialect-agnostic; only `src/db/client.ts` swaps out.

## Wiring the desktop client to use it

Coming in a follow-up round. The plan:

1. Add a server-URL setting to the desktop UI (default `http://localhost:3030` for dev).
2. Add a sign-in surface that calls `/auth/dev-login` and stashes the bearer token.
3. After every `_emitTripMutation()`, fire a `PUT /trips/:id` with the new body
   plus current `updatedAt`. Treat 409 as "newer on server, prompt user."
4. On startup, `GET /trips` and pull anything newer than local.
5. Mobile uses the same calls; both surfaces converge on the server as the
   source of truth.

The architectural seam is already in place — `_emitTripMutation()` is the one
function every mutator goes through. Adding a remote-save tap there is a
4-line change.
