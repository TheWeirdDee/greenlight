import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { open } from "./helpers";

/**
 * Automated WCAG 2.x A/AA scan (axe-core) of the public surfaces in light and dark themes.
 * Automated checks catch a subset of issues; they do not replace manual keyboard/screen-reader review.
 */
const pages = [
  ["landing", "/"],
  ["login", "/login"],
  ["signup", "/login?mode=signup"],
  ["invalid invite", "/invite/not-a-token"],
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const [name, path] of pages) {
    test(`axe: ${name} (${theme}) has no WCAG A/AA violations`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await open(page, path);
      await page.waitForTimeout(900); // let entrance animations settle so contrast is measured on final colours
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.nodes[0]?.target.join(" ")}`);
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }
}
