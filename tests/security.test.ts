import { beforeEach, describe, expect, it } from "vitest";
import { isHttpUrl, safeHref } from "@/lib/safe-url";
import { resetRateLimits } from "@/lib/rate-limit";
import { acceptInvitation, confirmCommitment, inviteContributor } from "@/lib/services/assignments";
import { submitEvidence } from "@/lib/services/evidence";
import { submitFundingTx } from "@/lib/services/funding";
import { addRequirement, createLaunch, createWorkspace } from "@/lib/services/launches";
import { buildBrief } from "@/lib/services/brief";
import { RECIPIENT, USDC, hash, setup } from "./helpers/harness";

beforeEach(() => resetRateLimits());

describe("link safety (stored-XSS vector: evidence URLs are rendered as hrefs)", () => {
  const hostile = [
    "javascript:alert(document.cookie)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "//evil.example/x",
  ];
  it.each(hostile)("rejects %s as a link", (u) => {
    expect(isHttpUrl(u)).toBe(false);
    expect(safeHref(u)).toBeUndefined();
  });
  it("accepts ordinary web links", () => {
    for (const u of ["https://example.com", "http://example.com/a?b=c#d", "https://sub.example.co.uk:8443/x"]) {
      expect(safeHref(u)).toBe(u);
    }
  });

  async function scenario() {
    const s = await setup();
    const founder = await s.user("Founder");
    const grace = await s.user("Grace");
    const ws = await createWorkspace(s.ctx, founder, { name: "W" });
    const launch = await createLaunch(s.ctx, founder, ws.id, { name: "L", tagline: "", targetAt: "2026-11-09T22:00:00Z" });
    return { ...s, founder, grace, launchId: launch.id };
  }

  it("a contributor cannot store a javascript: link as deliverable evidence", async () => {
    const sc = await scenario();
    const req = await addRequirement(sc.ctx, sc.founder, sc.launchId, { title: "Press kit", kind: "deliverable" });
    if (req.duplicate) throw new Error("dup");
    const inv = await inviteContributor(sc.ctx, sc.founder, req.value.id, { label: "Grace" });
    if (inv.duplicate) throw new Error("dup");
    await acceptInvitation(sc.ctx, sc.grace, inv.value.token);
    await confirmCommitment(sc.ctx, sc.grace, inv.value.assignmentId);
    for (const bad of hostile) {
      await expect(submitEvidence(sc.ctx, sc.grace, req.value.id, { kind: "url", value: bad }), bad).rejects.toThrow();
    }
    expect((await sc.pg.query(`select 1 from evidence`)).rows).toHaveLength(0);
  });

  it("even a hostile link already in the database is never emitted as a clickable href in the brief data", async () => {
    const sc = await scenario();
    const req = await addRequirement(sc.ctx, sc.founder, sc.launchId, { title: "Press kit", kind: "deliverable" });
    if (req.duplicate) throw new Error("dup");
    // Simulate a legacy/foreign row that bypassed validation.
    await sc.pg.query(
      `insert into evidence (launch_id, requirement_id, submitted_by, kind, value) values ($1, $2, $3, 'url', 'javascript:alert(1)')`,
      [sc.launchId, req.value.id, sc.founder.id],
    );
    const brief = await buildBrief(sc.db, sc.launchId, sc.clock.now(), { redactNotes: false });
    const ev = brief.requirements[0].evidence[0];
    // The data layer carries the raw value; the renderer must refuse to link it.
    expect(safeHref(ev.value ?? "")).toBeUndefined();
  });
});

describe("rate limiting of actions that call out to the network", () => {
  it("throttles repeated site-check submissions per person, and releases after the window", async () => {
    const s = await setup();
    const founder = await s.user("Founder");
    const other = await s.user("Other");
    const ws = await createWorkspace(s.ctx, founder, { name: "W" });
    const launch = await createLaunch(s.ctx, founder, ws.id, { name: "L", tagline: "", targetAt: "2026-11-09T22:00:00Z" });
    const req = await addRequirement(s.ctx, founder, launch.id, { title: "Site", kind: "url_check" });
    if (req.duplicate) throw new Error("dup");
    s.urls.results.set("https://acme.example/", { ok: true, status: 200, summary: "ok", finalUrl: "https://acme.example/" });
    for (let i = 0; i < 12; i++) await submitEvidence(s.ctx, founder, req.value.id, { kind: "url", value: "https://acme.example/" });
    await expect(submitEvidence(s.ctx, founder, req.value.id, { kind: "url", value: "https://acme.example/" })).rejects.toThrow(/Too many attempts/);
    // the limit is per person, not global
    await expect(submitEvidence(s.ctx, other, req.value.id, { kind: "url", value: "https://acme.example/" })).rejects.not.toThrow(/Too many attempts/);
    s.clock.advanceHours(0.02); // 72 seconds
    await submitEvidence(s.ctx, founder, req.value.id, { kind: "url", value: "https://acme.example/" });
  });

  it("throttles funding-hash attempts per person before they reach the chain", async () => {
    const s = await setup();
    const founder = await s.user("Founder");
    const ws = await createWorkspace(s.ctx, founder, { name: "W" });
    const launch = await createLaunch(s.ctx, founder, ws.id, { name: "L", tagline: "", targetAt: "2026-11-09T22:00:00Z" });
    const req = await addRequirement(s.ctx, founder, launch.id, {
      title: "Budget",
      kind: "funding",
      funding: { chainId: 84532, token: USDC, recipient: RECIPIENT, amount: "5", minConfirmations: 2 },
    });
    if (req.duplicate) throw new Error("dup");
    for (let i = 0; i < 12; i++) await expect(submitFundingTx(s.ctx, founder, req.value.id, hash(1000 + i))).rejects.toThrow(/not found/i);
    const callsBefore = s.chain.calls;
    await expect(submitFundingTx(s.ctx, founder, req.value.id, hash(2000))).rejects.toThrow(/Too many attempts/);
    expect(s.chain.calls).toBe(callsBefore); // the 13th attempt never reached the RPC
  });
});

describe("hostile text is stored inertly", () => {
  it("names, labels and notes containing markup round-trip as plain data (React renders them as text)", async () => {
    const s = await setup();
    const founder = await s.user("<img src=x onerror=alert(1)>");
    const ws = await createWorkspace(s.ctx, founder, { name: "<script>alert(1)</script>" });
    const launch = await createLaunch(s.ctx, founder, ws.id, { name: "\"><svg/onload=alert(1)>", tagline: "", targetAt: "2026-11-09T22:00:00Z" });
    const row = (await s.pg.query<{ name: string }>(`select name from launches where id = $1`, [launch.id])).rows[0];
    expect(row.name).toBe("\"><svg/onload=alert(1)>");
    const actor = (await s.pg.query<{ actor_label: string }>(`select actor_label from events where type = 'launch.created'`)).rows[0];
    expect(actor.actor_label).toBe("<img src=x onerror=alert(1)>");
  });
});
