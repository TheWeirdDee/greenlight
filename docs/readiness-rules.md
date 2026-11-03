# Readiness rules

The readiness verdict is produced by one pure function, [`evaluateReadiness`](../lib/readiness/engine.ts):
`(recorded state, now) → verdict`. It performs no I/O, reads no hidden state and uses no AI. Given the
same inputs it always returns the same answer, and it is the **only** thing that can say `READY`.

## Requirement kinds

| Kind | Satisfied when | Evidence tier |
| --- | --- | --- |
| `commitment` | The active contributor has **confirmed** (accepted ≠ confirmed) on or before the deadline. | Submitted (an authenticated attestation) |
| `deliverable` | The active contributor is confirmed **and** has submitted evidence (link or note) on or before the deadline. Only that contributor can submit it. | Submitted claim |
| `url_check` | The most recent availability check — fetched by Greenlight's server — succeeded on or before the deadline. A later failure re-blocks. | Verified |
| `funding` | Verified, sufficiently-confirmed token transfers to the configured recipient on Base Sepolia sum to at least the target; the target was reached on or before the deadline (by **block time**). | Verified |

## Statuses

| Status | Meaning |
| --- | --- |
| `satisfied` | The rule above holds, deadline respected, and every dependency is satisfied. |
| `incomplete` | Progressing normally — waiting on a person's response, a confirmation, evidence, or chain confirmations. |
| `blocked` | Cannot progress without intervention: nobody assigned, contributor declined/withdrew, site check failed, a dependency is blocked, a dependency cycle. |
| `expired` | Not satisfied and the deadline has passed. Counts as blocked for the headline; shown separately because the recovery differs. |

## Dependencies

A requirement is only `satisfied` if **all** its dependencies are. A finished requirement behind an
unsatisfied dependency is shown as waiting (or blocked, if the dependency is blocked/expired) and is
**not** counted as a separate blocker — only root causes are counted, so a chain of three items behind
one declined contributor reports one blocker, not three. Cycles are detected (at write time and by the
engine) and reported as blocked. A dependency on a deleted requirement blocks rather than being ignored.

## Overall verdict

`READY TO LAUNCH` **iff** at least one mandatory requirement exists and every mandatory requirement is
`satisfied`. A launch with no mandatory requirements is `NOT READY — NO REQUIREMENTS DEFINED`: a launch
that requires nothing cannot claim to be ready. Optional requirements never affect the verdict (unless a
mandatory one depends on them).

Otherwise `NOT READY — N BLOCKER(S)`, where N counts unsatisfied mandatory root-cause requirements, each
with its responsible party, evidence tier, deadline and next action.

## Time

Deadlines are compared against `now` on every evaluation, so a requirement expires the instant its
deadline passes — even if nobody is looking. The room evaluates fresh on every read; `sweepLaunch`
persists the change (a `requirement.expired` event, once, plus a `readiness.changed` event) on each read
and from a scheduled job. Confirmations or evidence that arrive **after** the deadline do not satisfy the
requirement; the founder must renegotiate the deadline (an explicit, logged action).

## Recovery

When a requirement is stuck the engine proposes the action; only the founder can take it:

- **Activate backup** — releases the current contributor (their confirmation stops counting immediately),
  invites the pre-authorised backup, and sets a new future deadline.
- **Replace contributor** — the same, inviting someone new.
- **Extend deadline** — for funding and site checks.

None of these marks anything satisfied. The replacement must accept and **confirm** from their own
account; only then does the engine recalculate to a new verdict.

## What the engine will not do

It does not read AI output, accept a self-reported status, or trust a client-supplied transaction hash
or amount. Funding is credited only from what the chain says; URL checks only from what Greenlight's
server fetched; confirmations only from the assignee's own authenticated session.
