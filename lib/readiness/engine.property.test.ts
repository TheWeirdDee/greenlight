import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "./engine";
import type { EngineAssignment, EngineEvidence, EngineFundingTx, EngineInput, EngineRequirement } from "./types";

/**
 * Differential + property testing of the readiness engine.
 *
 * `oracle` below is a second, deliberately plain implementation of the product rules written from the
 * rules document (docs/readiness-rules.md), not from the engine's code. Thousands of randomly generated
 * launches — including dependency cycles, dangling dependencies, late confirmations, declined owners and
 * mixed funding states — are evaluated by both. The headline property: READY iff every mandatory
 * requirement is satisfied by the oracle's reading of the rules.
 */

// Small deterministic PRNG so failures are reproducible from the printed seed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = new Date("2026-11-08T12:00:00Z").getTime();
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H);

function generate(seed: number): EngineInput {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const chance = (p: number) => r() < p;
  const n = 1 + Math.floor(r() * 6);
  const ids = Array.from({ length: n }, (_, i) => `r${i}`);

  const requirements: EngineRequirement[] = ids.map((id) => {
    const kind = pick(["commitment", "deliverable", "url_check", "funding"] as const);
    const deps = ids.filter((d) => d !== id && chance(0.25)); // may form cycles
    if (chance(0.05)) deps.push("ghost"); // dangling dependency
    if (chance(0.03)) deps.push(id); // self-dependency
    return {
      id,
      title: id,
      kind,
      mandatory: chance(0.75),
      deadlineAt: chance(0.4) ? null : at(pick([-30, -5, -1, 1, 5, 30])),
      dependsOn: deps,
      fundingAmount: kind === "funding" ? String(pick([1_000_000, 5_000_000])) : null,
      fundingDecimals: kind === "funding" ? 6 : null,
      fundingSymbol: kind === "funding" ? "USDC" : null,
    };
  });

  const assignments: EngineAssignment[] = [];
  const evidence: EngineEvidence[] = [];
  const fundingTxs: EngineFundingTx[] = [];
  let aid = 0;
  let eid = 0;
  let tid = 0;
  for (const req of requirements) {
    if (req.kind !== "funding") {
      const count = pick([0, 1, 1, 1, 2]);
      for (let i = 0; i < count; i++) {
        const state = pick(["standby", "invited", "accepted", "confirmed", "confirmed", "declined", "released"] as const);
        assignments.push({
          id: `a${aid++}`,
          requirementId: req.id,
          role: i === 0 ? pick(["primary", "primary", "backup"] as const) : pick(["primary", "backup"] as const),
          state,
          label: `P${aid}`,
          confirmedAt: state === "confirmed" ? at(pick([-40, -10, -2, 0, 3, 20])) : null,
          declineReason: null,
        });
      }
    }
    if (req.kind === "deliverable" || req.kind === "url_check") {
      const count = pick([0, 1, 2, 3]);
      for (let i = 0; i < count; i++) {
        const mine = assignments.filter((a) => a.requirementId === req.id);
        const submittedAt = at(pick([-40, -10, -2, 0, 3, 20]));
        const verification = pick(["unverified", "verified", "verified", "failed"] as const);
        evidence.push({
          id: `e${eid++}`,
          requirementId: req.id,
          assignmentId: mine.length && chance(0.8) ? pick(mine).id : null,
          kind: req.kind === "url_check" ? "url" : pick(["url", "note"] as const),
          verification,
          submittedAt,
          verifiedAt: verification === "verified" ? new Date(submittedAt.getTime() + pick([0, 1, 5]) * H) : null,
          detail: null,
        });
      }
    }
    if (req.kind === "funding") {
      const count = pick([0, 1, 2, 3]);
      for (let i = 0; i < count; i++) {
        const status = pick(["pending", "verified", "verified", "rejected"] as const);
        fundingTxs.push({
          id: `t${tid++}`,
          requirementId: req.id,
          status,
          amount: String(pick([500_000, 1_000_000, 2_000_000, 4_000_000])),
          blockTimestamp: chance(0.9) ? at(pick([-40, -10, -2, 0, 3, 20])) : null,
        });
      }
    }
  }
  return { requirements, assignments, evidence, fundingTxs, now: at(0) };
}

/** Independent statement of the rules. */
function oracle(input: EngineInput): Map<string, boolean> {
  const byId = new Map(input.requirements.map((r) => [r.id, r]));
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const within = (t: Date, d: Date | null) => d === null || t.getTime() <= d.getTime();

  const own = (r: EngineRequirement): boolean => {
    const live = input.assignments.filter((a) => a.requirementId === r.id && a.role === "primary" && a.state !== "released");
    if (live.length > 1 && r.kind !== "funding") return false; // conflicting owners: nobody is accountable
    const primary = live[0];
    switch (r.kind) {
      case "commitment":
        return !!primary && primary.state === "confirmed" && !!primary.confirmedAt && within(primary.confirmedAt, r.deadlineAt);
      case "deliverable":
        return (
          !!primary &&
          primary.state === "confirmed" &&
          input.evidence.some((e) => e.requirementId === r.id && e.assignmentId === primary.id && e.verification !== "failed" && within(e.submittedAt, r.deadlineAt))
        );
      case "url_check": {
        if (primary?.state === "declined") return false;
        const urls = input.evidence.filter((e) => e.requirementId === r.id && e.kind === "url");
        if (urls.length === 0) return false;
        const latest = [...urls].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || (a.id < b.id ? 1 : -1))[0];
        return latest.verification === "verified" && within(latest.verifiedAt ?? latest.submittedAt, r.deadlineAt);
      }
      case "funding": {
        const need = BigInt(r.fundingAmount ?? "0");
        const good = input.fundingTxs
          .filter((t) => t.requirementId === r.id && t.status === "verified" && t.amount !== null && t.blockTimestamp !== null)
          .sort((a, b) => a.blockTimestamp!.getTime() - b.blockTimestamp!.getTime());
        let sum = 0n;
        for (const t of good) {
          sum += BigInt(t.amount!);
          if (sum >= need) return within(t.blockTimestamp!, r.deadlineAt);
        }
        return false;
      }
    }
  };

  const sat = (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    const r = byId.get(id);
    if (!r) return false; // dangling dependency
    if (visiting.has(id)) return false; // cycle
    visiting.add(id);
    const ok = own(r) && r.dependsOn.every((d) => sat(d));
    visiting.delete(id);
    memo.set(id, ok);
    return ok;
  };
  // Nodes inside a cycle can never be satisfied, regardless of traversal order.
  const result = new Map<string, boolean>();
  for (const r of input.requirements) {
    const reach = new Set<string>();
    const stack = [...r.dependsOn];
    let cyclic = false;
    while (stack.length) {
      const x = stack.pop()!;
      if (x === r.id) { cyclic = true; break; }
      if (reach.has(x)) continue;
      reach.add(x);
      stack.push(...(byId.get(x)?.dependsOn ?? []));
    }
    memo.clear();
    result.set(r.id, !cyclic && sat(r.id));
  }
  return result;
}

const SEEDS = Array.from({ length: 4000 }, (_, i) => i + 1);

describe("readiness engine vs an independent oracle (4000 random launches)", () => {
  it("READY if and only if every mandatory requirement is satisfied — never otherwise", () => {
    let ready = 0;
    let notReady = 0;
    for (const seed of SEEDS) {
      const input = generate(seed);
      const verdict = evaluateReadiness(input);
      const sat = oracle(input);
      const mandatory = input.requirements.filter((r) => r.mandatory);
      const expectReady = mandatory.length > 0 && mandatory.every((r) => sat.get(r.id));
      expect(verdict.state, `seed ${seed}`).toBe(expectReady ? "ready" : "not_ready");
      if (expectReady) ready++;
      else notReady++;
    }
    // The generator must actually exercise both outcomes, or the property would be vacuous.
    expect(ready).toBeGreaterThan(100);
    expect(notReady).toBeGreaterThan(1000);
  });

  it("each requirement's satisfied/unsatisfied status matches the oracle", () => {
    for (const seed of SEEDS) {
      const input = generate(seed);
      const verdict = evaluateReadiness(input);
      const sat = oracle(input);
      for (const e of verdict.requirements) {
        expect(e.status === "satisfied", `seed ${seed} requirement ${e.requirementId} (${e.kind}) engine=${e.status}`).toBe(sat.get(e.requirementId));
      }
    }
  });

  it("is consistent with itself: ready ⇒ no blockers; counts add up; every blocker is a mandatory unsatisfied requirement", () => {
    for (const seed of SEEDS) {
      const input = generate(seed);
      const v = evaluateReadiness(input);
      const mandatory = v.requirements.filter((e) => e.mandatory);
      if (v.state === "ready") {
        expect(v.blockers, `seed ${seed}`).toEqual([]);
        expect(v.headline).toBe("READY TO LAUNCH");
      } else {
        expect(v.headline, `seed ${seed}`).not.toMatch(/READY TO LAUNCH/);
      }
      expect(v.counts.mandatory).toBe(mandatory.length);
      expect(v.counts.mandatorySatisfied).toBe(mandatory.filter((e) => e.status === "satisfied").length);
      for (const b of v.blockers) {
        const e = v.requirements.find((x) => x.requirementId === b.requirementId)!;
        expect(e.mandatory && e.status !== "satisfied", `seed ${seed} blocker ${b.requirementId}`).toBe(true);
      }
      // Expired requirements always name a deadline in the past.
      for (const e of v.requirements.filter((x) => x.status === "expired")) {
        expect(new Date(e.deadlineAt!).getTime(), `seed ${seed}`).toBeLessThan(input.now.getTime());
      }
    }
  });

  it("is order-independent: shuffling requirements, assignments, evidence and transactions changes nothing", () => {
    for (const seed of SEEDS.slice(0, 1500)) {
      const input = generate(seed);
      const r = rng(seed * 7919);
      const shuffle = <T,>(xs: T[]) => xs.map((x) => [r(), x] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const a = evaluateReadiness(input);
      const b = evaluateReadiness({
        ...input,
        requirements: shuffle(input.requirements),
        assignments: shuffle(input.assignments),
        evidence: shuffle(input.evidence),
        fundingTxs: shuffle(input.fundingTxs),
      });
      expect(b.state, `seed ${seed}`).toBe(a.state);
      const byId = (v: typeof a) => Object.fromEntries(v.requirements.map((e) => [e.requirementId, e.status]));
      expect(byId(b), `seed ${seed}`).toEqual(byId(a));
    }
  });

  it("adding one unsatisfied mandatory requirement to ANY launch makes it NOT READY", () => {
    for (const seed of SEEDS.slice(0, 1500)) {
      const input = generate(seed);
      const extra: EngineRequirement = {
        id: "extra", title: "extra", kind: "commitment", mandatory: true, deadlineAt: null, dependsOn: [],
        fundingAmount: null, fundingDecimals: null, fundingSymbol: null,
      };
      const v = evaluateReadiness({ ...input, requirements: [...input.requirements, extra] });
      expect(v.state, `seed ${seed}`).toBe("not_ready");
      expect(v.blockers.some((b) => b.requirementId === "extra")).toBe(true);
    }
  });

  it("making a mandatory requirement depend on an unsatisfied one makes it NOT READY", () => {
    for (const seed of SEEDS.slice(0, 1500)) {
      const input = generate(seed);
      const unsat = new Map([...oracle(input)].filter(([, ok]) => !ok));
      const target = input.requirements.find((r) => r.mandatory);
      const blocker = [...unsat.keys()][0];
      if (!target || !blocker || blocker === target.id) continue;
      const v = evaluateReadiness({
        ...input,
        requirements: input.requirements.map((r) => (r.id === target.id ? { ...r, dependsOn: [...r.dependsOn, blocker] } : r)),
      });
      expect(v.requirements.find((e) => e.requirementId === target.id)!.status, `seed ${seed}`).not.toBe("satisfied");
      expect(v.state, `seed ${seed}`).toBe("not_ready");
    }
  });

  it("passage of time can only expire, never retroactively satisfy: pushing `now` later never turns an unsatisfied requirement satisfied", () => {
    for (const seed of SEEDS.slice(0, 1500)) {
      const input = generate(seed);
      const before = evaluateReadiness(input);
      const after = evaluateReadiness({ ...input, now: new Date(input.now.getTime() + 24 * H) });
      for (const e of before.requirements) {
        if (e.status !== "satisfied") {
          expect(after.requirements.find((x) => x.requirementId === e.requirementId)!.status, `seed ${seed}`).not.toBe("satisfied");
        }
      }
    }
  });

  it("is a pure function: identical input yields identical output (deep equality), and never mutates its input", () => {
    for (const seed of SEEDS.slice(0, 500)) {
      const input = generate(seed);
      const snapshot = JSON.stringify(input);
      const a = evaluateReadiness(input);
      const b = evaluateReadiness(input);
      expect(a).toEqual(b);
      expect(JSON.stringify(input)).toBe(snapshot);
    }
  });
});
