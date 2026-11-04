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
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await createSosViaUi(page, { bloodGroup: "O+", phone: uniquePhone() });

      const card = page.locator("#sos-request-form-card");
      // The card subtitle also mentions "compatible donors" — match the
      // success line's full phrase to stay unambiguous.
      await expect(card.getByText(/compatible donors matched nearby/)).toBeVisible();
      // The live requester panel repeats a compact "WhatsApp" link — target
      // the success CTA by its role name.
      await expect(card.getByRole("link", { name: "Share on WhatsApp" })).toBeVisible();
      // Wait for the live panel's settle marker (its footer line) before
      // measuring geometry: the entrance animations are still running right
      // after the success CTA appears.
      await expect(card.getByText(/We check every 15 seconds/)).toBeVisible();

      // No horizontal overflow once settled: the page must not scroll
      // sideways. Polled (not a single instant sample) because the full gate
      // caught one 672px reading that never reproduced in isolation, and a
      // probe traced the only repeatable overflow to the mid-boot mounting
      // state — a transient, not the settled success state. A bounded poll
      // still fails on anything persistent.
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth
            ),
          { timeout: 15_000 }
        )
        .toBeLessThanOrEqual(1);
    });
  });
}
