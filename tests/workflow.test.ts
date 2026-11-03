import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  acceptInvitation,
  activateBackup,
  authoriseBackup,
  confirmCommitment,
  declineInvitation,
  inviteContributor,
  reissueInvitation,
  replaceContributor,
  withdrawCommitment,
} from "@/lib/services/assignments";
import {
  buildBrief,
  createShareLink,
  getOwnerBrief,
  getSharedBrief,
  recordDecision,
  revokeShareLink,
} from "@/lib/services/brief";
import { submitEvidence, recheckUrl } from "@/lib/services/evidence";
import { reverifyFunding, submitFundingTx } from "@/lib/services/funding";
import {
  addRequirement,
  createLaunch,
  createWorkspace,
  removeRequirement,
  updateLaunch,
  updateRequirement,
} from "@/lib/services/launches";
import { getRoom, sweepLaunch } from "@/lib/services/room";
import { RECIPIENT, USDC, goodTransfer, hash, setup } from "./helpers/harness";

const FUNDING = { chainId: 84532 as const, token: USDC, recipient: RECIPIENT, amount: "5", minConfirmations: 2 };

async function scenario() {
  const s = await setup();
  const founder = await s.user("Founder");
  const ada = await s.user("Ada");
  const grace = await s.user("Grace");
  const mallory = await s.user("Mallory");
  const ws = await createWorkspace(s.ctx, founder, { name: "Acme Labs" });
  const launch = await createLaunch(s.ctx, founder, ws.id, {
    name: "Acme Token Launch",
    tagline: "",
    targetAt: "2026-11-09T22:00:00Z",
  });
  return { ...s, founder, ada, grace, mallory, ws, launchId: launch.id };
}
type Sc = Awaited<ReturnType<typeof scenario>>;

const room = (sc: Sc, who = sc.founder) => getRoom(sc.ctx, who.id, sc.launchId);
const eventTypes = async (sc: Sc) =>
  (await sc.pg.query<{ type: string }>(`select type from events where launch_id = $1 order by seq`, [sc.launchId])).rows.map(
    (r) => r.type,
  );
const count = async (sc: Sc, type: string) => (await eventTypes(sc)).filter((t) => t === type).length;
const reject = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected the call to be rejected");
};

async function addReq(sc: Sc, input: Parameters<typeof addRequirement>[3]) {
  const r = await addRequirement(sc.ctx, sc.founder, sc.launchId, input);
  if (r.duplicate) throw new Error("unexpected duplicate");
  return r.value.id;
}
async function invite(sc: Sc, reqId: string, label: string) {
  const r = await inviteContributor(sc.ctx, sc.founder, reqId, { label });
  if (r.duplicate) throw new Error("unexpected duplicate");
  return r.value;
}
async function accept(sc: Sc, who: Sc["ada"], token: string) {
  const r = await acceptInvitation(sc.ctx, who, token);
  if (r.duplicate) throw new Error("unexpected duplicate");
  return r.value;
}
const statusOf = async (sc: Sc, reqId: string, who = sc.founder) =>
  (await room(sc, who)).readiness.requirements.find((r) => r.requirementId === reqId)!;

describe("launch room: the happy path", () => {
  it("recalculates readiness automatically at each real event, with timestamps and actors", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce on X", kind: "commitment", deadlineAt: "2026-11-08T12:00:00Z" });
    const budget = await addReq(sc, { title: "Campaign budget", kind: "funding", funding: FUNDING, deadlineAt: "2026-11-08T12:00:00Z" });

    let r = await room(sc);
    expect(r.readiness.state).toBe("not_ready");
    expect(r.readiness.headline).toBe("NOT READY — 2 BLOCKERS");

    const inv = await invite(sc, promo, "Ada (promo lead)");
    expect((await statusOf(sc, promo)).status).toBe("incomplete");

    sc.clock.advanceHours(1);
    await accept(sc, sc.ada, inv.token);
    sc.clock.advanceHours(1);
    expect((await statusOf(sc, promo)).status).toBe("incomplete"); // accepted ≠ confirmed

    await confirmCommitment(sc.ctx, sc.ada, inv.assignmentId);
    expect((await statusOf(sc, promo)).status).toBe("satisfied");
    r = await room(sc);
    expect(r.readiness.state).toBe("not_ready");
    expect(r.readiness.headline).toBe("NOT READY — 1 BLOCKER");
    expect(r.readiness.blockers[0].title).toBe("Campaign budget");

    sc.chain.set(hash(1), () => goodTransfer("5000000", { blockTimestamp: new Date("2026-11-05T11:30:00Z") }));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    r = await room(sc);
    expect(r.readiness.state).toBe("ready");
    expect(r.readiness.headline).toBe("READY TO LAUNCH");

    // Every event carries a real timestamp and an authenticated actor.
    const ev = (await sc.pg.query<{ type: string; actor_id: string | null; actor_label: string; created_at: Date }>(
      `select type, actor_id, actor_label, created_at from events where launch_id = $1 order by seq`, [sc.launchId])).rows;
    expect(ev.find((e) => e.type === "assignment.confirmed")).toMatchObject({ actor_id: sc.ada.id, actor_label: "Ada" });
    expect(ev.find((e) => e.type === "assignment.accepted")!.created_at.toISOString()).toBe("2026-11-05T11:00:00.000Z");
    expect(ev.find((e) => e.type === "assignment.confirmed")!.created_at.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    expect(ev.filter((e) => e.type === "readiness.changed").length).toBeGreaterThanOrEqual(3);
    expect(ev.every((e) => e.created_at instanceof Date)).toBe(true);
  });

  it("persists a stored verdict that matches the freshly derived one, and bumps rev on each mutation", async () => {
    const sc = await scenario();
    const before = (await sc.pg.query<{ rev: number }>(`select rev::int as rev from launches where id = $1`, [sc.launchId])).rows[0].rev;
    const promo = await addReq(sc, { title: "Announce", kind: "commitment" });
    const inv = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, inv.token);
    await confirmCommitment(sc.ctx, sc.ada, inv.assignmentId);
    const row = (await sc.pg.query<{ rev: number; readiness_state: string; readiness_result: { fingerprint: string } }>(
      `select rev::int as rev, readiness_state, readiness_result from launches where id = $1`, [sc.launchId])).rows[0];
    expect(row.rev).toBeGreaterThan(before + 3);
    expect(row.readiness_state).toBe("ready");
    expect((await room(sc)).readiness.fingerprint).toBe(row.readiness_result.fingerprint);
  });

  it("the launch can never display READY while a mandatory requirement is unsatisfied", async () => {
    const sc = await scenario();
    const a = await addReq(sc, { title: "A", kind: "commitment" });
    await addReq(sc, { title: "B", kind: "commitment" });
    const inv = await invite(sc, a, "Ada");
    await accept(sc, sc.ada, inv.token);
    await confirmCommitment(sc.ctx, sc.ada, inv.assignmentId);
    const r = await room(sc);
    expect(r.readiness.state).toBe("not_ready");
    const stored = (await sc.pg.query<{ readiness_state: string }>(`select readiness_state from launches where id = $1`, [sc.launchId])).rows[0];
    expect(stored.readiness_state).toBe("not_ready");
  });
});

describe("dependencies at the service layer", () => {
  it("rejects unknown dependencies and cycles", async () => {
    const sc = await scenario();
    const a = await addReq(sc, { title: "A", kind: "commitment" });
    const b = await addReq(sc, { title: "B", kind: "commitment", dependsOn: [a] });
    expect((await reject(addRequirement(sc.ctx, sc.founder, sc.launchId, { title: "C", kind: "commitment", dependsOn: ["00000000-0000-4000-8000-0000000000ff"] }))).code).toBe("invalid");
    expect((await reject(updateRequirement(sc.ctx, sc.founder, a, { dependsOn: [b] }))).code).toBe("invalid");
    expect((await reject(updateRequirement(sc.ctx, sc.founder, a, { dependsOn: [a] }))).code).toBe("invalid");
  });

  it("gates a finished requirement behind its dependency until that dependency is satisfied", async () => {
    const sc = await scenario();
    const a = await addReq(sc, { title: "Funding approved", kind: "commitment" });
    const b = await addReq(sc, { title: "Announcement", kind: "commitment", dependsOn: [a] });
    const ib = await invite(sc, b, "Grace");
    await accept(sc, sc.grace, ib.token);
    await confirmCommitment(sc.ctx, sc.grace, ib.assignmentId);
    const gated = await statusOf(sc, b);
    expect(gated.status).not.toBe("satisfied");
    expect((await room(sc)).readiness.state).toBe("not_ready");

    const ia = await invite(sc, a, "Ada");
    await accept(sc, sc.ada, ia.token);
    await confirmCommitment(sc.ctx, sc.ada, ia.assignmentId);
    expect((await room(sc)).readiness.state).toBe("ready");
  });

  it("removing a requirement removes it from dependants instead of leaving a dangling dependency", async () => {
    const sc = await scenario();
    const a = await addReq(sc, { title: "A", kind: "commitment" });
    const b = await addReq(sc, { title: "B", kind: "commitment", dependsOn: [a] });
    await removeRequirement(sc.ctx, sc.founder, a);
    const r = await room(sc);
    expect(r.requirements.find((x) => x.id === b)!.dependsOn).toEqual([]);
  });
});

describe("authorization (server-side)", () => {
  let sc: Sc;
  let promo: string;
  let inv: { assignmentId: string; token: string };
  beforeEach(async () => {
    sc = await scenario();
    promo = await addReq(sc, { title: "Announce", kind: "commitment" });
    inv = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, inv.token);
  });

  it("outsiders cannot read a launch room, and learn nothing about whether it exists", async () => {
    const e = await reject(getRoom(sc.ctx, sc.mallory.id, sc.launchId));
    expect(e.code).toBe("not_found");
  });

  it("a contributor cannot confirm someone else's commitment", async () => {
    expect((await reject(confirmCommitment(sc.ctx, sc.mallory, inv.assignmentId))).code).toBe("not_found");
    expect((await reject(confirmCommitment(sc.ctx, sc.grace, inv.assignmentId))).code).toBe("not_found");
    expect((await reject(confirmCommitment(sc.ctx, sc.founder, inv.assignmentId))).code).toBe("not_found");
    expect((await statusOf(sc, promo)).status).toBe("incomplete");
  });

  it("a contributor cannot withdraw or decline another contributor's assignment", async () => {
    expect((await reject(withdrawCommitment(sc.ctx, sc.mallory, inv.assignmentId, {}))).code).toBe("not_found");
  });

  it("contributors have no founder powers", async () => {
    const date = "2026-11-09T22:00:00Z";
    expect((await reject(updateLaunch(sc.ctx, sc.ada, sc.launchId, { name: "Hijacked", targetAt: date }))).code).toBe("forbidden");
    expect((await reject(addRequirement(sc.ctx, sc.ada, sc.launchId, { title: "x", kind: "commitment" }))).code).toBe("forbidden");
    expect((await reject(inviteContributor(sc.ctx, sc.ada, promo, { label: "me" }))).code).toBe("forbidden");
    expect((await reject(recordDecision(sc.ctx, sc.ada, sc.launchId, { decision: "proceed" }))).code).toBe("forbidden");
    expect((await reject(createShareLink(sc.ctx, sc.ada, sc.launchId))).code).toBe("forbidden");
    expect((await reject(replaceContributor(sc.ctx, sc.ada, promo, { label: "me" }, {}))).code).toBe("forbidden");
    expect((await reject(getOwnerBrief(sc.ctx, sc.ada, sc.launchId))).code).toBe("forbidden");
  });

  it("outsiders have no founder powers either", async () => {
    expect((await reject(updateLaunch(sc.ctx, sc.mallory, sc.launchId, { name: "x", targetAt: "2026-11-09T22:00:00Z" }))).code).toBe("not_found");
    expect((await reject(addRequirement(sc.ctx, sc.mallory, sc.launchId, { title: "x", kind: "commitment" }))).code).toBe("not_found");
    expect((await reject(removeRequirement(sc.ctx, sc.mallory, promo))).code).toBe("not_found");
  });

  it("a founder of another workspace cannot touch this launch", async () => {
    const other = await createWorkspace(sc.ctx, sc.mallory, { name: "Rival" });
    expect(other.id).toBeTruthy();
    expect((await reject(updateRequirement(sc.ctx, sc.mallory, promo, { title: "pwned" }))).code).toBe("not_found");
  });

  it("the founder cannot accept their own invitation (confirmations must be independent)", async () => {
    const second = await addReq(sc, { title: "Second", kind: "commitment" });
    const i2 = await invite(sc, second, "Somebody");
    expect((await reject(acceptInvitation(sc.ctx, sc.founder, i2.token))).code).toBe("invalid");
  });

  it("the founder cannot supply deliverable evidence on a contributor's behalf", async () => {
    const d = await addReq(sc, { title: "Press kit", kind: "deliverable" });
    const idl = await invite(sc, d, "Grace");
    await accept(sc, sc.grace, idl.token);
    await confirmCommitment(sc.ctx, sc.grace, idl.assignmentId);
    expect((await reject(submitEvidence(sc.ctx, sc.founder, d, { kind: "note", value: "done, trust me" }))).code).toBe("forbidden");
    expect((await reject(submitEvidence(sc.ctx, sc.ada, d, { kind: "note", value: "not my task" }))).code).toBe("not_found");
    expect((await reject(submitEvidence(sc.ctx, sc.mallory, d, { kind: "note", value: "hi" }))).code).toBe("not_found");
  });

  it("contributors only see their own evidence in the room payload", async () => {
    const d = await addReq(sc, { title: "Press kit", kind: "deliverable" });
    const idl = await invite(sc, d, "Grace");
    await accept(sc, sc.grace, idl.token);
    await confirmCommitment(sc.ctx, sc.grace, idl.assignmentId);
    await submitEvidence(sc.ctx, sc.grace, d, { kind: "note", value: "private draft notes" });
    // Ada has a live assignment on the launch so may open the room, but Grace's evidence is not hers to see.
    const adaView = await room(sc, sc.ada);
    expect(adaView.requirements.find((r) => r.id === d)!.evidence).toEqual([]);
    expect(adaView.launch.shareToken).toBeNull();
    expect((await room(sc)).requirements.find((r) => r.id === d)!.evidence).toHaveLength(1);
  });

  it("rejects invalid, expired and reused invitation secrets", async () => {
    expect((await reject(acceptInvitation(sc.ctx, sc.grace, "gl_not-a-real-token"))).code).toBe("not_found");
    // Ada's token was consumed on accept.
    expect((await reject(acceptInvitation(sc.ctx, sc.grace, inv.token))).code).toBe("not_found");

    const second = await addReq(sc, { title: "Second", kind: "commitment" });
    const i2 = await invite(sc, second, "Grace");
    sc.clock.advanceHours(24 * 8);
    expect((await reject(acceptInvitation(sc.ctx, sc.grace, i2.token))).code).toBe("conflict");
    const fresh = await reissueInvitation(sc.ctx, sc.founder, i2.assignmentId);
    if (fresh.duplicate) throw new Error("dup");
    await acceptInvitation(sc.ctx, sc.grace, fresh.value.token);
    expect((await statusOf(sc, second)).status).toBe("incomplete");
  });

  it("stores only a hash of each invitation secret", async () => {
    const rows = (await sc.pg.query<{ token_hash: string | null }>(`select token_hash from assignments`)).rows;
    for (const r of rows) expect(r.token_hash === null || /^[0-9a-f]{64}$/.test(r.token_hash)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(inv.token);
  });
});

describe("duplicate events and concurrent updates", () => {
  it("the same idempotency key is processed once", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment" });
    const inv = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, inv.token);
    const a = await confirmCommitment(sc.ctx, sc.ada, inv.assignmentId, "confirm-1");
    const b = await confirmCommitment(sc.ctx, sc.ada, inv.assignmentId, "confirm-1");
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(await count(sc, "assignment.confirmed")).toBe(1);
  });

  it("confirming twice without a key is a conflict, not a second event", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment" });
    const inv = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, inv.token);
    await confirmCommitment(sc.ctx, sc.ada, inv.assignmentId);
    expect((await reject(confirmCommitment(sc.ctx, sc.ada, inv.assignmentId))).code).toBe("conflict");
    expect(await count(sc, "assignment.confirmed")).toBe(1);
  });

  it("when two people race for one invitation link exactly one wins", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment" });
    const inv = await invite(sc, promo, "Whoever");
    const results = await Promise.allSettled([
      acceptInvitation(sc.ctx, sc.ada, inv.token),
      acceptInvitation(sc.ctx, sc.grace, inv.token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await count(sc, "assignment.accepted")).toBe(1);
    const owners = (await sc.pg.query(`select user_id from assignments where requirement_id = $1`, [promo])).rows;
    expect(owners).toHaveLength(1);
  });

  it("concurrent confirm and withdraw leave a single coherent outcome", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment" });
    const inv = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, inv.token);
    await Promise.allSettled([
      confirmCommitment(sc.ctx, sc.ada, inv.assignmentId),
      withdrawCommitment(sc.ctx, sc.ada, inv.assignmentId, { reason: "sick" }),
    ]);
    const state = (await sc.pg.query<{ state: string }>(`select state::text as state from assignments where id = $1`, [inv.assignmentId])).rows[0].state;
    const verdict = (await statusOf(sc, promo)).status;
    // Whichever ran last wins, and the verdict always agrees with the stored state.
    if (state === "declined") expect(verdict).toBe("blocked");
    else expect(["satisfied", "incomplete"]).toContain(verdict);
    expect(["confirmed", "declined"]).toContain(state);
  });

  it("two simultaneous submissions of the same funding transaction credit it once", async () => {
    const sc = await scenario();
    const budget = await addReq(sc, { title: "Budget", kind: "funding", funding: FUNDING });
    sc.chain.set(hash(7), () => goodTransfer("5000000"));
    const res = await Promise.allSettled([
      submitFundingTx(sc.ctx, sc.founder, budget, hash(7)),
      submitFundingTx(sc.ctx, sc.founder, budget, hash(7)),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = (await sc.pg.query(`select 1 from funding_transactions`)).rows;
    expect(rows).toHaveLength(1);
    expect((await statusOf(sc, budget)).progress?.current).toBe("5000000");
  });

  it("the database itself refuses a second live primary for one requirement", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment" });
    await invite(sc, promo, "Ada");
    expect((await reject(inviteContributor(sc.ctx, sc.founder, promo, { label: "Grace" }))).code).toBe("conflict");
    await expect(
      sc.pg.query(
        `insert into assignments (launch_id, requirement_id, role, label, state, created_by) values ($1,$2,'primary','x','invited',$3)`,
        [sc.launchId, promo, sc.founder.id],
      ),
    ).rejects.toThrow();
  });
});

describe("funding verification", () => {
  let sc: Sc;
  let budget: string;
  beforeEach(async () => {
    sc = await scenario();
    budget = await addReq(sc, { title: "Campaign budget", kind: "funding", funding: FUNDING });
  });
  const txCount = async () => (await sc.pg.query(`select 1 from funding_transactions`)).rows.length;

  it("a verified transfer for the full amount satisfies the requirement with 'verified' evidence", async () => {
    sc.chain.set(hash(1), () => goodTransfer("5000000"));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    const e = await statusOf(sc, budget);
    expect(e.status).toBe("satisfied");
    expect(e.evidenceTier).toBe("verified");
    expect((await room(sc)).readiness.state).toBe("ready");
  });

  it("partial payments accumulate: underfunded first, satisfied once the total is reached", async () => {
    sc.chain.set(hash(1), () => goodTransfer("2000000"));
    sc.chain.set(hash(2), () => goodTransfer("3000000", { blockNumber: "1001" }));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    let e = await statusOf(sc, budget);
    expect(e.status).toBe("incomplete");
    expect(e.reasons[0].code).toBe("underfunded");
    expect(e.progress).toMatchObject({ current: "2000000", required: "5000000" });
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(2));
    e = await statusOf(sc, budget);
    expect(e.status).toBe("satisfied");
  });

  it("rejects transactions the chain does not support, and records the attempt without consuming the hash", async () => {
    const cases: Array<[string, () => ReturnType<typeof goodTransfer>, RegExp]> = [
      ["wrong recipient", () => ({ ...goodTransfer("5000000"), status: "rejected", reason: "Token transfer went to 0xabc, not the funding recipient" }), /recipient/],
      ["reverted", () => ({ ...goodTransfer("5000000"), status: "rejected", reason: "Transaction reverted on-chain" }), /reverted/],
      ["wrong token", () => ({ ...goodTransfer("5000000"), status: "rejected", reason: "No transfer of the required token was found" }), /token/],
      ["wrong network", () => ({ ...goodTransfer("5000000"), status: "rejected", reason: "Wrong network: RPC reports chain 1, expected 84532" }), /Wrong network/],
    ];
    for (const [i, [, make, re]] of cases.entries()) {
      sc.chain.set(hash(100 + i), make);
      const e = await reject(submitFundingTx(sc.ctx, sc.founder, budget, hash(100 + i)));
      expect(e.code).toBe("invalid");
      expect(e.message).toMatch(re);
    }
    expect(await txCount()).toBe(0);
    expect(await count(sc, "funding.rejected")).toBe(cases.length);
    expect((await room(sc)).readiness.state).toBe("not_ready");
  });

  it("an unknown transaction hash is rejected, and a malformed one never reaches the chain", async () => {
    expect((await reject(submitFundingTx(sc.ctx, sc.founder, budget, hash(404)))).message).toMatch(/not found/i);
    const before = sc.chain.calls;
    expect((await reject(submitFundingTx(sc.ctx, sc.founder, budget, "0xdeadbeef"))).code).toBe("invalid");
    expect((await reject(submitFundingTx(sc.ctx, sc.founder, budget, "not a hash"))).code).toBe("invalid");
    expect(sc.chain.calls).toBe(before);
    expect(await txCount()).toBe(0);
  });

  it("client-claimed amounts are never used: the stored amount is what the verifier returned", async () => {
    sc.chain.set(hash(1), () => goodTransfer("1000000"));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    const row = (await sc.pg.query<{ amount: string }>(`select amount::text as amount from funding_transactions`)).rows[0];
    expect(row.amount).toBe("1000000");
    expect((await statusOf(sc, budget)).status).toBe("incomplete");
  });

  it("a transaction can be credited only once, even to a different launch", async () => {
    sc.chain.set(hash(1), () => goodTransfer("5000000"));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    expect((await reject(submitFundingTx(sc.ctx, sc.founder, budget, hash(1)))).code).toBe("conflict");

    const rival = await createLaunch(sc.ctx, sc.founder, sc.ws.id, { name: "Second", tagline: "", targetAt: "2026-11-20T00:00:00Z" });
    const r2 = await addRequirement(sc.ctx, sc.founder, rival.id, { title: "Budget", kind: "funding", funding: FUNDING });
    if (r2.duplicate) throw new Error("dup");
    expect((await reject(submitFundingTx(sc.ctx, sc.founder, r2.value.id, hash(1)))).code).toBe("conflict");
  });

  it("only launch participants can submit funding", async () => {
    sc.chain.set(hash(1), () => goodTransfer("5000000"));
    expect((await reject(submitFundingTx(sc.ctx, sc.mallory, budget, hash(1)))).code).toBe("not_found");
    expect(await txCount()).toBe(0);
  });

  it("pending transactions do not count until they reach the required confirmations", async () => {
    let confirmations = 1;
    sc.chain.set(hash(1), () =>
      goodTransfer("5000000", { status: confirmations >= 2 ? "verified" : "pending", confirmations, reason: confirmations >= 2 ? null : "Awaiting confirmations (1/2)" }),
    );
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    expect((await statusOf(sc, budget)).status).toBe("incomplete");
    expect((await statusOf(sc, budget)).reasons[0].code).toBe("funding_pending_confirmations");

    confirmations = 2;
    const r = await reverifyFunding(sc.ctx, sc.launchId, sc.founder);
    expect(r.changed).toBe(1);
    expect((await statusOf(sc, budget)).status).toBe("satisfied");
    expect(await count(sc, "funding.verified")).toBe(1);
  });

  it("the sweep promotes pending transactions without anyone pressing a button", async () => {
    let confirmations = 1;
    sc.chain.set(hash(1), () => goodTransfer("5000000", { status: confirmations >= 2 ? "verified" : "pending", confirmations }));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    confirmations = 3;
    const r = await room(sc);
    expect(r.readiness.state).toBe("ready");
  });

  it("if the chain stops supporting a verified transaction (reorg), funding is withdrawn and readiness reverts", async () => {
    sc.chain.set(hash(1), () => goodTransfer("5000000"));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    expect((await room(sc)).readiness.state).toBe("ready");
    sc.chain.drop(hash(1));
    await reverifyFunding(sc.ctx, sc.launchId, sc.founder);
    const r = await room(sc);
    expect(r.readiness.state).toBe("not_ready");
    expect((await statusOf(sc, budget)).progress?.current).toBe("0");
  });

  it("an RPC outage during re-verification leaves recorded state untouched", async () => {
    sc.chain.set(hash(1), () => goodTransfer("5000000"));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    sc.chain.set(hash(1), () => {
      throw new AppError("upstream", "rpc down");
    });
    const r = await reverifyFunding(sc.ctx, sc.launchId, sc.founder);
    expect(r.changed).toBe(0);
    expect((await room(sc)).readiness.state).toBe("ready");
  });

  it("rejects non-Base-Sepolia chains, unlisted tokens and mainnet-style configs at definition time", async () => {
    const bad = (funding: unknown) => addRequirement(sc.ctx, sc.founder, sc.launchId, { title: "x", kind: "funding", funding: funding as never });
    await expect(bad({ ...FUNDING, chainId: 8453 })).rejects.toThrow();
    await expect(bad({ ...FUNDING, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" })).rejects.toThrow();
    await expect(bad({ ...FUNDING, recipient: "not-an-address" })).rejects.toThrow();
    await expect(bad({ ...FUNDING, amount: "-5" })).rejects.toThrow();
    await expect(bad({ ...FUNDING, amount: "0" })).rejects.toThrow();
    await expect(bad({ ...FUNDING, amount: "1.0000001" })).rejects.toThrow(); // more than 6 decimals
  });

  it("funding that lands after the deadline does not satisfy the requirement", async () => {
    const sc2 = await scenario();
    const late = await addReq(sc2, { title: "Budget", kind: "funding", funding: FUNDING, deadlineAt: "2026-11-05T11:00:00Z" });
    sc2.chain.set(hash(1), () => goodTransfer("5000000", { blockTimestamp: new Date("2026-11-05T11:30:00Z") }));
    sc2.clock.advanceHours(2);
    await submitFundingTx(sc2.ctx, sc2.founder, late, hash(1));
    expect((await statusOf(sc2, late)).status).toBe("expired");
  });
});

describe("URL availability checks", () => {
  it("only a server-side check can verify; a failing site blocks, and recovery is re-checked from evidence", async () => {
    const sc = await scenario();
    const site = await addReq(sc, { title: "Landing page is live", kind: "url_check" });
    const url = "https://acme.example/";
    sc.urls.results.set(url, { ok: true, status: 200, summary: "HTTP 200 from acme.example", finalUrl: url });

    await submitEvidence(sc.ctx, sc.founder, site, { kind: "url", value: url });
    let e = await statusOf(sc, site);
    expect(e.status).toBe("satisfied");
    expect(e.evidenceTier).toBe("verified");

    sc.urls.results.set(url, { ok: false, status: 503, summary: "HTTP 503 from acme.example", finalUrl: url });
    sc.clock.advanceHours(1);
    await recheckUrl(sc.ctx, sc.founder, site);
    e = await statusOf(sc, site);
    expect(e.status).toBe("blocked");
    expect(e.reasons[0].message).toContain("503");
    expect((await room(sc)).readiness.state).toBe("not_ready");

    sc.urls.results.set(url, { ok: true, status: 200, summary: "HTTP 200 from acme.example", finalUrl: url });
    sc.clock.advanceHours(1);
    await recheckUrl(sc.ctx, sc.founder, site);
    expect((await statusOf(sc, site)).status).toBe("satisfied");
    expect(await count(sc, "evidence.failed")).toBe(1);
    expect(await count(sc, "evidence.verified")).toBe(2);
  });

  it("non-URL evidence cannot satisfy a URL check, and submissions never self-verify", async () => {
    const sc = await scenario();
    const site = await addReq(sc, { title: "Landing page is live", kind: "url_check" });
    expect((await reject(submitEvidence(sc.ctx, sc.founder, site, { kind: "note", value: "it's up, promise" }))).code).toBe("invalid");
    await submitEvidence(sc.ctx, sc.founder, site, { kind: "url", value: "https://unreachable.example/" });
    expect((await statusOf(sc, site)).status).toBe("blocked");
    const rows = (await sc.pg.query<{ verification: string }>(`select verification from evidence`)).rows;
    expect(rows.every((r) => r.verification !== "verified")).toBe(true);
  });

  it("user-submitted deliverable evidence is labelled 'submitted', never 'verified'", async () => {
    const sc = await scenario();
    const d = await addReq(sc, { title: "Press kit", kind: "deliverable" });
    const inv = await invite(sc, d, "Grace");
    await accept(sc, sc.grace, inv.token);
    expect((await reject(submitEvidence(sc.ctx, sc.grace, d, { kind: "note", value: "done" }))).code).toBe("forbidden"); // not confirmed yet
    await confirmCommitment(sc.ctx, sc.grace, inv.assignmentId);
    expect((await statusOf(sc, d)).status).toBe("incomplete");
    await submitEvidence(sc.ctx, sc.grace, d, { kind: "url", value: "https://drive.example/press-kit" });
    const e = await statusOf(sc, d);
    expect(e.status).toBe("satisfied");
    expect(e.evidenceTier).toBe("submitted");
  });
});

describe("recovery: contributor missed deadline → blocked → replacement confirms → recalculated", () => {
  async function blockedScenario() {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce on X", kind: "commitment", deadlineAt: "2026-11-06T10:00:00Z" });
    const budget = await addReq(sc, { title: "Campaign budget", kind: "funding", funding: FUNDING });
    const site = await addReq(sc, { title: "Site live", kind: "url_check" });
    const inv = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, inv.token);
    const backup = await authoriseBackup(sc.ctx, sc.founder, promo, { label: "Grace (backup)" });
    if (backup.duplicate) throw new Error("dup");
    sc.chain.set(hash(1), () => goodTransfer("5000000", { blockTimestamp: new Date("2026-11-05T10:30:00Z") }));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    sc.urls.results.set("https://acme.example/", { ok: true, status: 200, summary: "HTTP 200", finalUrl: "https://acme.example/" });
    await submitEvidence(sc.ctx, sc.founder, site, { kind: "url", value: "https://acme.example/" });
    return { sc, promo, inv };
  }

  it("the deadline passes by itself: the requirement becomes expired, the launch blocked, and the event is recorded once", async () => {
    const { sc, promo } = await blockedScenario();
    expect((await room(sc)).readiness.headline).toBe("NOT READY — 1 BLOCKER");
    expect((await statusOf(sc, promo)).status).toBe("incomplete");

    sc.clock.advanceHours(25);
    const r = await room(sc);
    const e = r.readiness.requirements.find((x) => x.requirementId === promo)!;
    expect(e.status).toBe("expired");
    expect(r.readiness.blockers[0]).toMatchObject({ title: "Announce on X", severity: "expired" });
    expect(e.next.code).toBe("activate_backup");
    expect(e.next.label).toContain("Grace (backup)");

    await room(sc);
    await sweepLaunch(sc.ctx, sc.launchId);
    expect(await count(sc, "requirement.expired")).toBe(1);
    const stored = (await sc.pg.query<{ readiness_result: { requirements: Array<{ requirementId: string; status: string }> } }>(
      `select readiness_result from launches where id = $1`, [sc.launchId])).rows[0];
    expect(stored.readiness_result.requirements.find((x) => x.requirementId === promo)!.status).toBe("expired");
  });

  it("the full recovery: activate backup → Ada can no longer confirm → Grace confirms → READY", async () => {
    const { sc, promo, inv } = await blockedScenario();
    sc.clock.advanceHours(25);
    await room(sc);

    const newDeadline = new Date(sc.clock.now().getTime() + 24 * 3_600_000);
    expect((await reject(activateBackup(sc.ctx, sc.ada, promo, { newDeadlineAt: newDeadline }))).code).toBe("forbidden");
    expect((await reject(activateBackup(sc.ctx, sc.founder, promo, { newDeadlineAt: new Date("2020-01-01") }))).code).toBe("invalid");

    const act = await activateBackup(sc.ctx, sc.founder, promo, { newDeadlineAt: newDeadline });
    if (act.duplicate) throw new Error("dup");
    expect((await statusOf(sc, promo)).status).toBe("incomplete"); // un-expired, awaiting Grace
    expect((await room(sc)).readiness.state).toBe("not_ready");

    // The original contributor is out: her late confirmation is refused and cannot revive the requirement.
    expect((await reject(confirmCommitment(sc.ctx, sc.ada, inv.assignmentId))).code).toBe("conflict");

    // Grace is not ready until she herself accepts and confirms.
    await accept(sc, sc.grace, act.value.token);
    expect((await statusOf(sc, promo)).status).toBe("incomplete");
    await confirmCommitment(sc.ctx, sc.grace, act.value.assignmentId);

    const r = await room(sc);
    expect(r.readiness.state).toBe("ready");
    const types = await eventTypes(sc);
    expect(types).toEqual(expect.arrayContaining(["requirement.expired", "assignment.backup_activated", "assignment.accepted", "assignment.confirmed"]));
    expect(types.lastIndexOf("readiness.changed")).toBeGreaterThan(types.lastIndexOf("assignment.confirmed") - 2);
  });

  it("a contributor withdrawing blocks the launch; replacing them with a newly invited person recovers it", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment", deadlineAt: "2026-11-08T00:00:00Z" });
    const inv = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, inv.token);
    await confirmCommitment(sc.ctx, sc.ada, inv.assignmentId);
    expect((await room(sc)).readiness.state).toBe("ready");

    await withdrawCommitment(sc.ctx, sc.ada, inv.assignmentId, { reason: "Family emergency" });
    let r = await room(sc);
    expect(r.readiness.state).toBe("not_ready");
    expect(r.readiness.blockers[0]).toMatchObject({ severity: "blocked" });
    expect(r.readiness.blockers[0].summary).toContain("Family emergency");
    expect(r.readiness.blockers[0].next.code).toBe("replace_or_extend");

    const rep = await replaceContributor(sc.ctx, sc.founder, promo, { label: "Grace" }, {});
    if (rep.duplicate) throw new Error("dup");
    expect((await room(sc)).readiness.state).toBe("not_ready");
    await accept(sc, sc.grace, rep.value.token);
    await confirmCommitment(sc.ctx, sc.grace, rep.value.assignmentId);
    r = await room(sc);
    expect(r.readiness.state).toBe("ready");
    expect(r.requirements.find((x) => x.id === promo)!.assignments.filter((a) => a.state !== "released")).toHaveLength(1);
  });

  it("declining an invitation blocks the requirement immediately", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment" });
    const inv = await invite(sc, promo, "Ada");
    await declineInvitation(sc.ctx, sc.ada, inv.token, { reason: "No capacity" });
    const e = await statusOf(sc, promo);
    expect(e.status).toBe("blocked");
    expect(e.reasons[0].message).toContain("No capacity");
  });

  it("a late confirmation (after the deadline) does not make a requirement ready", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment", deadlineAt: "2026-11-05T12:00:00Z" });
    const inv = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, inv.token);
    sc.clock.advanceHours(3);
    await confirmCommitment(sc.ctx, sc.ada, inv.assignmentId);
    expect((await statusOf(sc, promo)).status).not.toBe("satisfied");
    expect((await room(sc)).readiness.state).toBe("not_ready");
  });

  it("extending the deadline in a recovery re-evaluates against the new deadline", async () => {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment", deadlineAt: "2026-11-05T12:00:00Z" });
    const inv = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, inv.token);
    sc.clock.advanceHours(3);
    expect((await statusOf(sc, promo)).status).toBe("expired");
    await updateRequirement(sc.ctx, sc.founder, promo, { deadlineAt: new Date("2026-11-07T00:00:00Z") });
    expect((await statusOf(sc, promo)).status).toBe("incomplete");
    await confirmCommitment(sc.ctx, sc.ada, inv.assignmentId);
    expect((await statusOf(sc, promo)).status).toBe("satisfied");
  });
});

describe("Launch Readiness Brief and founder decision", () => {
  async function readyLaunch() {
    const sc = await scenario();
    const promo = await addReq(sc, { title: "Announce", kind: "commitment", deadlineAt: "2026-11-08T00:00:00Z" });
    const kit = await addReq(sc, { title: "Press kit", kind: "deliverable" });
    const budget = await addReq(sc, { title: "Budget", kind: "funding", funding: FUNDING });
    const site = await addReq(sc, { title: "Site live", kind: "url_check" });
    return { sc, promo, kit, budget, site };
  }
  async function complete(x: Awaited<ReturnType<typeof readyLaunch>>) {
    const { sc, promo, kit, budget, site } = x;
    const i1 = await invite(sc, promo, "Ada");
    await accept(sc, sc.ada, i1.token);
    await confirmCommitment(sc.ctx, sc.ada, i1.assignmentId);
    const i2 = await invite(sc, kit, "Grace");
    await accept(sc, sc.grace, i2.token);
    await confirmCommitment(sc.ctx, sc.grace, i2.assignmentId);
    await submitEvidence(sc.ctx, sc.grace, kit, { kind: "note", value: "Kit is in the shared drive (internal)" });
    sc.chain.set(hash(1), () => goodTransfer("5000000"));
    await submitFundingTx(sc.ctx, sc.founder, budget, hash(1));
    sc.urls.results.set("https://acme.example/", { ok: true, status: 200, summary: "HTTP 200 from acme.example", finalUrl: "https://acme.example/" });
    await submitEvidence(sc.ctx, sc.founder, site, { kind: "url", value: "https://acme.example/" });
  }

  it("distinguishes independently verified evidence from user-submitted claims", async () => {
    const x = await readyLaunch();
    await complete(x);
    const brief = await buildBrief(x.sc.db, x.sc.launchId, x.sc.clock.now(), { redactNotes: false });
    expect(brief.readiness.state).toBe("ready");
    const tier = (t: string) => brief.requirements.find((r) => r.title === t)!.evidenceTier;
    expect(tier("Budget")).toBe("verified");
    expect(tier("Site live")).toBe("verified");
    expect(tier("Press kit")).toBe("submitted");
    expect(tier("Announce")).toBe("submitted"); // a confirmation is an attestation, not a check
    expect(brief.funding[0].transactions[0]).toMatchObject({ txHash: hash(1), status: "verified" });
    expect(brief.funding[0].transactions[0].explorerUrl).toBe(`https://sepolia.basescan.org/tx/${hash(1)}`);
    expect(brief.funding[0]).toMatchObject({ target: "5000000", verified: "5000000", symbol: "USDC", chainId: 84532 });
    expect(brief.contributors.map((c) => c.name).sort()).toEqual(["Ada", "Grace"]);
    expect(brief.blockers).toEqual([]);
    const kit = brief.requirements.find((r) => r.title === "Press kit")!;
    expect(kit.evidence[0]).toMatchObject({ knownAs: "submitted", submittedBy: "Grace" });
    expect(brief.decision).toBeNull();
  });

  it("lists outstanding blockers and their owners when not ready", async () => {
    const { sc, promo } = await readyLaunch();
    await invite(sc, promo, "Ada");
    const brief = await buildBrief(sc.db, sc.launchId, sc.clock.now(), { redactNotes: true });
    expect(brief.readiness.state).toBe("not_ready");
    expect(brief.blockers.length).toBe(4);
    expect(brief.blockers.find((b) => b.title === "Announce")!.owner).toBe("Ada");
  });

  it("founder retains final authority: READY allows proceed; NOT READY requires an explicit, recorded override", async () => {
    const x = await readyLaunch();
    const { sc } = x;
    expect((await reject(recordDecision(sc.ctx, sc.founder, sc.launchId, { decision: "proceed" }))).code).toBe("conflict");
    expect((await reject(recordDecision(sc.ctx, sc.founder, sc.launchId, { decision: "proceed", overrideAcknowledged: true, note: "short" }))).code).toBe("invalid");

    await recordDecision(sc.ctx, sc.founder, sc.launchId, { decision: "proceed", overrideAcknowledged: true, note: "Partner confirmed by phone; accepting the risk." });
    let brief = await buildBrief(sc.db, sc.launchId, sc.clock.now(), { redactNotes: true });
    expect(brief.decision).toMatchObject({ decision: "proceed_override", decidedBy: "Founder" });
    expect(brief.decision!.unresolvedAtDecision).toHaveLength(4);
    expect(brief.readiness.state).toBe("not_ready"); // the override did not change the verdict

    // Frozen while "proceed" stands.
    expect((await reject(addRequirement(sc.ctx, sc.founder, sc.launchId, { title: "late", kind: "commitment" }))).code).toBe("conflict");
    await recordDecision(sc.ctx, sc.founder, sc.launchId, { decision: "hold" });
    await addReq(sc, { title: "now allowed", kind: "commitment" });

    await complete(x);
    // (complete adds nothing new for the extra requirement; invite it to reach ready)
    brief = await buildBrief(sc.db, sc.launchId, sc.clock.now(), { redactNotes: true });
    expect(brief.readiness.state).toBe("not_ready");
  });

  it("proceeding while READY is recorded as a plain 'proceed' with timestamp and decider", async () => {
    const x = await readyLaunch();
    await complete(x);
    x.sc.clock.advanceHours(1);
    await recordDecision(x.sc.ctx, x.sc.founder, x.sc.launchId, { decision: "proceed", note: "Go." });
    const brief = await getOwnerBrief(x.sc.ctx, x.sc.founder, x.sc.launchId);
    expect(brief.decision).toMatchObject({ decision: "proceed", note: "Go.", decidedAt: x.sc.clock.now().toISOString() });
    const snap = (await x.sc.pg.query<{ decision_snapshot: { brief: { readiness: { state: string } } } }>(
      `select decision_snapshot from launches where id = $1`, [x.sc.launchId])).rows[0].decision_snapshot;
    expect(snap.brief.readiness.state).toBe("ready");
  });

  it("share links are unguessable, redact note bodies, and can be revoked", async () => {
    const x = await readyLaunch();
    await complete(x);
    const { sc } = x;
    expect(await getSharedBrief(sc.ctx, "br_guess")).toBeNull();
    const link = await createShareLink(sc.ctx, sc.founder, sc.launchId);
    if (link.duplicate) throw new Error("dup");
    expect(link.value.token).toMatch(/^br_[A-Za-z0-9_-]{32}$/);
    const pub = await getSharedBrief(sc.ctx, link.value.token);
    expect(pub).not.toBeNull();
    expect(JSON.stringify(pub)).not.toContain("shared drive (internal)");
    expect(pub!.requirements.find((r) => r.title === "Press kit")!.evidence[0].value).toBeNull();
    expect(JSON.stringify(pub)).not.toContain("@example.test"); // no contributor emails

    const owner = await getOwnerBrief(sc.ctx, sc.founder, sc.launchId);
    expect(owner.requirements.find((r) => r.title === "Press kit")!.evidence[0].value).toContain("shared drive");

    await revokeShareLink(sc.ctx, sc.founder, sc.launchId);
    expect(await getSharedBrief(sc.ctx, link.value.token)).toBeNull();
  });

  it("a public brief reflects expiry that happened after it was shared", async () => {
    const x = await readyLaunch();
    const { sc, promo } = x;
    await complete(x);
    const link = await createShareLink(sc.ctx, sc.founder, sc.launchId);
    if (link.duplicate) throw new Error("dup");
    expect((await getSharedBrief(sc.ctx, link.value.token))!.readiness.state).toBe("ready");
    // Ada withdraws after the brief was shared; the live brief must turn NOT READY.
    const a = (await sc.pg.query<{ id: string }>(`select id from assignments where requirement_id = $1`, [promo])).rows[0];
    await withdrawCommitment(sc.ctx, sc.ada, a.id, { reason: "unavailable" });
    expect((await getSharedBrief(sc.ctx, link.value.token))!.readiness.state).toBe("not_ready");
  });
});

describe("input validation", () => {
  it("rejects bad launch input and past target dates", async () => {
    const s = await setup();
    const f = await s.user("Founder");
    const ws = await createWorkspace(s.ctx, f, { name: "W" });
    await expect(createLaunch(s.ctx, f, ws.id, { name: "", tagline: "", targetAt: "2026-12-01T00:00:00Z" })).rejects.toThrow();
    await expect(createLaunch(s.ctx, f, ws.id, { name: "ok", tagline: "", targetAt: "not-a-date" })).rejects.toThrow();
    expect((await reject(createLaunch(s.ctx, f, ws.id, { name: "ok", tagline: "", targetAt: "2020-01-01T00:00:00Z" }))).code).toBe("invalid");
    const other = await s.user("Other");
    expect((await reject(createLaunch(s.ctx, other, ws.id, { name: "ok", tagline: "", targetAt: "2026-12-01T00:00:00Z" }))).code).toBe("not_found");
  });

  it("funding requirements cannot be assigned to people", async () => {
    const sc = await scenario();
    const b = await addReq(sc, { title: "Budget", kind: "funding", funding: FUNDING });
    expect((await reject(inviteContributor(sc.ctx, sc.founder, b, { label: "Ada" }))).code).toBe("invalid");
  });
});
