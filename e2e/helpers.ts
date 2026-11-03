import { expect, type Page } from "@playwright/test";

/** Navigates and waits for React to hydrate, so the first click is never swallowed. */
export async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
}
