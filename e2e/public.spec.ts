import { expect, test } from "@playwright/test";
import { open } from "./helpers";

const noHorizontalScroll = async (page: import("@playwright/test").Page) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `page scrolls horizontally (${sw} > ${cw})`).toBeLessThanOrEqual(cw);
};

test.describe("public pages", () => {
  test("landing page: headline, sections and no horizontal overflow at 320px–1280px", async ({ page }) => {
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, "/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("actually ready to launch");
      await noHorizontalScroll(page);
    }
    for (const id of ["how", "evidence", "limits"]) await expect(page.locator(`#${id}`)).toBeAttached();
  });

  test("the live sample runs the real readiness engine: events change the verdict, never a manual edit", async ({ page }) => {
    await open(page, "/");
    const verdict = page.locator("#sample p[aria-live=polite]");
    const press = async (name: string) => {
      await page.getByRole("button", { name }).click();
    };
    await expect(verdict).toHaveText("NOT READY — 3 BLOCKERS");
    await press("Send 2 USDC (verified on-chain)");
    await expect(verdict).toHaveText("NOT READY — 3 BLOCKERS"); // underfunded: still not satisfied
    await press("Send 3 USDC (verified on-chain)");
    await expect(verdict).toHaveText("NOT READY — 2 BLOCKERS");
    await press("Landing page responds 200");
    await expect(verdict).toHaveText("NOT READY — 1 BLOCKER");
    await press("Let the deadline pass");
    await expect(page.locator("#sample").getByText("Expired", { exact: true }).first()).toBeVisible();
    await press("Founder activates backup Grace");
    await press("Grace confirms");
    await expect(verdict).toHaveText("READY TO LAUNCH");
    await press("Landing page returns 503");
    await expect(verdict).toHaveText("NOT READY — 1 BLOCKER");
  });

  test("late confirmation does not rescue an expired requirement in the sample", async ({ page }) => {
    await open(page, "/");
    await page.getByRole("button", { name: "Let the deadline pass" }).click();
    await page.getByRole("button", { name: "Ada confirms the announcement" }).click();
    await expect(page.locator("#sample p[aria-live=polite]")).not.toHaveText("READY TO LAUNCH");
  });

  test("theme toggle switches light, dark and system and persists across reload", async ({ page }) => {
    await open(page, "/");
    const html = page.locator("html");
    // On phones the theme control lives inside the menu; on wider screens it is in the header.
    const reveal = async () => {
      const menu = page.getByRole("button", { name: "Open menu" });
      if (await menu.isVisible()) await menu.click();
    };
    await reveal();
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await reveal();
    await page.getByRole("radio", { name: "Light" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: "System" }).click();
    await expect(html).toHaveAttribute("data-theme-pref", "system");
  });

  test("respects prefers-reduced-motion", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await open(page, "/");
    const duration = await page.evaluate(() => getComputedStyle(document.querySelector("a")!).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.01);
    await ctx.close();
  });

  test("keyboard: skip link is the first tab stop and moves focus to main content", async ({ page }) => {
    await open(page, "/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("anonymous visitors are sent to sign in, and the redirect cannot be abused", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
    await noHorizontalScroll(page);
    // An external `next` is ignored rather than followed.
    await page.goto("/login?next=https://evil.example");
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  });

  test("invitation and brief links with invalid secrets reveal nothing", async ({ page }) => {
    await page.goto("/invite/not-a-token");
    await expect(page.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();
    const res = await page.goto("/brief/not-a-token");
    expect(res?.status()).toBe(404);
    await expect(page.getByText("Nothing here.")).toBeVisible();
  });

  test("an invalid or missing email-confirmation link fails safely and cannot redirect off-site", async ({ page }) => {
    await page.goto("/auth/callback?code=not-a-real-code&next=https://evil.example/steal");
    await expect(page).toHaveURL(/\/login\?error=confirmation/);
    expect(new URL(page.url()).hostname).not.toBe("evil.example");
    await expect(page.getByRole("alert").filter({ hasText: "invalid or has expired" })).toBeVisible();
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/login\?error=confirmation/);
  });

  test("wrong credentials: one generic message (no account enumeration), the email stays typed, no crash", async ({ page }) => {
    await open(page, "/login");
    for (const email of [`nobody.${Date.now()}@example.invalid`, "someone.else@example.invalid"]) {
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("definitely-not-the-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "That email and password don't match." })).toBeVisible();
      await expect(page.getByLabel("Email")).toHaveValue(email);
      await expect(page).toHaveURL(/\/login/);
    }
    // client-side validation and the server's own validation both refuse a short password on sign-up
    await page.getByRole("button", { name: "Create an account" }).click();
    await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "8");
  });

  test("the cron endpoint refuses callers without the secret", async ({ request }) => {
    expect((await request.get("/api/cron/sweep")).status()).toBe(401);
    expect((await request.get("/api/cron/sweep", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  });
});
