# Architecture

```
 Browser ──────────────────────────────────────────────────────────────────────────┐
  Next.js App Router (React 19)                                                     │
  ├─ Server Components: render rooms, briefs, portal from fresh state               │
  ├─ Server Actions: every mutation (founder + contributor)                         │
  └─ Client: wagmi (wallet), Framer Motion, Supabase Realtime (notifications only)  │
        │ cookies (Supabase session)                          │ websocket             │
        ▼                                                     ▼                       │
 proxy.ts ── getClaims() refreshes session; redirects anonymous users                 │
        │                                                                             │
        ▼                                                                             │
 lib/server/action.ts ── authenticates (JWT-verified) → calls a service ──────────────┘
        │
        ▼
 lib/services/*  (authorization + business rules, one file per capability)
   withLaunch(): BEGIN → SELECT … FOR UPDATE on the launch row → idempotency check
                 → mutate → append event → recompute readiness → COMMIT
        │
        ├──► lib/readiness/engine.ts   pure function, no I/O
        ├──► lib/chain/verifier.ts     viem → Base Sepolia RPC (independent verification)
        ├──► lib/verify/url-check.ts   SSRF-guarded server-side fetch
        ▼
 Postgres (Supabase)   RLS on every table; the only policies are read-only
```

## Why server-side TypeScript instead of PostgREST + RLS for writes

All state changes go through server actions that connect with a privileged role. Authorization is
explicit code (`lib/services/access.ts`) exercised by tests, and every mutation is a single transaction
that also writes the audit event and recomputes readiness. Row Level Security is kept as a second wall:
**no write policies exist**, and the only read policies serve Realtime (`launches`, `events`, scoped to
people who may see that launch). A compromised browser session cannot write directly.

## Concurrency, duplicates, staleness

| Hazard | Mitigation |
| --- | --- |
| Two people act at once | Every mutation takes `SELECT … FOR UPDATE` on the launch row inside one transaction, so mutations for one launch are serialised. |
| Two people race for one invitation link | The assignment is re-read under that lock; exactly one wins, the other gets a conflict. The token hash is cleared on use. |
| Double click / retried request | Clients send an idempotency key; `events(launch_id, idempotency_key)` is unique and checked under the lock, so the intent is applied once. |
| Same funding transaction submitted twice (or to two launches) | `UNIQUE (chain_id, tx_hash)` on `funding_transactions`. |
| Two live owners for one requirement | Partial unique indexes on `assignments`. |
| Stored verdict out of date | Every mutation recomputes and stores the verdict before commit (`launches.rev` increments). Reads always evaluate fresh against `now`. |
| Deadline passes with nobody looking | Evaluated at read time; `sweepLaunch` persists `requirement.expired` (once, by idempotency key) on every read and via Vercel Cron. |
| Chain state changes after crediting (reorg) | `reverifyFunding` re-checks pending **and** verified transactions; a vanished receipt withdraws the credit and readiness reverts. |

## Data model

`profiles` · `workspaces` · `workspace_members(owner|contributor)` · `launches` · `requirements` ·
`assignments` (primary/backup, hashed invitation token) · `evidence` · `funding_transactions` · `events`
(append-only activity log with actor, timestamp, payload). See
[`supabase/migrations/0001_core.sql`](../supabase/migrations/0001_core.sql).

## Trust boundaries

- **Identity** comes only from a signature-verified Supabase JWT (`getClaims`), never from request input.
- **Founder** = `workspace_members.role = 'owner'`. **Contributor** = holder of a live assignment.
- A contributor can act only on assignments whose `user_id` is theirs; the founder cannot confirm on
  anyone's behalf, accept their own invitations, or submit a contributor's deliverable evidence.
- Outsiders get a 404 for rooms they cannot see — existence is not revealed.

## Invitations

256-bit random secret, shown to the founder once, stored only as SHA-256. Single-use (hash cleared on
accept/decline), 7-day expiry, revocable, re-issuable. Dispatch is manual (the founder copies the link and
a drafted message): Greenlight never messages anyone on the founder's behalf.

## Base integration

Verification, not custody. For a funding requirement Greenlight stores the token, recipient, amount and
confirmation depth. A submitted hash is only a pointer; the verifier re-derives everything from the chain:

1. RPC `eth_chainId` equals 84532 (and the requirement's chain is 84532).
2. Receipt exists (not found → rejected, never stored) and `status == success`.
3. `Transfer` logs emitted **by the configured token contract** with `to == recipient`; amounts are summed
   (batched payouts work; look-alike token contracts do not).
4. `latestBlock − receiptBlock + 1 ≥ minConfirmations`, else `pending`.
5. Block time comes from the chain and is what deadlines are compared against.

Allow-list: Base Sepolia only, Circle test USDC only (`lib/chain/config.ts`). `decimals()` and `symbol()`
are read from the contract when a requirement is created. Rejected attempts are audited but do not
consume the hash.

## What is intentionally out of scope

Token deployment, trading, market making, social posting, influencer discovery, performance prediction,
dispute arbitration, unrestricted mainnet custody, an automated email/Telegram dispatcher, and a
settlement contract (see README → Limitations).
