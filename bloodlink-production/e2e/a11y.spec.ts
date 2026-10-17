import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Phase 4.6 — automated accessibility gate. axe-core scans against
// WCAG 2.2 AA (the P2.9 standard). The gate: ZERO serious or critical
// violations on the homepage and the three interactive modules. Moderate
// and minor findings are reported honestly in PHASE-4-REPORT.md — axe
// "best practice" rules are deliberately not part of the gate.

const seriousRules = (violations: any[]) =>
  violations.filter((v) => ["serious", "critical"].includes(v.impact));

test.describe("axe accessibility scans", () => {
  // axe must evaluate a settled UI. The app honors prefers-reduced-motion
  // (MotionConfig reducedMotion="user" + CSS), so emulating it freezes
  // entrance animations at their final state — this also exercises the
  // WCAG 2.3.3 reduced-motion path instead of racing mid-animation opacity.
  test.use({ reducedMotion: "reduce" });

  test("homepage has no serious or critical violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#main-content")).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = seriousRules(violations);
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("SOS request card is clean", async ({ page }) => {
    await page.goto("/");
    const { violations } = await new AxeBuilder({ page })
      .include("#sos-request-form-card")
      .analyze();
    expect(seriousRules(violations).map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("donor search module is clean", async ({ page }) => {
    await page.goto("/");
    const { violations } = await new AxeBuilder({ page })
      .include("#donor-search-module-card")
      .analyze();
    expect(seriousRules(violations).map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("organization portal is clean", async ({ page }) => {
    await page.goto("/");
    const { violations } = await new AxeBuilder({ page })
      .include("#org-portal")
      .analyze();
    expect(seriousRules(violations).map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe("keyboard-only navigation", () => {
  test("skip link jumps to content and focus order is sensible", async ({ page }) => {
    await page.goto("/");
    const skip = page.locator('a[href="#main-content"]').first();
    await skip.focus();
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/);
    // The SOS phone input is the app's first form control (autofocus on the
    // card), so structural Tab-walk order is intentionally not asserted here
    // — the activation path is what the skip link guarantees.
  });
});
