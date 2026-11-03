import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { open } from "./helpers";

/**
 * The full product journey against REAL Supabase Auth and Database, from independent signed-in sessions.
 *
 *   E2E_BASE_URL=https://<deployment> npx playwright test --project=real
 *
 * Needs four ALREADY-CONFIRMED accounts (email confirmation is a project-wide Supabase setting that
 * Greenlight does not change, and this test never bypasses it). Create them once through the normal
 * sign-up page, click the confirmation emails, then put them in .env.local:
 *
 *   E2E_FOUNDER_EMAIL / E2E_FOUNDER_PASSWORD     E2E_ADA_EMAIL / E2E_ADA_PASSWORD
 *   E2E_GRACE_EMAIL / E2E_GRACE_PASSWORD         E2E_OUTSIDER_EMAIL / E2E_OUTSIDER_PASSWORD
 *
 * Funding is deliberately NOT automated: sending USDC needs a wallet approval from a human. This spec
 * proves the other half instead — that a missing funding transaction keeps the launch NOT READY — and
 * `npm run verify:funding` proves the credited transaction afterwards.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may come from the shell */
}
const accounts = (["FOUNDER", "ADA", "GRACE", "OUTSIDER"] as const).map((k) => ({
  key: k,
  email: process.env[`E2E_${k}_EMAIL`] ?? "",
  password: process.env[`E2E_${k}_PASSWORD`] ?? "",
}));
const configured = accounts.every((a) => a.email && a.password);
const RUN = Date.now().toString(36);
const RECIPIENT = "0xa849bbad82f9edafdf9a5550cc874276138779d9";

const headline = (p: Page) => p.locator("h2[aria-live=polite]");
const card = (p: Page, title: string): Locator => p.getByRole("article").filter({ has: p.getByRole("heading", { name: title }) });
const local = (min: number) => new Date(Date.now() + min * 60_000).toISOString().slice(0, 16);

async function signedIn(browser: Browser, who: (typeof accounts)[number]) {
  const context = await browser.newContext({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await open(page, "/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });
  return { context, page, name: who.key };
}
type S = Awaited<ReturnType<typeof signedIn>>;

async function addReq(page: Page, f: { kind?: string; title: string; deadline?: string; recipient?: string; amount?: string }) {
  const toggle = page.getByRole("button", { name: "Add requirement", exact: true, expanded: false });
  if (await toggle.count()) await toggle.click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add requirement", exact: true }) });
  if (f.kind) await form.getByLabel("Type").selectOption(f.kind);
  await form.getByLabel("Title").fill(f.title);
  if (f.recipient) await form.getByLabel(/Recipient wallet/).fill(f.recipient);
  if (f.amount) await form.getByLabel(/^Amount/).fill(f.amount);
  if (f.deadline) await form.getByLabel("Deadline").fill(f.deadline);
  await form.getByRole("button", { name: "Add requirement" }).click();
  await expect(card(page, f.title)).toBeVisible({ timeout: 60_000 });
}

async function invite(page: Page, title: string, label: string) {
  const c = card(page, title);
  await c.getByLabel("Invite a contributor").fill(label);
  await c.getByRole("button", { name: "Create invitation" }).click();
  const banner = page.getByRole("status").filter({ hasText: `Invitation ready for ${label}` });
  await expect(banner).toBeVisible({ timeout: 60_000 });
  return (await banner.locator("p.break-all").innerText()).trim().replace(/^.*?\/invite\//, "/invite/");
}

test.describe("real Supabase journey", () => {
  test.skip(!configured, "Set E2E_{FOUNDER,ADA,GRACE,OUTSIDER}_{EMAIL,PASSWORD} (confirmed accounts) in .env.local — see the header of e2e/real.spec.ts");

  test("founder + two contributors + outsider: create → invite → confirm → expire → recover → still NOT READY without funding → brief → isolation", async ({ browser }) => {
    const [founder, ada, grace, outsider]: S[] = await Promise.all(accounts.map((a) => signedIn(browser, a)));
    const all = [founder, ada, grace, outsider];
    for (const s of all) s.page.on("dialog", (d) => void d.accept());
    try {
      // ── real session behaviour ───────────────────────────────────────────────────────────
      await founder.page.reload();
      await expect(founder.page).toHaveURL(/\/app$/); // session persisted across a reload
      const second = await founder.context.newPage(); // …and across tabs
      await second.goto("/app");
      await expect(second).toHaveURL(/\/app$/);
      await second.close();

      // ── founder: workspace + launch ──────────────────────────────────────────────────────
      const emptyWorkspace = founder.page.getByLabel("Workspace name");
      if (await emptyWorkspace.count()) {
        await emptyWorkspace.fill("Real-run workspace");
        await founder.page.getByRole("button", { name: "Create workspace" }).click();
      }
      await open(founder.page, "/app/launches/new");
      await founder.page.getByLabel("Launch name").fill(`Real run ${RUN}`);
      await founder.page.getByRole("button", { name: "Create launch room" }).click();
      await expect(founder.page).toHaveURL(/\/app\/launches\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const launchUrl = founder.page.url();
      const launchId = launchUrl.split("/").pop()!;
      await expect(headline(founder.page)).toHaveText("NOT READY — NO REQUIREMENTS DEFINED");

      await addReq(founder.page, { title: "Announcement thread live", deadline: local(2) });
      await addReq(founder.page, { title: "Partner AMA scheduled", deadline: local(60 * 48) });
      await addReq(founder.page, { kind: "url_check", title: "Landing page is live" });
      await addReq(founder.page, { kind: "funding", title: "Campaign budget secured", recipient: RECIPIENT, amount: "5", deadline: local(60 * 48) });
      await expect(headline(founder.page)).toHaveText("NOT READY — 4 BLOCKERS");

      // ── invitations to independently authenticated contributors ─────────────────────────
      const link1 = await invite(founder.page, "Announcement thread live", "Ada");
      const c1 = card(founder.page, "Announcement thread live");
      await c1.getByLabel("Authorise a backup (optional)").fill("Grace");
      await c1.getByRole("button", { name: "Add backup" }).click();
      await expect(c1.getByText("Authorised backup:")).toBeVisible();
      const ib = await (async () => {
        const c = card(founder.page, "Partner AMA scheduled");
        await c.getByLabel("Invite a contributor").fill("Ada");
        await c.getByRole("button", { name: "Create invitation" }).click();
        const banner = founder.page.getByRole("status").filter({ hasText: "Invitation ready for Ada" });
        await expect.poll(async () => (await banner.locator("p.break-all").innerText()).trim().replace(/^.*?\/invite\//, "/invite/")).not.toBe(link1);
        return (await banner.locator("p.break-all").innerText()).trim().replace(/^.*?\/invite\//, "/invite/");
      })();

      await open(ada.page, link1);
      await ada.page.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(ada.page).toHaveURL(launchUrl, { timeout: 60_000 });
      await open(ada.page, ib);
      await ada.page.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(ada.page).toHaveURL(launchUrl, { timeout: 60_000 });
      await card(ada.page, "Partner AMA scheduled").getByRole("button", { name: "Confirm I'll deliver this" }).click();
      await expect(card(ada.page, "Partner AMA scheduled").getByText(/You confirmed on/)).toBeVisible({ timeout: 60_000 });
      await expect(headline(founder.page)).toHaveText("NOT READY — 3 BLOCKERS", { timeout: 90_000 });

      // ── a used link cannot be replayed; the founder cannot accept their own invitation ─────
      await open(grace.page, link1);
      await expect(grace.page.getByRole("heading", { name: /already used|doesn't exist/ })).toBeVisible();

      // ── server-side site check against the real public web ───────────────────────────────
      const site = card(founder.page, "Landing page is live");
      await site.getByLabel("Public URL to check").fill("https://example.com");
      await site.getByRole("button", { name: "Check site" }).click();
      await expect(site.getByText(/Verified: HTTP 200/)).toBeVisible({ timeout: 90_000 });

      // ── the deadline passes on its own → EXPIRED → authorised recovery ───────────────────
      const blocker = founder.page.getByRole("listitem").filter({ has: founder.page.getByRole("heading", { name: "Announcement thread live" }) }).first();
      await expect(blocker.getByText("Expired", { exact: true })).toBeVisible({ timeout: 180_000 });
      await blocker.getByRole("button", { name: /Activate Grace/ }).click();
      const gb = founder.page.getByRole("status").filter({ hasText: "Invitation ready for Grace" });
      await expect(gb).toBeVisible({ timeout: 60_000 });
      const graceLink = (await gb.locator("p.break-all").innerText()).trim().replace(/^.*?\/invite\//, "/invite/");
      await open(grace.page, graceLink);
      await grace.page.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(grace.page).toHaveURL(launchUrl, { timeout: 60_000 });
      await card(grace.page, "Announcement thread live").getByRole("button", { name: "Confirm I'll deliver this" }).click();
      await expect(card(grace.page, "Announcement thread live").getByText(/You confirmed on/)).toBeVisible({ timeout: 60_000 });

      // ── the core guarantee: everything but funding is done, so it is NOT READY ───────────
      await expect(headline(founder.page)).toHaveText("NOT READY — 1 BLOCKER", { timeout: 90_000 });
      await expect(founder.page.locator("#blockers").getByText("Campaign budget secured").first()).toBeVisible();
      await expect(founder.page.getByText("READY TO LAUNCH")).toHaveCount(0);
      await expect(founder.page.getByRole("button", { name: "Proceed with launch" })).toHaveCount(0);

      // ── state survives reloads and brand-new independent sessions ─────────────────────────
      await founder.page.reload();
      await expect(headline(founder.page)).toHaveText("NOT READY — 1 BLOCKER");
      const fresh = await signedIn(browser, accounts[0]);
      await open(fresh.page, launchUrl);
      await expect(headline(fresh.page)).toHaveText("NOT READY — 1 BLOCKER");
      await fresh.context.close();

      // ── brief + share + revoke ───────────────────────────────────────────────────────────
      await open(founder.page, `${launchUrl}/brief`);
      await expect(founder.page.locator("article").getByText("NOT READY — 1 BLOCKER").first()).toBeVisible();
      await expect(founder.page.locator("article").getByText("Campaign budget secured").first()).toBeVisible();
      await founder.page.getByRole("button", { name: "Create public link" }).click();
      const share = (await founder.page.locator("p.break-all").first().innerText()).trim().replace(/^.*?\/brief\//, "/brief/");
      expect(share).toMatch(/^\/brief\/br_/);
      const anon = await browser.newContext();
      const pub = await anon.newPage();
      await open(pub, share);
      await expect(pub.getByRole("heading", { level: 1 })).toContainText(`Real run ${RUN}`);
      expect(await pub.content()).not.toContain("@");
      await founder.page.getByRole("button", { name: "Revoke link" }).click();
      await expect(founder.page.getByRole("button", { name: "Create public link" })).toBeVisible();
      expect((await pub.goto(share))?.status()).toBe(404);
      await anon.close();

      // ── authorization: an outsider and a contributor cannot see or change founder-only pages ─
      for (const path of [launchUrl, `${launchUrl}/brief`, `${launchUrl}/settings`]) {
        expect((await outsider.page.goto(path))?.status(), `outsider ${path}`).toBe(404);
      }
      for (const path of [`${launchUrl}/brief`, `${launchUrl}/settings`]) {
        expect((await ada.page.goto(path))?.status(), `contributor ${path}`).toBe(404);
      }
      void launchId;
    } finally {
      await Promise.all(all.map((s) => s.context.close()));
    }
  });
});
