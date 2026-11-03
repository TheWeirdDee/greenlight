# Greenlight — verification report

**Status: NOT READY for a "production-verified" claim.** Substantial parts are verified; the items in
[§ Remaining manual actions](#remaining-manual-actions) are not. This report keeps six kinds of evidence
separate on purpose — read the label on every claim.

| | Evidence class | Meaning |
| --- | --- | --- |
| **A** | Source-code inspection | Read the code; no execution |
| **B** | Local automated tests | Real PostgreSQL + a **local stand-in** for Supabase Auth. *Not* Supabase |
| **C** | Real Supabase integration | Against project `cbggmexoujnlnvgsxnfc` (shared with other apps) |
| **D** | Live Base Sepolia | Real chain, real RPC |
| **E** | Deployed production browser tests | Playwright against the Vercel URL |
| **F** | Manual user validation | Humans using the product |

## Identity of what was tested

| | |
| --- | --- |
| Local `HEAD` / `origin/main` | `d0e20d0976365e360f1b0c99713e6db9576b1392` (identical; later report/test-only commits are listed in `git log`) |
| GitHub | <https://github.com/TheWeirdDee/greenlight> (`main`, pushed without force; the repo was empty before) |
| Production URL | <https://greenlight-gold-eight.vercel.app> (Vercel project `divines-projects-36ae43d8/greenlight`, Git-connected) |
| Deployment E-tests ran against | built from `cbf4d4f`; `git diff cbf4d4f d0e20d0` touches **no application source** (tests, scripts, config only) |

## A. Source-code inspection — findings

Independent audit of the whole repository, deliberately not relying on the earlier test suite.

**Is it a coherent product?** Yes: one data model (`launch → requirements → assignments/evidence/funding →
events`), one engine, one write path. Every visible control maps to a server action; the controls spec (below)
exercises them. **Hidden mocks:** none in shipped code (grep for mock/fake/stub/hardcoded markers across `app/`,
`components/`, `lib/` returned nothing); the only code that writes the stored readiness verdict is
`lib/services/core.ts → recompute` (the engine's output). Fakes exist only in `tests/`. The landing-page "live sample"
is labelled *illustrative* and runs the same engine in the browser.

**How it differs from a checklist:** requirements are satisfied by recorded evidence from the accountable person's own
account or by Greenlight's own checks (chain / server fetch), deadlines expire automatically, dependencies gate,
recovery is an authorised action, and the output is a brief that separates *Verified* from *Submitted claim*. The
landing page now says this explicitly (a "Why not Notion, Trello or a spreadsheet?" comparison).

### Findings and dispositions

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | **High** | URL evidence accepted `javascript:` / `data:` links and rendered them as hrefs (stored-XSS vector) | **Fixed** — validated to http(s), rendering guarded, 13 tests |
| 2 | **High** | No security headers / CSP | **Fixed** — CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS (verified on production, class E) |
| 3 | **High** | Migration created objects in `public` of a *shared* Supabase project (collision/overreach risk) | **Fixed** — own `greenlight` schema + `greenlight_app` role; rehearsed (17 checks) and verified on the real project (23 checks, class C) |
| 4 | Medium | Readiness engine result depended on row order when a requirement had two live owners (found by the differential property test) | **Fixed** — conflicting owners now block |
| 5 | Medium | Failed sign-in wiped the typed email (React resets forms after actions) | **Fixed** + regression tests |
| 6 | Medium | No rate limiting on actions that call the network (site check, funding verification) | **Fixed** — per-person limits (best effort, per instance) |
| 7 | Medium | No mobile navigation on the landing page; room was a 5,500 px column on phones | **Fixed** (menu with Escape/focus handling; jump-nav in the room) — the room is still long on phones |
| 8 | Medium | Audit script printed "compatible" when it failed to connect | **Fixed** — fails closed |
| 9 | Medium | Submitting evidence gave no visible confirmation (history collapsed) | **Fixed** |
| 10 | Low | "Waiting" icon read as Σ; duplicate invite forms; redundant truncated pills; heavy decision panel | **Fixed** |
| 11 | Low | Landing lacked an explicit "when to use it" and comparison with checklists | **Fixed** |

**Residual security notes (not fixed):** CSP still needs `'unsafe-inline'` for scripts/styles (Next.js inline bootstrap
and the theme script; a nonce-based CSP is the next step). The rate limiter is per instance, not distributed. The
database password for the admin role was echoed once into this working session by a diagnostic and **should be rotated**
(Project Settings → Database → Reset password; then update `MIGRATION_DATABASE_URL`). No Critical findings were identified.

## B. Local automated tests (local stand-in for Supabase Auth — **not** production evidence)

| Check | Result |
| --- | --- |
| `tsc --noEmit` (strict), `eslint` | clean |
| Unit + integration (`vitest run`, real PostgreSQL via the production adapter) | **163 passed, 0 failed, 7 skipped** (the 7 are opt-in live-chain tests, class D) |
| ↳ readiness engine (hand-written scenarios) | 39 |
| ↳ readiness engine, **differential property tests vs an independent oracle** | 8 tests over **4,000 random launches** (READY ⇔ all mandatory satisfied; per-requirement agreement; order-independence; monotonicity; purity) |
| ↳ workflow / authorization / concurrency / funding / recovery / brief | 55 |
| ↳ privileges + RLS + isolation from other apps | 11 |
| ↳ security (hostile links, rate limits, inert markup) | 13 |
| ↳ on-chain verifier (fake RPC) / SSRF guard | 12 / 25 |
| Shared-project rehearsal (`npm run db:rehearse`) | 17/17 |
| Mutation spot-checks | removing the ownership check, re-introducing jsonb double-encoding, and weakening the deadline rule each made tests fail |
| Browser (Playwright, fresh local stack) | see **Final local browser run** below |

One full `vitest` run showed 2 failures that I could not reproduce in two further full runs and did not capture the names
of; I treat them as unexplained and intermittent (start-up contention) and raised the DB-suite timeouts. They are not
claimed fixed.

## C. Real Supabase integration (project `cbggmexoujnlnvgsxnfc`)

| Step | Result |
| --- | --- |
| `npm run db:audit` | PostgreSQL 17.11; admin role can create roles (not superuser); no `greenlight` objects; schemas present: `auth, extensions, graphql, graphql_public, pgbouncer, public, realtime, storage, vault`; **1 table in `public` (untouched)**; **no triggers on `auth.users`**; Realtime publication present; email sign-up enabled; **email confirmation ON** |
| `npm run db:migrate -- --dry-run` | applied cleanly and rolled back |
| `npm run db:migrate` | applied `0001_core.sql`; re-run is a no-op ("up to date") |
| `npm run db:verify` | **23/23 checks**: every `greenlight_app`-owned object is in `greenlight`; RLS on all 9 tables; no policies/triggers outside the schema; realtime publication gained only `greenlight.events` and `greenlight.launches`; the app logs in as non-admin `greenlight_app` with `search_path=greenlight`; it **cannot** read other `public` tables, `auth.users`, `vault`, `storage`, create objects in `public`, or create roles; the browser `authenticated` role can SELECT three tables only and write nothing; `anon` cannot reach the schema |
| Production → real database | `GET /api/cron/sweep` with the real secret returned `200 {"swept":0,"total":0}`: the deployed app queried the `greenlight` schema as `greenlight_app` through the transaction pooler |
| Real Auth rejects bad credentials through the app | verified from production (generic message, no enumeration, email retained) |

Not changed on the shared project: email confirmation, SMTP, Site URL, redirect allow-list, any other table, policy or
trigger.

**NOT yet verified against real Supabase** (needs confirmed accounts — see below): account creation + confirmation,
successful sign-in, session refresh, workspace creation, invitations between independently authenticated contributors,
cross-workspace isolation with real users, Realtime push (the app falls back to 20 s polling and deadline timers).
`e2e/real.spec.ts` automates all of it once the accounts exist.

## D. Live Base Sepolia

| Check | Result |
| --- | --- |
| `npm run test:live` (verifier vs the real RPC) | **7 passed** — token metadata from the contract (6 decimals), a real transfer verified from chain data alone, wrong recipient / wrong token / fabricated hash / wrong chain id / unreachable confirmation depth all refused |
| Transaction used | [0x1b93805d…df0c4](https://sepolia.basescan.org/tx/0x1b93805d4e4a68d01b7e0f4a67bf50bb6aa8727f8b2c378165defb872d7df0c4) — **a pre-existing transfer found by scanning logs. It was NOT created through Greenlight** and is described only as proof that independent verification works on genuine chain data |
| `npm run verify:funding` negative test | run against the local database that had credited that transfer: 10/11 checks passed and it **correctly FAILED** "mined after the requirement was created", proving the audit rejects pre-existing transfers |
| **Fresh Greenlight-originated transaction** | **NOT DONE** — requires a wallet approval (below) |

Greenlight verifies funding; it does **not** implement settlement, escrow or custody, and does not claim to.

## E. Deployed production browser tests (<https://greenlight-gold-eight.vercel.app>)

| Check | Result |
| --- | --- |
| Public pages (desktop + mobile/Pixel 5) incl. 320–1280 px no horizontal overflow, live sample, theme, reduced motion, keyboard, redirects, callback failure path, cron auth | **28 passed** in one run: desktop 18 (8 axe + 10 public-page tests) and mobile 10 (public-page tests) |
| axe WCAG 2.0/2.1 A+AA, landing/login/signup/invite, light + dark | passed (in the 28) |
| Wrong credentials against **real Supabase Auth** via production | **2 passed** (desktop + mobile) |
| Security headers on production | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS present; no `X-Powered-By` |
| Anonymous `/app` → 307 to `/login?next=%2Fapp`; cron 401 without secret | verified |

**NOT done on production:** the authenticated journey (sign-up/confirmation, workspace, invitations, readiness
transitions, brief) and the funding journey — blocked on confirmed accounts and a wallet (below).

## F. Manual user validation

None performed: no first-time-user usability test, no five-operator customer interviews. The one-pager's
willingness-to-pay question remains unproven.

## Final local browser run

See the section appended below once the final run completes.

## Remaining manual actions

1. **Rotate the admin database password** (it appeared once in this session's output), then update `MIGRATION_DATABASE_URL` in `.env.local`.
2. **Add Greenlight's redirect URL** (additive; leaves the Site URL alone): Supabase → Authentication → URL Configuration → Redirect URLs → add `https://greenlight-gold-eight.vercel.app/auth/callback`. Without it, confirmation emails send people to another app's Site URL.
3. **Create four confirmed accounts** by signing up on <https://greenlight-gold-eight.vercel.app/login?mode=signup> and clicking the confirmation emails (Founder, Ada, Grace, Outsider — plus-addresses of one inbox work). Supabase's built-in mailer is rate-limited, so you may need to space these out or use custom SMTP.
4. Put them in `.env.local` as `E2E_FOUNDER_EMAIL/PASSWORD`, `E2E_ADA_…`, `E2E_GRACE_…`, `E2E_OUTSIDER_…`, then run `E2E_BASE_URL=https://greenlight-gold-eight.vercel.app npm run test:e2e:real`.
5. **Fresh funding transaction**: sign in as the Founder on production in a browser with a wallet on Base Sepolia (test ETH + test USDC), open a launch with a funding requirement, press **Connect wallet → Send USDC**, approve in the wallet, then run `npm run verify:funding -- <launch-id>`.
6. **Demo film** — only after 4 and 5 pass (`docs/demo-script.md`).
