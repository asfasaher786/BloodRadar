import { test, expect } from "@playwright/test";
import { createSosViaUi, uniquePhone } from "./helpers";

// Viewport matrix (master prompt: 360 / 768 / 1280). The same SOS journey
// must work at every width — the form, panel and share link are the
// narrowest-column stress points.

for (const viewport of [
  { width: 360, height: 740, label: "360 (small phone)" },
  { width: 768, height: 1024, label: "768 (tablet)" },
  { width: 1280, height: 800, label: "1280 (desktop)" },
]) {
  test.describe(`viewport ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("SOS journey works end to end", async ({ page }) => {
      await page.goto("/");
      await createSosViaUi(page, { bloodGroup: "O+", phone: uniquePhone() });

      const card = page.locator("#sos-request-form-card");
      await expect(card.getByText(/compatible donors/)).toBeVisible();
      await expect(card.locator('a[href^="https://wa.me/"]')).toBeVisible();

      // No horizontal overflow: the page must not scroll sideways.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflows).toBeLessThanOrEqual(1);
    });
  });
}
