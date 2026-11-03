import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { open } from "./helpers";

/**
 * The complete product workflow with four independent authenticated browser sessions:
 * a founder, two contributors (Ada, Grace) and an outsider (Mallory).
 *
 * Needs an app wired to a database and an auth provider (see README → Testing). Funding is verified
 * against a REAL, pre-existing USDC transfer on Base Sepolia through the live RPC — the app has no
 * test mode; this goes through the production verifier.
 *
 *   https://sepolia.basescan.org/tx/0x1b93805d4e4a68d01b7e0f4a67bf50bb6aa8727f8b2c378165defb872d7df0c4
 */
const TX = "0x1b93805d4e4a68d01b7e0f4a67bf50bb6aa8727f8b2c378165defb872d7df0c4";
const RECIPIENT = "0xa849bbad82f9edafdf9a5550cc874276138779d9";
const RUN = Date.now().toString(36);
const PASSWORD = "correct-horse-battery";

const local = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString().slice(0, 16); // browser TZ is UTC (see config)

async function session(browser: Browser, name: string) {
  const context = await browser.newContext({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  return { context, page, name, email: `${name.toLowerCase()}.${RUN}@example.test` };
}
type Who = Awaited<ReturnType<typeof session>>;

async function signUp(who: Who, from = "/login?mode=signup") {
  await open(who.page, from);
  if (!who.page.url().includes("/login")) throw new Error(`expected the login page, got ${who.page.url()}`);
  await who.page.getByLabel("Your name").fill(who.name);
  await who.page.getByLabel("Email").fill(who.email);
  await who.page.getByLabel("Password").fill(PASSWORD);
  await who.page.getByRole("button", { name: "Create account" }).click();
}

const headline = (page: Page) => page.locator("h2[aria-live=polite]");
const card = (page: Page, title: string): Locator => page.getByRole("article").filter({ has: page.getByRole("heading", { name: title }) });
const noHorizontalScroll = async (page: Page, label: string) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${label}: horizontal overflow ${sw} > ${cw}`).toBeLessThanOrEqual(cw);
};

async function addRequirement(page: Page, f: { kind?: string; title: string; deadline?: string; recipient?: string; amount?: string; optional?: boolean }) {
  const toggle = page.getByRole("button", { name: "Add requirement", exact: true, expanded: false });
  if (await toggle.count()) await toggle.click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add requirement", exact: true }) });
  if (f.kind) await form.getByLabel("Type").selectOption(f.kind);
  await form.getByLabel("Title").fill(f.title);
  if (f.recipient) await form.getByLabel(/Recipient wallet/).fill(f.recipient);
  if (f.amount) await form.getByLabel(/^Amount/).fill(f.amount);
  if (f.deadline) await form.getByLabel("Deadline").fill(f.deadline);
  if (f.optional) await form.getByLabel(/Mandatory/).uncheck();
  await form.getByRole("button", { name: "Add requirement" }).click();
  await expect(page.getByRole("heading", { name: f.title, level: 3 }).first()).toBeVisible();
}

/** Issues an invitation from the requirement card and returns the private link shown once. */
async function invite(page: Page, title: string, label: string, previous?: string) {
  const c = card(page, title);
  await c.getByLabel("Invite a contributor").fill(label);
  await c.getByRole("button", { name: "Create invitation" }).click();
  const banner = page.getByRole("status").filter({ hasText: `Invitation ready for ${label}` });
  await expect(banner).toBeVisible();
  const read = async () => (await banner.locator("p.break-all").innerText()).trim();
  // The banner is replaced by each new invitation; wait until it shows the new link, not a stale one.
  if (previous) await expect.poll(read).not.toBe(previous);
  const link = await read();
  expect(link).toMatch(/\/invite\/gl_[A-Za-z0-9_-]{30,}$/);
  return link;
}

test("founder, two contributors and an outsider: create → confirm → fund → expire → recover → READY → brief", async ({ browser }) => {
  const founder = await session(browser, "Founder");
  const ada = await session(browser, "Ada");
  const grace = await session(browser, "Grace");
  const mallory = await session(browser, "Mallory");
  const contexts: BrowserContext[] = [founder, ada, grace, mallory].map((s) => s.context);

  try {
    // ── 1. Founder: real sign-up, workspace, launch ───────────────────────────────────────
    await signUp(founder);
    await expect(founder.page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
    await founder.page.getByLabel("Workspace name").fill("Acme Labs");
    await founder.page.getByRole("button", { name: "Create workspace" }).click();
    await founder.page.getByRole("link", { name: "Create your first launch" }).click();
    await founder.page.getByLabel("Launch name").fill("Acme Token Launch");
    await founder.page.getByRole("button", { name: "Create launch room" }).click();
    await expect(founder.page).toHaveURL(/\/app\/launches\/[0-9a-f-]{36}$/);
    const launchUrl = founder.page.url();
    const launchId = launchUrl.split("/").pop()!;
    await expect(headline(founder.page)).toHaveText("NOT READY — NO REQUIREMENTS DEFINED");

    // ── 2. Requirements: a short-fuse commitment (will expire), a normal one, funding, site check ─
    await addRequirement(founder.page, { title: "Announcement thread live", deadline: local(2) });
    await addRequirement(founder.page, { title: "Partner AMA scheduled", deadline: local(60 * 48) });
    await addRequirement(founder.page, { kind: "funding", title: "Campaign budget secured", recipient: RECIPIENT, amount: "0.001", deadline: local(60 * 48) });
    await addRequirement(founder.page, { kind: "url_check", title: "Landing page is live" });
    await expect(headline(founder.page)).toHaveText("NOT READY — 4 BLOCKERS");

    // ── 3. Invitations (private, single-use links) ─────────────────────────────────────────
    const adaLink1 = await invite(founder.page, "Announcement thread live", "Ada");
    const adaLink2 = await invite(founder.page, "Partner AMA scheduled", "Ada", adaLink1);
    const c1 = card(founder.page, "Announcement thread live");
    await c1.getByLabel("Authorise a backup (optional)").fill("Grace");
    await c1.getByRole("button", { name: "Add backup" }).click();
    await expect(c1.getByText("Authorised backup:")).toBeVisible();

    // ── 4. Ada (independent session): sign up via the invite, accept both, confirm the AMA only ─
    await open(ada.page, adaLink1.replace(/^.*?\/invite\//, "/invite/"));
    await expect(ada.page).toHaveURL(/\/login\?mode=signup&next=/);
    await ada.page.getByLabel("Your name").fill(ada.name);
    await ada.page.getByLabel("Email").fill(ada.email);
    await ada.page.getByLabel("Password").fill(PASSWORD);
    await ada.page.getByRole("button", { name: "Create account" }).click();
    await expect(ada.page.getByRole("heading", { name: "Announcement thread live" })).toBeVisible();
    await ada.page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(ada.page).toHaveURL(launchUrl);

    await open(ada.page, adaLink2.replace(/^.*?\/invite\//, "/invite/"));
    await ada.page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(ada.page).toHaveURL(launchUrl);
    // A used link cannot be replayed.
    await open(ada.page, adaLink2.replace(/^.*?\/invite\//, "/invite/"));
    await expect(ada.page.getByRole("heading", { name: /already used|doesn't exist/ })).toBeVisible();
    await open(ada.page, launchUrl);

    await card(ada.page, "Partner AMA scheduled").getByRole("button", { name: "Confirm I'll deliver this" }).click();
    await expect(card(ada.page, "Partner AMA scheduled").getByText(/You confirmed on/)).toBeVisible();

    // Founder's room recalculates by itself (realtime/poll), with no manual edit.
    await expect(headline(founder.page)).toHaveText("NOT READY — 3 BLOCKERS", { timeout: 60_000 });

    // ── 5. Funding verified against the real chain; site check verified by the server ──────
    const fund = card(founder.page, "Campaign budget secured");
    await fund.getByLabel("Already sent a transfer?").fill(TX);
    await fund.getByRole("button", { name: "Verify transaction" }).click();
    await expect(fund.getByText("Verified on-chain. Readiness has been recalculated.")).toBeVisible({ timeout: 60_000 });
    await expect(fund.getByText("On-chain verified")).toBeVisible();
    await expect(fund.getByRole("link", { name: /0x1b9380/ })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${TX}`);
    await expect(headline(founder.page)).toHaveText("NOT READY — 2 BLOCKERS");

    // The same real transaction can never be credited twice — not even to a different requirement.
    // (Once a target is met the UI hides the hash form, so use a second, optional funding requirement.)
    await addRequirement(founder.page, { kind: "funding", title: "Stretch goal (optional)", recipient: RECIPIENT, amount: "5", optional: true });
    const stretch = card(founder.page, "Stretch goal (optional)");
    await stretch.getByLabel("Already sent a transfer?").fill(TX);
    await stretch.getByRole("button", { name: "Verify transaction" }).click();
    await expect(stretch.getByText(/already been recorded/)).toBeVisible();
    await expect(headline(founder.page)).toHaveText("NOT READY — 2 BLOCKERS"); // optional work never changes the verdict

    const site = card(founder.page, "Landing page is live");
    await site.getByLabel("Public URL to check").fill("https://example.com");
    await site.getByRole("button", { name: "Check site" }).click();
    await expect(site.getByText(/Verified: HTTP 200/)).toBeVisible({ timeout: 60_000 });
    await expect(headline(founder.page)).toHaveText("NOT READY — 1 BLOCKER");

    // ── 6. The deadline passes on its own: expired, blocked, recovery proposed ─────────────
    const blocker = founder.page.getByRole("listitem").filter({ has: founder.page.getByRole("heading", { name: "Announcement thread live" }) }).first();
    await expect(blocker.getByText("Expired", { exact: true })).toBeVisible({ timeout: 150_000 });
    await expect(blocker.getByText(/Activate backup Grace and set a new deadline/)).toBeVisible();
    await expect(founder.page.getByText(/Announcement thread live” missed its deadline/)).toBeVisible();

    // ── 7. Authorised recovery: activate the backup with a new deadline ────────────────────
    await blocker.getByRole("button", { name: /Activate Grace/ }).click();
    const graceBanner = founder.page.getByRole("status").filter({ hasText: "Invitation ready for Grace" });
    await expect(graceBanner).toBeVisible();
    const graceLink = (await graceBanner.locator("p.break-all").innerText()).trim();
    await expect(headline(founder.page)).toHaveText("NOT READY — 1 BLOCKER"); // un-expired, but not satisfied until Grace confirms

    // Ada's old commitment no longer counts and she has no way to act on it.
    await open(ada.page, launchUrl);
    await expect(card(ada.page, "Announcement thread live").getByRole("button", { name: "Confirm I'll deliver this" })).toHaveCount(0);

    // ── 8. Grace (second independent session) accepts and genuinely confirms ───────────────
    await open(grace.page, graceLink.replace(/^.*?\/invite\//, "/invite/"));
    await grace.page.getByLabel("Your name").fill(grace.name);
    await grace.page.getByLabel("Email").fill(grace.email);
    await grace.page.getByLabel("Password").fill(PASSWORD);
    await grace.page.getByRole("button", { name: "Create account" }).click();
    await grace.page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(grace.page).toHaveURL(launchUrl);
    await expect(headline(founder.page)).toHaveText("NOT READY — 1 BLOCKER"); // accepted ≠ confirmed
    await card(grace.page, "Announcement thread live").getByRole("button", { name: "Confirm I'll deliver this" }).click();
    await expect(card(grace.page, "Announcement thread live").getByText(/You confirmed on/)).toBeVisible();

    await expect(headline(founder.page)).toHaveText("READY TO LAUNCH", { timeout: 60_000 });

    // ── 9. Authorization: nobody else can see or change this launch ───────────────────────
    await signUp(mallory);
    await expect(mallory.page).toHaveURL(/\/app$/);
    for (const path of [`/app/launches/${launchId}`, `/app/launches/${launchId}/brief`, `/app/launches/${launchId}/settings`]) {
      const res = await mallory.page.goto(path);
      expect(res?.status(), `outsider opened ${path}`).toBe(404);
    }
    for (const path of [`/app/launches/${launchId}/settings`, `/app/launches/${launchId}/brief`]) {
      const res = await ada.page.goto(path);
      expect(res?.status(), `contributor opened founder-only ${path}`).toBe(404);
    }
    await open(ada.page, launchUrl);
    await expect(ada.page.getByRole("button", { name: "Proceed with launch" })).toHaveCount(0);
    await expect(ada.page.getByRole("button", { name: "Add requirement" })).toHaveCount(0);

    // ── 10. Founder decision, brief, public share link ────────────────────────────────────
    await open(founder.page, launchUrl);
    await founder.page.getByRole("button", { name: "Proceed with launch" }).click();
    await expect(founder.page.getByText("Founder: proceed")).toBeVisible();

    await open(founder.page, `/app/launches/${launchId}/brief`);
    const brief = founder.page.locator("article");
    await expect(brief.getByText("READY TO LAUNCH").first()).toBeVisible();
    await expect(brief.getByText("Proceed — cleared to launch")).toBeVisible();
    await expect(brief.getByText("Verified on-chain")).toBeVisible();
    await expect(brief.getByText("Submitted claim").first()).toBeVisible();
    await expect(brief.getByRole("link", { name: /0x1b9380/ })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${TX}`);

    await founder.page.getByRole("button", { name: "Create public link" }).click();
    const shareUrl = (await founder.page.locator("p.break-all").first().innerText()).trim();
    expect(shareUrl).toMatch(/\/brief\/br_[A-Za-z0-9_-]{30,}$/);

    const anon = await browser.newContext({ timezoneId: "UTC" });
    contexts.push(anon);
    const pub = await anon.newPage();
    await open(pub, shareUrl.replace(/^.*?\/brief\//, "/brief/"));
    await expect(pub.getByRole("heading", { level: 1, name: "Acme Token Launch" })).toBeVisible();
    await expect(pub.getByText("READY TO LAUNCH").first()).toBeVisible();
    expect(await pub.content()).not.toContain("@example.test"); // no contributor emails in a public brief

    await founder.page.getByRole("button", { name: "Revoke link" }).click();
    await expect(founder.page.getByRole("button", { name: "Create public link" })).toBeVisible();
    const revoked = await pub.goto(shareUrl.replace(/^.*?\/brief\//, "/brief/"));
    expect(revoked?.status()).toBe(404);

    // ── 11. Mobile: no horizontal overflow on the authenticated surfaces ──────────────────
    for (const [who, path] of [
      [founder, `/app/launches/${launchId}`],
      [founder, `/app/launches/${launchId}/brief`],
      [founder, "/app"],
      [ada, "/portal"],
      [ada, `/app/launches/${launchId}`],
    ] as Array<[Who, string]>) {
      for (const width of [320, 390]) {
        await who.page.setViewportSize({ width, height: 800 });
        await open(who.page, path);
        await noHorizontalScroll(who.page, `${who.name} ${path} @${width}`);
      }
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
