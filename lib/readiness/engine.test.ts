import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "./engine";
import type {
  EngineAssignment,
  EngineEvidence,
  EngineFundingTx,
  EngineInput,
  EngineRequirement,
} from "./types";

const T0 = new Date("2026-11-05T12:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);

const req = (over: Partial<EngineRequirement> & Pick<EngineRequirement, "id">): EngineRequirement => ({
  title: over.id,
  kind: "commitment",
  mandatory: true,
  deadlineAt: null,
  dependsOn: [],
  fundingAmount: null,
  fundingDecimals: null,
  fundingSymbol: null,
  ...over,
});

const asg = (over: Partial<EngineAssignment> & Pick<EngineAssignment, "id" | "requirementId">): EngineAssignment => ({
  role: "primary",
  state: "invited",
  label: "Ada",
  confirmedAt: null,
  declineReason: null,
  ...over,
});

const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  requirements: [],
  assignments: [],
  evidence: [],
  fundingTxs: [],
  now: T0,
  ...over,
});

const ev = (over: Partial<EngineEvidence> & Pick<EngineEvidence, "id" | "requirementId">): EngineEvidence => ({
  assignmentId: null,
  kind: "url",
  verification: "unverified",
  submittedAt: hours(-1),
  verifiedAt: null,
  detail: null,
  ...over,
});

const fund = (over: Partial<EngineFundingTx> & Pick<EngineFundingTx, "id" | "requirementId">): EngineFundingTx => ({
  status: "verified",
  amount: "1000000",
  blockTimestamp: hours(-2),
  ...over,
});

const statusOf = (r: ReturnType<typeof evaluateReadiness>, id: string) =>
  r.requirements.find((e) => e.requirementId === id)!;

describe("readiness verdict", () => {
  it("is never READY with zero mandatory requirements", () => {
    const r = evaluateReadiness(base());
    expect(r.state).toBe("not_ready");
    expect(r.headline).toMatch(/NO REQUIREMENTS/);

    const optionalOnly = evaluateReadiness(base({ requirements: [req({ id: "a", mandatory: false })] }));
    expect(optionalOnly.state).toBe("not_ready");
  });

  it("is READY only when every mandatory requirement is satisfied", () => {
    const input = base({
      requirements: [req({ id: "a" }), req({ id: "b" })],
      assignments: [
        asg({ id: "1", requirementId: "a", state: "confirmed", confirmedAt: hours(-3) }),
        asg({ id: "2", requirementId: "b", state: "accepted" }),
      ],
    });
    const partial = evaluateReadiness(input);
    expect(partial.state).toBe("not_ready");
    expect(partial.blockers.map((b) => b.requirementId)).toEqual(["b"]);

    const done = evaluateReadiness({
      ...input,
      assignments: [
        asg({ id: "1", requirementId: "a", state: "confirmed", confirmedAt: hours(-3) }),
        asg({ id: "2", requirementId: "b", state: "confirmed", confirmedAt: hours(-1) }),
      ],
    });
    expect(done.state).toBe("ready");
    expect(done.headline).toBe("READY TO LAUNCH");
    expect(done.blockers).toEqual([]);
  });

  it("ignores optional requirements when judging readiness", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a" }), req({ id: "opt", mandatory: false })],
        assignments: [asg({ id: "1", requirementId: "a", state: "confirmed", confirmedAt: hours(-1) })],
      }),
    );
    expect(r.state).toBe("ready");
  });

  it("is deterministic for identical inputs", () => {
    const input = base({
      requirements: [req({ id: "a", deadlineAt: hours(5) })],
      assignments: [asg({ id: "1", requirementId: "a", state: "accepted" })],
    });
    expect(evaluateReadiness(input)).toEqual(evaluateReadiness(input));
  });
});

describe("commitments: missing and expired confirmations", () => {
  it("unassigned mandatory requirement is blocked", () => {
    const r = evaluateReadiness(base({ requirements: [req({ id: "a" })] }));
    expect(statusOf(r, "a").status).toBe("blocked");
    expect(statusOf(r, "a").reasons[0].code).toBe("unassigned");
  });

  it("invited and accepted contributors are incomplete, not satisfied", () => {
    for (const state of ["invited", "accepted"] as const) {
      const r = evaluateReadiness(
        base({ requirements: [req({ id: "a" })], assignments: [asg({ id: "1", requirementId: "a", state })] }),
      );
      expect(statusOf(r, "a").status).toBe("incomplete");
      expect(r.state).toBe("not_ready");
    }
  });

  it("a declined contributor blocks the requirement and names the reason", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a" })],
        assignments: [asg({ id: "1", requirementId: "a", state: "declined", declineReason: "travelling" })],
      }),
    );
    const e = statusOf(r, "a");
    expect(e.status).toBe("blocked");
    expect(e.reasons[0].message).toContain("travelling");
    expect(r.blockers[0].severity).toBe("blocked");
  });

  it("missing the deadline without confirming makes the requirement expired", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a", deadlineAt: hours(-1) })],
        assignments: [asg({ id: "1", requirementId: "a", state: "accepted" })],
      }),
    );
    expect(statusOf(r, "a").status).toBe("expired");
    expect(r.blockers[0].severity).toBe("expired");
    expect(r.headline).toBe("NOT READY — 1 BLOCKER");
  });

  it("expiry is exact: a confirmation at the deadline counts, one a moment later does not", () => {
    const deadline = hours(-1);
    const mk = (confirmedAt: Date) =>
      evaluateReadiness(
        base({
          requirements: [req({ id: "a", deadlineAt: deadline })],
          assignments: [asg({ id: "1", requirementId: "a", state: "confirmed", confirmedAt })],
        }),
      );
    expect(statusOf(mk(deadline), "a").status).toBe("satisfied");
    expect(statusOf(mk(new Date(deadline.getTime() + 1)), "a").status).not.toBe("satisfied");
  });

  it("a deadline that has not passed does not expire the requirement", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a", deadlineAt: hours(1) })],
        assignments: [asg({ id: "1", requirementId: "a", state: "accepted" })],
      }),
    );
    expect(statusOf(r, "a").status).toBe("incomplete");
  });

  it("an on-time confirmation stays satisfied after the deadline passes", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a", deadlineAt: hours(-1) })],
        assignments: [asg({ id: "1", requirementId: "a", state: "confirmed", confirmedAt: hours(-5) })],
      }),
    );
    expect(statusOf(r, "a").status).toBe("satisfied");
  });
});

describe("contributor replacement", () => {
  const requirements = [req({ id: "a", deadlineAt: hours(-1) })];

  it("recovery suggests the authorised backup when one is on standby", () => {
    const r = evaluateReadiness(
      base({
        requirements,
        assignments: [
          asg({ id: "1", requirementId: "a", state: "accepted" }),
          asg({ id: "2", requirementId: "a", role: "backup", state: "standby", label: "Grace" }),
        ],
      }),
    );
    expect(statusOf(r, "a").next.code).toBe("activate_backup");
    expect(statusOf(r, "a").next.label).toContain("Grace");
  });

  it("without a backup, recovery is replace-or-extend", () => {
    const r = evaluateReadiness(
      base({ requirements, assignments: [asg({ id: "1", requirementId: "a", state: "accepted" })] }),
    );
    expect(statusOf(r, "a").next.code).toBe("replace_or_extend");
  });

  it("released assignments never count; the replacement's confirmation re-satisfies the requirement", () => {
    const original = asg({ id: "1", requirementId: "a", state: "released", confirmedAt: hours(-30) });
    const extended = [req({ id: "a", deadlineAt: hours(24) })];

    const waiting = evaluateReadiness(
      base({
        requirements: extended,
        assignments: [original, asg({ id: "2", requirementId: "a", state: "invited", label: "Grace" })],
      }),
    );
    expect(statusOf(waiting, "a").status).toBe("incomplete");
    expect(waiting.state).toBe("not_ready");

    const confirmed = evaluateReadiness(
      base({
        requirements: extended,
        assignments: [
          original,
          asg({ id: "2", requirementId: "a", state: "confirmed", label: "Grace", confirmedAt: hours(-0.5) }),
        ],
      }),
    );
    expect(statusOf(confirmed, "a").status).toBe("satisfied");
    expect(confirmed.state).toBe("ready");
  });

  it("a released contributor's old confirmation cannot satisfy the requirement", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a" })],
        assignments: [asg({ id: "1", requirementId: "a", state: "released", confirmedAt: hours(-3) })],
      }),
    );
    expect(statusOf(r, "a").status).toBe("blocked");
    expect(r.state).toBe("not_ready");
  });
});

describe("dependencies", () => {
  const confirmed = (id: string, requirementId: string) =>
    asg({ id, requirementId, state: "confirmed", confirmedAt: hours(-2) });

  it("a requirement is not satisfied while its dependency is unsatisfied, even if its own work is done", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a" }), req({ id: "b", dependsOn: ["a"] })],
        assignments: [asg({ id: "1", requirementId: "a", state: "accepted" }), confirmed("2", "b")],
      }),
    );
    const b = statusOf(r, "b");
    expect(b.status).toBe("incomplete");
    expect(b.rootCause).toBe(false);
    expect(b.reasons.map((x) => x.code)).toContain("waiting_on_dependency");
    // Only the root cause is reported as a blocker; the gated item is not double-counted.
    expect(r.blockers.map((x) => x.requirementId)).toEqual(["a"]);
    expect(r.state).toBe("not_ready");
  });

  it("a blocked dependency blocks dependents, transitively", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a" }), req({ id: "b", dependsOn: ["a"] }), req({ id: "c", dependsOn: ["b"] })],
        assignments: [
          asg({ id: "1", requirementId: "a", state: "declined" }),
          confirmed("2", "b"),
          confirmed("3", "c"),
        ],
      }),
    );
    expect(statusOf(r, "b").status).toBe("blocked");
    expect(statusOf(r, "c").status).toBe("blocked");
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0].requirementId).toBe("a");
  });

  it("becomes satisfied once the dependency is satisfied", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a" }), req({ id: "b", dependsOn: ["a"] })],
        assignments: [confirmed("1", "a"), confirmed("2", "b")],
      }),
    );
    expect(r.state).toBe("ready");
  });

  it("an expired dependency propagates as a block", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a", deadlineAt: hours(-1) }), req({ id: "b", dependsOn: ["a"] })],
        assignments: [asg({ id: "1", requirementId: "a", state: "accepted" }), confirmed("2", "b")],
      }),
    );
    expect(statusOf(r, "a").status).toBe("expired");
    expect(statusOf(r, "b").status).toBe("blocked");
  });

  it("dependency cycles are blocked, not looped on", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "a", dependsOn: ["b"] }), req({ id: "b", dependsOn: ["a"] }), req({ id: "c", dependsOn: ["a"] })],
        assignments: [confirmed("1", "a"), confirmed("2", "b"), confirmed("3", "c")],
      }),
    );
    expect(statusOf(r, "a").reasons[0].code).toBe("dependency_cycle");
    expect(statusOf(r, "b").status).toBe("blocked");
    expect(statusOf(r, "c").status).toBe("blocked");
    expect(r.state).toBe("not_ready");
  });

  it("a dependency on a deleted requirement blocks rather than being ignored", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "b", dependsOn: ["ghost"] })],
        assignments: [confirmed("2", "b")],
      }),
    );
    expect(statusOf(r, "b").status).toBe("blocked");
    expect(r.state).toBe("not_ready");
  });
});

describe("deliverables and evidence tiers", () => {
  const deliverable = req({ id: "d", kind: "deliverable", deadlineAt: hours(10) });
  const confirmedOwner = asg({ id: "1", requirementId: "d", state: "confirmed", confirmedAt: hours(-4) });

  it("needs evidence even after the contributor confirms", () => {
    const r = evaluateReadiness(base({ requirements: [deliverable], assignments: [confirmedOwner] }));
    expect(statusOf(r, "d").status).toBe("incomplete");
    expect(statusOf(r, "d").reasons[0].code).toBe("awaiting_evidence");
  });

  it("user-submitted evidence satisfies but is labelled 'submitted', not 'verified'", () => {
    const r = evaluateReadiness(
      base({
        requirements: [deliverable],
        assignments: [confirmedOwner],
        evidence: [ev({ id: "e1", requirementId: "d", assignmentId: "1", kind: "note" })],
      }),
    );
    expect(statusOf(r, "d").status).toBe("satisfied");
    expect(statusOf(r, "d").evidenceTier).toBe("submitted");
  });

  it("evidence from someone other than the active owner does not count", () => {
    const r = evaluateReadiness(
      base({
        requirements: [deliverable],
        assignments: [confirmedOwner],
        evidence: [ev({ id: "e1", requirementId: "d", assignmentId: "old-owner", kind: "note" })],
      }),
    );
    expect(statusOf(r, "d").status).toBe("incomplete");
  });

  it("evidence submitted after the deadline does not satisfy the requirement", () => {
    const r = evaluateReadiness(
      base({
        requirements: [req({ id: "d", kind: "deliverable", deadlineAt: hours(-1) })],
        assignments: [confirmedOwner],
        evidence: [ev({ id: "e1", requirementId: "d", assignmentId: "1", kind: "note", submittedAt: hours(-0.5) })],
      }),
    );
    expect(statusOf(r, "d").status).toBe("expired");
  });

  it("evidence that failed verification does not count", () => {
    const r = evaluateReadiness(
      base({
        requirements: [deliverable],
        assignments: [confirmedOwner],
        evidence: [ev({ id: "e1", requirementId: "d", assignmentId: "1", verification: "failed" })],
      }),
    );
    expect(statusOf(r, "d").status).toBe("incomplete");
  });
});

describe("url availability checks", () => {
  const check = req({ id: "u", kind: "url_check" });

  it("is incomplete until a URL is submitted", () => {
    expect(statusOf(evaluateReadiness(base({ requirements: [check] })), "u").status).toBe("incomplete");
  });

  it("an unverified claim never satisfies the check", () => {
    const r = evaluateReadiness(
      base({ requirements: [check], evidence: [ev({ id: "e", requirementId: "u", verification: "unverified" })] }),
    );
    expect(statusOf(r, "u").status).toBe("incomplete");
    expect(r.state).toBe("not_ready");
  });

  it("a verified check satisfies with tier 'verified'", () => {
    const r = evaluateReadiness(
      base({
        requirements: [check],
        evidence: [ev({ id: "e", requirementId: "u", verification: "verified", verifiedAt: hours(-1) })],
      }),
    );
    expect(statusOf(r, "u").status).toBe("satisfied");
    expect(statusOf(r, "u").evidenceTier).toBe("verified");
    expect(r.state).toBe("ready");
  });

  it("the most recent check governs: a later failure re-blocks the launch", () => {
    const r = evaluateReadiness(
      base({
        requirements: [check],
        evidence: [
          ev({ id: "e1", requirementId: "u", verification: "verified", verifiedAt: hours(-5), submittedAt: hours(-5) }),
          ev({ id: "e2", requirementId: "u", verification: "failed", submittedAt: hours(-1), detail: "HTTP 503" }),
        ],
      }),
    );
    expect(statusOf(r, "u").status).toBe("blocked");
    expect(statusOf(r, "u").reasons[0].message).toContain("503");
  });
});

describe("funding verification", () => {
  const funding = req({
    id: "f",
    kind: "funding",
    fundingAmount: "5000000",
    fundingDecimals: 6,
    fundingSymbol: "USDC",
    deadlineAt: hours(24),
  });

  it("no verified transaction: incomplete with zero progress", () => {
    const r = evaluateReadiness(base({ requirements: [funding] }));
    expect(statusOf(r, "f").status).toBe("incomplete");
    expect(statusOf(r, "f").progress?.current).toBe("0");
  });

  it("partial funding is underfunded and reports progress", () => {
    const r = evaluateReadiness(
      base({ requirements: [funding], fundingTxs: [fund({ id: "t1", requirementId: "f", amount: "2000000" })] }),
    );
    expect(statusOf(r, "f").status).toBe("incomplete");
    expect(statusOf(r, "f").reasons[0].code).toBe("underfunded");
    expect(statusOf(r, "f").progress).toMatchObject({ current: "2000000", required: "5000000" });
  });

  it("multiple verified transactions accumulate to meet the target", () => {
    const r = evaluateReadiness(
      base({
        requirements: [funding],
        fundingTxs: [
          fund({ id: "t1", requirementId: "f", amount: "2000000", blockTimestamp: hours(-3) }),
          fund({ id: "t2", requirementId: "f", amount: "3000000", blockTimestamp: hours(-1) }),
        ],
      }),
    );
    expect(statusOf(r, "f").status).toBe("satisfied");
    expect(statusOf(r, "f").evidenceTier).toBe("verified");
    expect(r.state).toBe("ready");
  });

  it("pending and rejected transactions never count toward the total", () => {
    const r = evaluateReadiness(
      base({
        requirements: [funding],
        fundingTxs: [
          fund({ id: "t1", requirementId: "f", amount: "5000000", status: "pending" }),
          fund({ id: "t2", requirementId: "f", amount: "5000000", status: "rejected" }),
        ],
      }),
    );
    expect(statusOf(r, "f").status).toBe("incomplete");
    expect(statusOf(r, "f").progress?.current).toBe("0");
    expect(r.state).toBe("not_ready");
  });

  it("funding reached after the deadline does not satisfy it", () => {
    const r = evaluateReadiness(
      base({
        requirements: [{ ...funding, deadlineAt: hours(-5) }],
        fundingTxs: [fund({ id: "t1", requirementId: "f", amount: "5000000", blockTimestamp: hours(-1) })],
      }),
    );
    expect(statusOf(r, "f").status).toBe("expired");
  });

  it("handles amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const big = req({ id: "f", kind: "funding", fundingAmount: "9007199254740993", fundingDecimals: 18, fundingSymbol: "X" });
    const r = evaluateReadiness(
      base({
        requirements: [big],
        fundingTxs: [fund({ id: "t", requirementId: "f", amount: "9007199254740992" })],
      }),
    );
    expect(statusOf(r, "f").status).toBe("incomplete");
  });
});

describe("readiness transitions", () => {
  it("walks NOT READY -> READY -> NOT READY as independent events arrive", () => {
    const requirements = [
      req({ id: "promo", deadlineAt: hours(48) }),
      req({ id: "budget", kind: "funding", fundingAmount: "5000000", fundingDecimals: 6, fundingSymbol: "USDC" }),
    ];
    const step = (over: Partial<EngineInput>, now = T0) => evaluateReadiness(base({ requirements, now, ...over }));

    const s0 = step({});
    expect(s0.state).toBe("not_ready");
    expect(s0.blockers).toHaveLength(2);

    const s1 = step({
      assignments: [asg({ id: "1", requirementId: "promo", state: "confirmed", confirmedAt: hours(1) })],
    }, hours(1));
    expect(s1.state).toBe("not_ready");
    expect(s1.blockers.map((b) => b.requirementId)).toEqual(["budget"]);
    expect(s1.fingerprint).not.toBe(s0.fingerprint);

    const s2 = step({
      assignments: [asg({ id: "1", requirementId: "promo", state: "confirmed", confirmedAt: hours(1) })],
      fundingTxs: [fund({ id: "t", requirementId: "budget", amount: "5000000", blockTimestamp: hours(2) })],
    }, hours(3));
    expect(s2.state).toBe("ready");

    // The funding transaction is later rejected (e.g. re-org): readiness reverts without any manual edit.
    const s3 = step({
      assignments: [asg({ id: "1", requirementId: "promo", state: "confirmed", confirmedAt: hours(1) })],
      fundingTxs: [fund({ id: "t", requirementId: "budget", status: "rejected" })],
    }, hours(4));
    expect(s3.state).toBe("not_ready");
  });

  it("time alone can flip a launch: a deadline passing turns a waiting item into an expired blocker", () => {
    const input = (now: Date) =>
      base({
        now,
        requirements: [req({ id: "a", deadlineAt: hours(2) })],
        assignments: [asg({ id: "1", requirementId: "a", state: "accepted" })],
      });
    expect(statusOf(evaluateReadiness(input(hours(1))), "a").status).toBe("incomplete");
    expect(statusOf(evaluateReadiness(input(hours(3))), "a").status).toBe("expired");
  });

  it("the fingerprint is stable when nothing meaningful changes", () => {
    const input = base({ requirements: [req({ id: "a" })] });
    const later = { ...input, now: hours(1) };
    expect(evaluateReadiness(input).fingerprint).toBe(evaluateReadiness(later).fingerprint);
  });
});
