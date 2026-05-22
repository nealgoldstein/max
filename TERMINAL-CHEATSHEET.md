# Terminal cheatsheet for Max

A quick reference for the commands you actually use day-to-day on Max.
Open this any time you forget something.

---

## The terminal — what is it?

The terminal is a text-based way to talk to your computer. You type a
command, hit Enter, and the computer does something. The line where you
type starts with a "prompt" — usually ends in a `$` or `%`.

Example of a prompt:

```
(base) nealgoldstein@MacBook-Air-M2-2 ~ %
```

That cryptic mess means:

- `(base)` — your active Python environment (doesn't matter for Max)
- `nealgoldstein@MacBook-Air-M2-2` — you, on your machine
- `~` — **the current folder you're in** (this is the important part)
- `%` — "I'm ready, type a command"

The `~` symbol means your home folder (`/Users/nealgoldstein/`). When
you change folders, that part of the prompt changes too.

---

## The most important command: `cd`

`cd` = "change directory" (= change folder).

You almost always need to be **in the right folder** before running a
command. For Max, you have two folders that matter:

| Folder | What it's for |
|---|---|
| `/Users/nealgoldstein/Desktop/max` | The whole app (frontend + server) |
| `/Users/nealgoldstein/Desktop/max/server` | The backend (Cloudflare Worker, DB, auth) |

To jump between them:

```bash
cd /Users/nealgoldstein/Desktop/max          # go to the main app folder
cd /Users/nealgoldstein/Desktop/max/server   # go to the server folder
cd ~                                          # go back home
cd ..                                         # go up one folder
```

**To see which folder you're in right now:**

```bash
pwd
```

It prints the full path. If you ever feel lost, run `pwd` first.

**To see what's in the current folder:**

```bash
ls
```

---

## Wrangler — your Cloudflare command

Wrangler is the tool that talks to Cloudflare, where your Max backend
lives. **All wrangler commands must be run from the `server` folder.**

So before *any* wrangler command:

```bash
cd /Users/nealgoldstein/Desktop/max/server
```

Then:

### Deploy your code to production

```bash
npx wrangler deploy
```

Run this after editing anything in the `server/` folder. It pushes the
new code to Cloudflare Workers. Takes 10–30 seconds.

### Watch the live server logs

```bash
npx wrangler tail
```

Streams every request as it happens. Useful when you're testing the
app and want to see what the server is doing in real time. Leave it
running while you use the app — you'll see things like:

```
POST /auth/magic-link - Ok @ 5/20/2026, 9:21:07 AM
  (log) <-- POST /auth/magic-link
  (log) --> POST /auth/magic-link 200 916ms
```

To stop watching, press **Ctrl+C** (the Control key + C).

### See which env vars (secrets) are set

```bash
npx wrangler secret list
```

Shows the *names* of all secrets. Doesn't show the values (security).
You're looking for things like `RESEND_API_KEY`, `ADMIN_EMAIL`,
`ALLOWED_EMAILS`, `TURSO_URL`, `TURSO_AUTH_TOKEN`.

### Set or update a secret

```bash
npx wrangler secret put SOMETHING
```

It'll prompt you to paste the value, then hit Enter. After setting
or changing any secret, **redeploy** so the worker picks it up:

```bash
npx wrangler deploy
```

Common secrets you might need to set:

| Secret | What it is |
|---|---|
| `RESEND_API_KEY` | API key from resend.com — used to send emails |
| `RESEND_FROM` | The "from" address (e.g. `Max <hello@send.travelingwithmax.app>`) |
| `ADMIN_EMAIL` | Where new-user notifications go (your inbox) |
| `ADMIN_TOKEN` | Secret password for the `/admin/*` endpoints |
| `ALLOWED_EMAILS` | Comma-separated list of owner emails that bypass approval + get 10-year sessions |
| `TURSO_URL` | The DB connection URL |
| `TURSO_AUTH_TOKEN` | The DB auth token |

---

## Turso — your database

Turso is where your users, trips, sessions, and access grants live.
You talk to it via its CLI.

### Log in (only needed once, or if your config breaks)

```bash
turso auth login
```

If you ever see a "config corrupted" error, fix it with:

```bash
turso auth login --reset-config
```

### See your databases

```bash
turso db list
```

You'll see something like `max-prod` — that's the one Max uses.

### Open the database shell (run SQL commands)

```bash
turso db shell <db-name>
```

For your setup, that's probably:

```bash
turso db shell max-prod
```

You'll get a `→` prompt. Type SQL commands ending in `;`. To exit, type:

```sql
.quit
```

### Useful SQL recipes

**See all sign-in requests (the approval queue):**

```sql
SELECT email, status, name FROM access_grants;
```

**See all confirmed users:**

```sql
SELECT email, display_name, created_at FROM users;
```

**Approve someone immediately (skip the email approval):**

```sql
UPDATE access_grants
SET status='approved', decided_at=strftime('%s','now')*1000,
    approve_token=NULL, deny_token=NULL
WHERE email='someone@example.com';
```

**Delete a pending request (so they can re-request and re-trigger admin email):**

```sql
DELETE FROM access_grants WHERE email='someone@example.com';
```

**Revoke a user's sessions (kick them out immediately):**

```sql
DELETE FROM sessions WHERE user_id IN
  (SELECT id FROM users WHERE email='someone@example.com');
```

### Get DB connection details (for migration scripts)

```bash
turso db show <db-name> --url    # prints the libsql:// URL
turso db tokens create <db-name> # mints a fresh auth token
```

---

## Running database migrations

When the database schema changes, there's a one-time script to run.
These live in `server/scripts/` and are numbered: `apply-migration-0007.ts`,
`apply-migration-0008.ts`, etc.

To run one:

```bash
cd /Users/nealgoldstein/Desktop/max/server

TURSO_URL='libsql://max-prod-nealgoldstein.aws-us-east-2.turso.io' \
TURSO_AUTH_TOKEN='your-real-token-here' \
npx tsx scripts/apply-migration-0008.ts
```

(That's all one command — the backslashes let you break it across
lines. You can also write it all on one line.)

Each migration script:

- Prints what it's doing (`→ adding column X to table Y`)
- Is **idempotent** — safe to re-run if you're not sure
- Ends with `✓ migration NNNN applied` on success

---

## Common errors and fixes

### `command not found: wrangler`

You forgot to `cd` to the server folder, or you're missing the `npx`
prefix. Try:

```bash
cd /Users/nealgoldstein/Desktop/max/server
npx wrangler tail
```

### `Error: could not create turso client: user not logged in`

Run `turso auth login` (or `turso auth login --reset-config` if your
config is broken).

### `could not parse JSON config`

Same fix — `turso auth login --reset-config`.

### `Internal error` when signing in

Usually means a database migration hasn't been run. Check your
recent code commits and look for a new file in `server/scripts/`
starting with `apply-migration-`. Run that.

### Pasted a `<placeholder>` instead of a real value

Easy to do with `<your-token-here>` style placeholders. They get
URL-encoded and turn into errors like `Malformed input`. Re-run
with the actual value substituted in.

### Sign-in says "awaiting approval" but you want to test as that user

Delete their pending grant (see SQL recipes above), or approve them
directly with the SQL UPDATE.

### Wrangler tail shows 200 OK but no email arrived

The handler succeeded but the email might be:

1. In spam at the receiving inbox
2. Stuck in greylisting (re-check Resend dashboard in 10 minutes)
3. The notification only fires when a request is **first created** —
   if there's already a pending row, no new email goes out. Delete
   the row first, then re-request.

---

## Quick navigation cheatsheet

| Want to... | Run |
|---|---|
| Deploy code | `cd ~/Desktop/max/server && npx wrangler deploy` |
| Watch logs | `cd ~/Desktop/max/server && npx wrangler tail` |
| Open DB shell | `turso db shell max-prod` |
| List secrets | `cd ~/Desktop/max/server && npx wrangler secret list` |
| Set a secret | `cd ~/Desktop/max/server && npx wrangler secret put NAME` |
| Apply migration N | See "Running database migrations" above |
| Get out of any prompt | `Ctrl+C` |
| Exit Turso shell | `.quit` |
| Where am I? | `pwd` |
| What's here? | `ls` |

---

## Keyboard shortcuts

| Keys | What they do |
|---|---|
| **Ctrl+C** | Stop whatever is running (cancel a command) |
| **Ctrl+L** or `clear` | Clear the screen |
| **Up arrow** | Recall the last command (keep pressing for older ones) |
| **Tab** | Auto-complete the filename you're typing |
| **Ctrl+A** | Jump to start of line |
| **Ctrl+E** | Jump to end of line |

`~` is shorthand for your home folder (`/Users/nealgoldstein`), so
`~/Desktop/max` is the same as `/Users/nealgoldstein/Desktop/max` —
faster to type.
