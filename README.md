# Greenlight

**Know when you're actually ready to launch.**

Greenlight is a launch-readiness workspace for Web3 teams building on **Base**. A founder defines what
"ready" means, invites the people who own each piece, verifies funding on-chain, and sees — at a glance —
whether the launch is operationally ready. Readiness is **recalculated automatically from real events and
verifiable evidence**; nobody types a percentage. The founder keeps the final call.

Built for **Vibestarter Vibeathon 02 — Night Shift**. Product source of truth:
[`docs/product-one-pager.md`](docs/product-one-pager.md).

> **Testnet only.** Funding is verified on **Base Sepolia** with Circle's test USDC. Greenlight holds no funds,
> deploys no custody contract and exposes no mainnet path.

## What it does

| Capability | How it works |
| --- | --- |
| **Launch Room** | Create/edit a launch, target date + live countdown, mandatory requirements with owners, deadlines and dependencies, blockers with their next action, full activity history. |
| **Contributor Portal** | Single-use private invitations → *accept* → separately *confirm* → submit evidence. Every event carries an authenticated actor and a real timestamp. Nobody can act on someone else's commitment. |
| **Readiness Engine** | A pure, deterministic function (`lib/readiness/engine.ts`). States: satisfied / incomplete / blocked / expired. Evaluates dependencies, deadlines, confirmations and funding. Recalculates in the same transaction as every mutation, and when a deadline passes by itself. |
| **Base integration** | Wallet connect (wagmi), Base Sepolia chain validation, USDC transfer from the browser, then **independent** server-side verification with viem: chain ID, token contract, recipient, amount, receipt status, confirmations. |
| **Recovery** | Contributor unavailable or deadline missed → requirement `BLOCKED`/`EXPIRED` → founder activates the authorised backup (or replaces/extends) → the replacement must genuinely confirm → readiness recalculates. |
| **Launch Readiness Brief** | Shareable (revocable link, print/PDF). Launch identity, requirement status, outstanding blockers, responsibilities, funding transaction links, founder decision + timestamp — with **verified evidence clearly separated from submitted claims**. |

Design/behaviour rules worth knowing: see [`docs/readiness-rules.md`](docs/readiness-rules.md).
How it is built: [`docs/architecture.md`](docs/architecture.md).

## Stack

Next.js 16 (App Router, Server Actions, `proxy.ts`) · React 19 · TypeScript strict · Tailwind CSS 4 ·
Framer Motion · Supabase (Auth, Postgres, Realtime) · wagmi 3 · viem 2 · zod · Vitest · Playwright · Vercel.

## Set up

Prerequisites: Node ≥ 20.19, a Supabase project, a browser wallet (for the funding step).

### 1. Supabase — Greenlight shares your project safely

Greenlight is designed to live in a Supabase project that **already hosts other applications**. It never touches
`public` or any existing object:

- Everything is created in its own **`greenlight` schema**, owned by a dedicated **`greenlight_app`** role
  (`supabase/bootstrap.sql` + `supabase/migrations/`).
- The app logs in as `greenlight_app`, which can see only that schema: it cannot read other apps' tables or
  `auth.users`, and it has no `service_role` key or admin credentials.
- Browsers get `SELECT` on three Greenlight tables (for Realtime) and nothing else; the schema is not exposed to
  PostgREST, so there is no REST path to the data. Row Level Security is a second wall (`tests/rls.test.ts`).
- **Supabase Auth is shared**, so one account works across all apps on the project. Authorization is by Greenlight
  workspace membership, not by having an account. Project-wide Auth settings (email confirmation, SMTP, Site URL)
  are **never changed by Greenlight**.

Setup, in order (every step before step 5 is read-only):

1. `npm run env:init -- <project-ref>` — creates `.env.local` (git-ignored) with the project URL and freshly
   generated secrets.
2. In the Supabase dashboard: **Project Settings → API Keys** → copy the **publishable** key into
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. **Connect → Session pooler** → copy the connection string for the `postgres` role, fill in your database
   password, and paste it as `MIGRATION_DATABASE_URL`. (Session pooler works on IPv4 networks; the direct host is
   IPv6-only.) Then run `npm run env:compose` to derive the app's own `DATABASE_URL`.
4. `npm run db:audit` — read-only compatibility report: server version, privileges, name clashes, triggers on the
   shared `auth.users`, the realtime publication, and the project's public Auth settings. It prints a verdict.
5. `npm run db:migrate -- --dry-run` — applies everything inside a transaction and **rolls it back**; then
   `npm run db:migrate` to apply for real. Both are idempotent and atomic.

Rehearse the whole rollout locally first, with no credentials, against a simulated shared project (another app's
tables and data, a trigger on `auth.users`, a non-superuser admin): `npm run db:rehearse`.

**Things to decide on the shared project** (Greenlight will not change them for you):

- *Email confirmation.* If it is on, sign-up shows "check your inbox" and `/auth/callback` completes the session.
  The email uses the project's shared template and **Site URL**; to make the link land on Greenlight, add
  `https://<your-domain>/auth/callback` to **Authentication → URL Configuration → Redirect URLs** (additive — it
  does not alter the Site URL). If it is off, sign-up signs the user in immediately.
- *Triggers on `auth.users`.* If another app has one, it also fires when someone signs up through Greenlight
  (`db:audit` lists them). Greenlight does not modify it.
- *Existing accounts.* People who already have an account on the project simply sign in; they are not prompted to
  create a new one.

### 2. Environment variables

`.env.local` (or Vercel's environment settings) — see [`.env.example`](.env.example):

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Publishable key. Safe in the browser. |
| `DATABASE_URL` | **server** | The `greenlight_app` login (transaction pooler, port 6543). Never the `postgres` role. |
| `DATABASE_POOL_MAX` | server, optional | Connections per instance (default 3; use `1` on serverless). |
| `BASE_SEPOLIA_RPC_URL` | server, optional | Dedicated RPC. Defaults to `https://sepolia.base.org`. |
| `CRON_SECRET` | **server** | Authenticates the scheduled sweep. |
| `MIGRATION_DATABASE_URL` | **local only** | `postgres` role, for `db:audit` / `db:migrate`. **Never set in Vercel.** |
| `GREENLIGHT_DB_PASSWORD` | **local only** | Becomes the `greenlight_app` password (sent as a SCRAM verifier, never in plaintext). |

No secret, service-role key or database password is ever placed in a `NEXT_PUBLIC_` variable or logged.

### 3. Run

```bash
npm install
npm run dev
```

### 4. Get test funds (for the funding step)

Test ETH for gas from a Base Sepolia faucet, and test USDC from <https://faucet.circle.com> (choose *Base
Sepolia*). Token: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (decimals are read from the contract).

## Security boundaries

- **Authorization is server-side**, in `lib/services/access.ts`, from a signature-verified JWT. The browser
  cannot name its own identity.
- **Isolation and least privilege.** Own schema, own role; the app role cannot read other apps' tables or `auth.users`.
  Browsers have `SELECT` on three tables and no write path; RLS holds even if privileges were widened by mistake
  (`tests/rls.test.ts`, 11 tests).
- **Invitations**: 256-bit secrets, stored hashed, single-use, expiring, revocable. The founder cannot accept
  their own invitation or confirm for anyone.
- **Funding is never trusted from the client.** Only the hash is accepted; everything else is re-derived from
  the chain. Each `(chain, tx)` can be credited once, ever (DB unique constraint). Rejected attempts do not
  consume the hash.
- **URL checks are SSRF-guarded**: https only, no IP literals, no credentials, public-address enforcement at
  connect time, redirect re-validation, timeout.
- **Open-redirect, enumeration and leak protections**: `next` is restricted to same-site paths; outsiders get
  404s; public briefs withhold note bodies and contributor emails; DB error logs contain statement text only.
- **AI is not in the readiness path.** Recovery messages are deterministic templates the founder sends
  themselves.

## Testing

```bash
npm run typecheck && npm run lint
npm test                 # unit + integration (real migrations on embedded Postgres)
npm run test:live        # verifier vs the real Base Sepolia RPC (opt-in, needs internet)
```

End-to-end (Playwright, real browser, four independent sessions):

```bash
# terminal 1 — real PostgreSQL + a local stand-in for Supabase Auth (fresh database on every start)
npm run e2e:stack          # postgres :54329, auth :54330 (override with E2E_DB_PORT / E2E_AUTH_PORT)

# terminal 2 — build and start the app against it (NEXT_PUBLIC_* values are inlined at build time)
export DATABASE_URL=postgres://greenlight_app:e2e@127.0.0.1:54329/postgres
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54330 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local
export CRON_SECRET=local-e2e-cron-secret-123
npm run build && npx next start -p 3300

# terminal 3
npm run test:e2e           # E2E_BASE_URL defaults to http://127.0.0.1:3300
```

The stack uses a genuine PostgreSQL server (`embedded-postgres`) with the project's migrations and a **local
stand-in for Supabase Auth** that issues signed JWTs. It lets the full browser workflow run without a Supabase
project; it is **not** Supabase. **Restart the stack before each run**: a given on-chain transaction can be credited
only once per database (that guard is a feature the e2e asserts).

## Deployment

1. Push to GitHub and import into Vercel (or `vercel deploy`).
2. Set the environment variables above for *Production*.
3. Apply the migration to the Supabase database (`npm run db:migrate`).
4. `vercel.json` registers a daily Cron (`/api/cron/sweep`, Hobby-plan limit) that records expirations and
   promotes pending funding even when nobody has a room open. Rooms also sweep themselves on every view.

## Verification evidence (measured, 2026-11-03)

Everything below was run on this code; numbers are copied from the runners' own output.

| Check | Result |
| --- | --- |
| `tsc --noEmit` (strict), `eslint` | clean |
| Unit + integration (`vitest run`) | **136 passed, 0 failed, 7 skipped** (the 7 are the opt-in live-chain tests) |
| ↳ readiness engine | 39: dependencies, missing/expired confirmations, exact-deadline boundary, evidence tiers, funding accumulation, transitions, bigint amounts |
| ↳ workflow/integration (real PostgreSQL, production adapter) | 55: vertical slice, authorization, duplicate events, concurrent updates, funding, recovery/replacement, brief and decision |
| ↳ Row Level Security | 5: read scoping, revoked access, no browser write path |
| ↳ on-chain verifier (viem, fake RPC) | 12: wrong recipient/token/network, revert, confirmations, batching |
| ↳ SSRF guard | 25 |
| Live chain (`npm run test:live`, real Base Sepolia RPC) | **7 passed** |
| Browser (Playwright, one run) | **27 passed, 0 failed**: desktop has 8 axe WCAG A/AA scans (light and dark), 9 public-page tests and 1 full workflow; mobile (Pixel 5) has 9 public-page tests |
| Mutation spot-checks | removing the assignment-ownership check, and re-introducing jsonb double-encoding, each made the relevant tests fail |

**The full workflow test** drives four independent browser sessions (Founder, Ada, Grace, and Mallory as an outsider) through:
sign-up → workspace → launch → four requirements → private invitations → Ada accepts and confirms (the founder's room
recalculates on its own) → funding verified against the real chain → server-side site check → a deadline expiring on
its own → EXPIRED/blocked with a proposed recovery → backup activated → Grace confirms → **READY TO LAUNCH** →
authorization checks (outsider and contributor get 404 on founder pages) → founder decision → brief with
verified-versus-submitted labels → public share link → revocation (404) → no horizontal overflow at 320 px and 390 px
on the room, brief, dashboard and portal.

**Blockchain proof.** The funding step is verified against a *real, pre-existing* USDC transfer on Base Sepolia. It was
not created by Greenlight; it is used to show that independent verification works on genuine chain data:
[0x1b93805d…df0c4](https://sepolia.basescan.org/tx/0x1b93805d4e4a68d01b7e0f4a67bf50bb6aa8727f8b2c378165defb872d7df0c4)
(0.001 USDC, block 53791002, sender `0x3dc4…801d` → recipient `0xa849…79d9`). `decimals()` was read from the token
contract (6), not assumed. **No Greenlight-originated transaction has been sent yet.** That needs a funded wallet.

**Failures found and fixed by this verification** (kept for honesty): event payloads written as double-encoded JSON
strings by the production driver (caught only once tests ran on real PostgreSQL, not by the earlier simulated database);
horizontal overflow on the landing header and on evidence rows in the populated room at 320 px; a hydration race that
made early clicks no-ops; and two bugs in the specs themselves.

**Not verified yet**, because it needs the owner's accounts or other people: a real Supabase project (Auth email flow and
Realtime push; the app falls back to 20 s polling and deadline timers when Realtime is unavailable, which is what ran
locally); a Vercel production deployment; a wallet-originated transfer through the in-app Send button; usability
testing with first-time users; feedback from five launch operators.

## Limitations (honest notes)

- Invitation links are **copied by the founder** (with a drafted message). Greenlight does not send email/Telegram.
- Confirmations prove an *authenticated account* confirmed, not that work will be delivered. Readiness is an
  operational record, not a guarantee, an investment safety signal or a market prediction.
- "Controlled test settlement" is **not implemented**: Greenlight verifies funding, it does not move it.
- A pre-existing on-chain transfer can be claimed by whoever submits its hash first (within a launch they
  participate in) — a signed-message link between submitter and sending wallet is the natural next step.
- Willingness to pay is **unvalidated**; the one-pager's customer-validation requirement (five launch operators)
  has not been done.

## Project layout

```
app/            routes, server actions (landing, /app, /portal, /invite, /brief, /api/cron)
components/     UI (room/, landing/) — client components call server actions only
lib/readiness/  the engine (pure) + its tests
lib/services/   authorization + business rules (one file per capability)
lib/chain/      Base Sepolia config and viem verifier
lib/verify/     SSRF-guarded URL checker
supabase/       migrations
tests/ e2e/     integration, RLS and browser tests; e2e/support is the local stack
docs/           product one-pager, architecture, readiness rules, demo script
```
