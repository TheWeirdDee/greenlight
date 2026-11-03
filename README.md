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

### 1. Supabase

1. Create a project at <https://supabase.com>.
2. **Authentication → Providers → Email**: enable. For smooth multi-person demos turn **"Confirm email" off**
   (Supabase's built-in SMTP is rate-limited to a few emails per hour).
3. **Project Settings → API**: copy the project URL and the **publishable** key.
4. **Project Settings → Database → Connection string**: copy the *transaction pooler* string (port 6543) for the
   app, and the *direct* string (port 5432) for migrations.
5. **Database → Replication**: nothing to do — the migration adds `events` and `launches` to the
   `supabase_realtime` publication.

### 2. Environment variables

Copy [`.env.example`](.env.example) to `.env.local`:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Publishable (anon-equivalent) key. Safe in the browser; RLS protects data. |
| `DATABASE_URL` | **server** | Postgres connection used by server actions (bypasses RLS — never expose). |
| `DATABASE_POOL_MAX` | server, optional | Connections per instance (default 3; use `1` on serverless). |
| `BASE_SEPOLIA_RPC_URL` | server, optional | Dedicated RPC. Defaults to `https://sepolia.base.org`. |
| `CRON_SECRET` | **server** | Authenticates the scheduled sweep (`openssl rand -hex 32`). |

No secret or service-role key is ever placed in a `NEXT_PUBLIC_` variable, and none is logged.

### 3. Migrate and run

```bash
npm install
DATABASE_URL="<direct connection string>" npm run db:migrate   # idempotent
npm run dev
```

### 4. Get test funds (for the funding step)

Test ETH for gas from a Base Sepolia faucet, and test USDC from <https://faucet.circle.com> (choose *Base
Sepolia*). Token: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (decimals are read from the contract).

## Security boundaries

- **Authorization is server-side**, in `lib/services/access.ts`, from a signature-verified JWT. The browser
  cannot name its own identity.
- **No browser write path.** RLS is enabled on every table; the only policies are read-only and scoped
  (`tests/rls.test.ts` proves it as the `authenticated` role).
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
npm run e2e:stack        # real Postgres + a local stand-in for Supabase Auth (see note below)
# build & start the app pointed at it, then:
npm run test:e2e
```

The e2e stack uses a real PostgreSQL server (via `embedded-postgres`) with the project's migrations and a
**local stand-in for Supabase Auth** that issues signed JWTs. It lets the full browser workflow run without a
Supabase project; it is **not** Supabase. Restart the stack between runs — a given on-chain transaction can only be
credited once per database.

## Deployment

1. Push to GitHub and import into Vercel (or `vercel deploy`).
2. Set the environment variables above for *Production*.
3. Apply the migration to the Supabase database (`npm run db:migrate`).
4. `vercel.json` registers a daily Cron (`/api/cron/sweep`, Hobby-plan limit) that records expirations and
   promotes pending funding even when nobody has a room open. Rooms also sweep themselves on every view.

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
