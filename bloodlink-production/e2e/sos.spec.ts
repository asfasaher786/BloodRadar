import { test, expect } from "@playwright/test";
import { createSosViaUi, uniquePhone } from "./helpers";

// The SOS journey: anonymous 3-tap creation, the LIVE requester panel,
// the WhatsApp share link, honest no-match messaging, and closing the loop.

test.describe("SOS flow", () => {
  test("creates an SOS, shows the requester panel, and offers a WhatsApp share link", async ({ page }) => {
    await page.goto("/");
    await createSosViaUi(page, { bloodGroup: "O+", phone: uniquePhone() });

    // Requester panel: LIVE badge and the matching-donor line. The card
    // subtitle also mentions "compatible donors", so match the success
    // line's full phrase to keep the locator unambiguous.
    const card = page.locator("#sos-request-form-card");
    await expect(card.getByText("LIVE", { exact: true })).toBeVisible();
    await expect(card.getByText(/compatible donors matched nearby/)).toBeVisible();

    // WhatsApp share carries the urgent message text. The live requester
    // panel repeats a compact "WhatsApp" link, so target the success CTA.
    const share = card.getByRole("link", { name: "Share on WhatsApp" });
    await expect(share).toBeVisible();
    const href = await share.getAttribute("href");
    expect(href).toContain("URGENT");
    expect(href).toContain(encodeURIComponent("O+"));
  });

  test("marks the SOS fulfilled from the requester panel", async ({ page }) => {
    await page.goto("/");
    await createSosViaUi(page, { bloodGroup: "O+", phone: uniquePhone() });

    await page.getByRole("button", { name: "Mark as Fulfilled" }).first().click();
    await expect(page.getByText("Marked fulfilled — thank you.")).toBeVisible({ timeout: 10_000 });
  });

  test("tells the truth when no compatible donors exist (B- Rawalpindi)", async ({ page }) => {
    await page.goto("/");
    await page.locator("#input-sos-phone").fill(uniquePhone());
    await page.locator('[id="chip-blood-B-"]').click();
    await page.locator("#chip-city-rawalpindi").click();
    await page.locator("#btn-submit-sos-request").click();

    // Honest no-match copy, plus the WhatsApp fallback link stays available.
    // The success state and the live requester panel repeat the same line —
    // assert the success copy (first in DOM order).
    await expect(page.getByText(/No compatible donors in the registry right now/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('a[href^="https://wa.me/"]').first()).toBeVisible();
  });
});
