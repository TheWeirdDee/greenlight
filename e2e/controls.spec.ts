import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { open } from "./helpers";

/**
 * "Does every control actually work?" — written from the product requirements and a manual audit of the
 * rendered UI, independent of the happy-path workflow spec. Failure paths and recovery are the point.
 */
const RUN = Date.now().toString(36);
const PASSWORD = "correct-horse-battery";
const headline = (p: Page) => p.locator("h2[aria-live=polite]");
const card = (p: Page, title: string): Locator => p.getByRole("article").filter({ has: p.getByRole("heading", { name: title }) });

async function session(browser: Browser, name: string) {
  const context = await browser.newContext({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  return { context, page, name, email: `${name.toLowerCase()}.${RUN}@example.test` };
}

async function signUp(s: Awaited<ReturnType<typeof session>>, url = "/login?mode=signup") {
  await open(s.page, url);
  await s.page.getByLabel("Your name").fill(s.name);
  await s.page.getByLabel("Email").fill(s.email);
  await s.page.getByLabel("Password").fill(PASSWORD);
  await s.page.getByRole("button", { name: "Create account" }).click();
}

async function addReq(page: Page, f: { kind?: string; title: string; deadline?: string }) {
  const toggle = page.getByRole("button", { name: "Add requirement", exact: true, expanded: false });
  if (await toggle.count()) await toggle.click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add requirement", exact: true }) });
  if (f.kind) await form.getByLabel("Type").selectOption(f.kind);
  await form.getByLabel("Title").fill(f.title);
  if (f.deadline) await form.getByLabel("Deadline").fill(f.deadline);
  await form.getByRole("button", { name: "Add requirement" }).click();
  await expect(card(page, f.title)).toBeVisible();
}

async function invite(page: Page, title: string, label: string) {
  // A banner from an earlier invitation may still be on screen; dismiss it so we never read a stale link.
  const stale = page.getByRole("status").filter({ hasText: "Invitation ready for" });
  if (await stale.count()) await stale.first().getByRole("button", { name: "Dismiss" }).click();
  const c = card(page, title);
  await c.getByLabel("Invite a contributor").fill(label);
  await c.getByRole("button", { name: "Create invitation" }).click();
  const banner = page.getByRole("status").filter({ hasText: `Invitation ready for ${label}` });
  await expect(banner).toBeVisible();
  return (await banner.locator("p.break-all").innerText()).trim().replace(/^.*?\/invite\//, "/invite/");
}

test("every founder and contributor control works, including failure and recovery paths", async ({ browser }) => {
  const founder = await session(browser, "Fran");
  const ada = await session(browser, "Ada");
  const grace = await session(browser, "Grace");
  const all = [founder, ada, grace];
  try {
    // ── Account: sign out, wrong password, sign in, session persistence ─────────────────────
    await test.step("account controls", async () => {
      await signUp(founder);
      await founder.page.getByLabel("Workspace name").fill("Controls Inc");
      await founder.page.getByRole("button", { name: "Create workspace" }).click();
      await founder.page.getByRole("link", { name: "Create your first launch" }).click();
      await founder.page.getByLabel("Launch name").fill("Controls launch");
      await founder.page.getByRole("button", { name: "Create launch room" }).click();
      await expect(founder.page).toHaveURL(/\/app\/launches\/[0-9a-f-]{36}$/);

      // session survives a reload and a second tab
      await founder.page.reload();
      await expect(founder.page.getByRole("heading", { name: "Controls launch", level: 1 })).toBeVisible();
      const tab2 = await founder.context.newPage();
      await tab2.goto("/app");
      await expect(tab2.getByRole("heading", { name: "Are you ready?" })).toBeVisible();
      await tab2.close();

      // sign out → protected pages redirect → wrong password is refused → right password works
      await founder.page.locator("summary").filter({ hasText: "Account menu" }).click();
      await founder.page.getByRole("button", { name: "Sign out" }).click();
      await expect(founder.page).toHaveURL(/\/$/);
      await founder.page.goto("/app");
      await expect(founder.page).toHaveURL(/\/login\?next=/);
      await open(founder.page, "/login");
      await founder.page.getByLabel("Email").fill(founder.email);
      await founder.page.getByLabel("Password").fill("totally-wrong-password");
      await founder.page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(founder.page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
      // a failed attempt must not wipe what the user typed (regression: React resets forms after actions)
      await expect(founder.page.getByLabel("Email")).toHaveValue(founder.email);
      await founder.page.getByLabel("Password").fill(PASSWORD);
      await founder.page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(founder.page).toHaveURL(/\/app$/);
      // the dashboard lists the launch with its live verdict, and it opens
      await expect(founder.page.getByText("NOT READY — NO REQUIREMENTS DEFINED")).toBeVisible();
      await founder.page.getByRole("link", { name: /Controls launch/ }).click();
      await expect(founder.page).toHaveURL(/\/app\/launches\//);
    });
    const launchUrl = founder.page.url();

    // ── Launch editing ──────────────────────────────────────────────────────────────────────
    await test.step("edit launch", async () => {
      await founder.page.getByRole("link", { name: "Edit launch" }).click();
      await founder.page.getByLabel("Launch name").fill("Controls launch v2");
      await founder.page.getByRole("button", { name: "Save changes" }).click();
      await expect(founder.page.getByRole("heading", { name: "Controls launch v2", level: 1 })).toBeVisible();
    });

    // ── Quick-start presets, requirement edit/remove, dependencies ──────────────────────────
    await test.step("requirements: presets, edit, dependencies, removal", async () => {
      await founder.page.getByRole("button", { name: "+ Announcement is scheduled" }).click();
      await expect(founder.page.locator("form").getByLabel("Title")).toHaveValue("Announcement is scheduled");
      await founder.page.locator("form").getByRole("button", { name: "Add requirement", exact: true }).click();
      await expect(card(founder.page, "Announcement is scheduled")).toBeVisible();

      await addReq(founder.page, { kind: "deliverable", title: "Press kit" });
      await addReq(founder.page, { title: "Disposable requirement" });

      // edit: rename + make Press kit depend on the announcement
      const kit = card(founder.page, "Press kit");
      await kit.locator("summary", { hasText: "Edit requirement" }).click();
      await kit.getByLabel("Title").fill("Press kit (final)");
      await kit.getByLabel("Announcement is scheduled").check();
      await kit.getByRole("button", { name: "Save changes" }).click();
      await expect(card(founder.page, "Press kit (final)").getByRole("term").filter({ hasText: "Depends on" })).toBeVisible();

      // remove
      const dead = card(founder.page, "Disposable requirement");
      await dead.locator("summary", { hasText: "Edit requirement" }).click();
      await dead.getByRole("button", { name: "Remove" }).click();
      await expect(card(founder.page, "Disposable requirement")).toHaveCount(0);
      await expect(headline(founder.page)).toHaveText("NOT READY — 2 BLOCKERS");
    });

    // ── Decline → blocked with the reason → authorised replacement ──────────────────────────
    let adaLink = "";
    await test.step("contributor declines; founder replaces; replacement confirms", async () => {
      adaLink = await invite(founder.page, "Announcement is scheduled", "Grace (first choice)");
      await signUp(grace, adaLink);
      await grace.page.getByRole("button", { name: "Decline", exact: true }).click();
      await grace.page.getByLabel("Reason (optional)").fill("On holiday until after launch");
      await grace.page.getByRole("button", { name: "Decline invitation" }).click();
      await expect(grace.page).toHaveURL(/\/portal$/);

      const blockers = founder.page.locator("#blockers");
      await expect(blockers.getByText("On holiday until after launch")).toBeVisible({ timeout: 60_000 });
      await expect(blockers.getByText("Blocked", { exact: true }).first()).toBeVisible();
      await blockers.getByLabel("Replacement contributor").fill("Ada");
      await blockers.getByRole("button", { name: "Replace & invite" }).click();
      const banner = founder.page.getByRole("status").filter({ hasText: "Invitation ready for Ada" });
      await expect(banner).toBeVisible();
      adaLink = (await banner.locator("p.break-all").innerText()).trim().replace(/^.*?\/invite\//, "/invite/");

      await signUp(ada, adaLink);
      await ada.page.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(ada.page).toHaveURL(launchUrl);
    });

    // ── Portal confirm; dependency gating; deliverable evidence incl. hostile link ──────────
    await test.step("portal confirm and evidence", async () => {
      await open(ada.page, "/portal");
      await expect(ada.page.getByText("Accepted — please confirm")).toBeVisible();
      await ada.page.getByRole("button", { name: "Confirm commitment" }).click();
      await expect(ada.page.getByText("Confirmed", { exact: true })).toBeVisible();

      // the press kit depends on the announcement (now satisfied) but still needs an owner
      const adaLink2 = await invite(founder.page, "Press kit (final)", "Ada");
      await open(ada.page, adaLink2);
      await ada.page.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(ada.page).toHaveURL(launchUrl);
      const kit = card(ada.page, "Press kit (final)");
      await kit.getByRole("button", { name: "Confirm I'll deliver this" }).click();
      await expect(kit.getByText(/You confirmed on/)).toBeVisible();

      await kit.getByLabel("Evidence link").fill("javascript:alert(document.cookie)");
      await kit.getByRole("button", { name: "Submit evidence" }).click();
      await expect(kit.getByRole("alert").filter({ hasText: "Only http" })).toBeVisible();

      await kit.getByLabel("Evidence link").fill("https://example.com/press-kit");
      await kit.getByRole("button", { name: "Submit evidence" }).click();
      await expect(kit.getByRole("link", { name: "https://example.com/press-kit" })).toBeVisible();
      await expect(kit.getByText("Unchecked claim")).toBeVisible();
      await expect(headline(founder.page)).toHaveText("READY TO LAUNCH", { timeout: 60_000 });
    });

    // ── Withdrawal re-blocks; re-issue and release controls ─────────────────────────────────
    await test.step("withdraw re-blocks READY; recovery via replace", async () => {
      await open(ada.page, launchUrl);
      const kit = card(ada.page, "Press kit (final)");
      await kit.getByRole("button", { name: "No longer available?" }).click();
      await kit.getByLabel("What happened?").fill("Family emergency");
      await kit.getByRole("button", { name: /Step down from/ }).click();
      await expect(headline(founder.page)).toHaveText("NOT READY — 1 BLOCKER", { timeout: 60_000 });
      await expect(founder.page.locator("#blockers").getByText(/Family emergency/)).toBeVisible();

      // the founder re-issues nothing for a declined owner, but can release them outright
      const fk = card(founder.page, "Press kit (final)");
      await fk.getByRole("button", { name: "Release" }).click();
      await expect(fk.getByText("Nobody assigned yet.")).toBeVisible();
      // an unclaimed invitation can be re-issued, and the old link then stops working
      const first = await invite(founder.page, "Press kit (final)", "Someone new");
      await fk.getByRole("button", { name: "New link" }).click();
      const banner = founder.page.getByRole("status").filter({ hasText: "Invitation ready for Someone new" });
      await expect.poll(async () => (await banner.locator("p.break-all").innerText()).trim().replace(/^.*?\/invite\//, "/invite/")).not.toBe(first);
      await open(grace.page, first);
      await expect(grace.page.getByRole("heading", { name: /already used|doesn't exist/ })).toBeVisible();
    });

    // ── Decision controls: hold, recorded override, frozen room, revert ─────────────────────
    await test.step("decision: hold, override with reason, freeze, revert", async () => {
      await open(founder.page, launchUrl);
      await founder.page.getByRole("button", { name: "Put launch on hold" }).click();
      await expect(founder.page.getByText("On hold")).toBeVisible();

      await founder.page.locator("summary", { hasText: "Proceed anyway" }).click();
      const go = founder.page.getByRole("button", { name: "Proceed anyway", exact: true });
      await expect(go).toBeDisabled(); // needs an acknowledgement and a reason
      await founder.page.getByLabel("Why proceed despite open blockers?").fill("Partner confirmed by phone");
      await founder.page.getByLabel(/I understand this launch is/).check();
      await go.click();
      await expect(founder.page.getByText("Founder: proceed (override)")).toBeVisible();
      await expect(headline(founder.page)).toHaveText(/NOT READY/); // the override never changes the verdict
      await expect(founder.page.getByRole("button", { name: "Add requirement" })).toHaveCount(0); // frozen
      await open(founder.page, `${launchUrl}/brief`);
      await expect(founder.page.getByText("Proceed despite open blockers (override)")).toBeVisible();
      await expect(founder.page.getByText("Partner confirmed by phone")).toBeVisible();

      await open(founder.page, launchUrl);
      await founder.page.getByRole("button", { name: "Revert to hold" }).click();
      await expect(founder.page.getByRole("button", { name: "Add requirement" })).toBeVisible();
    });
  } finally {
    await Promise.all(all.map((s) => s.context.close()));
  }
});

test("mobile navigation opens, navigates, closes on Escape, and exposes sign-in", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await open(page, "/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeHidden(); // the desktop actions are not crammed into the header
  const menu = page.getByRole("button", { name: "Open menu" });
  await menu.click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open a launch room" }).last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/#how$/);
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible(); // menu closed after navigating
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await ctx.close();
});
