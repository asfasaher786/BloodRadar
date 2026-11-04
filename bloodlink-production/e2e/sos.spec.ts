import { test, expect } from "@playwright/test";
import { createSosViaUi, completeSosVerification, jsClick, uniquePhone } from "./helpers";

// The SOS journey: anonymous 3-tap creation, the LIVE requester panel,
// the WhatsApp share link, honest no-match messaging, and closing the loop.

test.describe("SOS flow", () => {
  test("creates an SOS, shows the requester panel, and offers a WhatsApp share link", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
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
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await createSosViaUi(page, { bloodGroup: "O+", phone: uniquePhone() });

    await page.getByRole("button", { name: "Mark as Fulfilled" }).first().click();
    await expect(page.getByText("Marked fulfilled — thank you.")).toBeVisible({ timeout: 10_000 });
  });

  test("tells the truth when no compatible donors exist (B- Rawalpindi)", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#input-sos-phone").fill(uniquePhone());
    await page.locator('[id="chip-blood-B-"]').click();
    await page.locator("#chip-city-rawalpindi").click();
    await completeSosVerification(page);

    // Honest no-match copy, plus the WhatsApp fallback link stays available.
    // The success state and the live requester panel repeat the same line —
    // assert the success copy (first in DOM order).
    await expect(page.getByText(/No compatible donors in the registry right now/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('a[href^="https://wa.me/"]').first()).toBeVisible();
  });

  test("verifies the requester's phone before broadcasting (P0-1)", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const phone = uniquePhone();
    const card = page.locator("#sos-request-form-card");

    // This test asserts the PROOF-TOKEN state machine, not geometry — the
    // clicks below go through jsClick because the live-alert bar can insert
    // content mid-click and scroll-anchoring then moves the button under a
    // coordinate click (missed silently in firefox; see helpers.ts). Real
    // coordinate clicks stay covered by viewports + click-matrix specs.
    await page.locator("#input-sos-phone").fill(phone);
    await jsClick(page.locator("#btn-submit-sos-request"));

    // The verify stage replaces the form and names the phone — the SOS is
    // NOT broadcast yet.
    await expect(card.locator("#sos-verify-stage")).toBeVisible();
    await expect(card.getByText(phone, { exact: true })).toBeVisible();
    await expect(card.getByText("Request sent")).toHaveCount(0);

    // Change number → back to the form, nothing was posted.
    await jsClick(card.getByRole("button", { name: "Change number" }));
    await expect(card.locator("#sos-verify-stage")).toHaveCount(0);
    await expect(card.locator("#input-sos-phone")).toBeVisible();
    await expect(card.getByText("Request sent")).toHaveCount(0);

    // Resubmit: the same number reuses the code already sent (no fresh
    // request — the 60s cooldown would block an immediate resend).
    await jsClick(card.getByRole("button", { name: "Send request" }));
    const hint = card.locator("text=/Test mode — your code(?: is|:)?\\s+(\\d{6})/");
    await expect(hint).toBeVisible({ timeout: 10_000 });
    const code = (await hint.textContent())?.match(/(\d{6})/)?.[1];
    if (!code) throw new Error("Could not read SOS dev OTP from hint");

    // Resend within the 60s per-phone cooldown → honest wait message; the
    // original code (still live for 5 minutes) verifies fine afterwards.
    await jsClick(card.getByRole("button", { name: "Resend code" }));
    await expect(card.getByText(/Please wait \d+s/)).toBeVisible({ timeout: 10_000 });

    await card.locator("#input-sos-otp").fill(code);
    // The button is gated on a full 6-digit code — assert it is ENABLED
    // before the DOM click, or a silent no-op would hide a real bug.
    const verifyBtn = card.getByRole("button", { name: "Verify & send request" });
    await expect(verifyBtn).toBeEnabled();
    await jsClick(verifyBtn);
    await expect(card.getByText(/compatible donors (matched|notified)/)).toBeVisible({ timeout: 15_000 });

    // Proof is cached: raising another SOS for the same phone within the
    // 15-minute window skips the code step entirely.
    await jsClick(card.getByRole("button", { name: "Cancel SOS" }));
    await expect(card.getByText("Request cancelled. You can raise a new SOS below.")).toBeVisible({ timeout: 10_000 });
    await jsClick(card.getByRole("button", { name: "New request" }));
    await card.locator("#input-sos-phone").fill(phone);
    await card.locator('[id="chip-blood-O-"]').click();
    await jsClick(card.getByRole("button", { name: "Send request" }));
    await expect(card.locator("#sos-verify-stage")).toHaveCount(0);
    await expect(card.getByText(/compatible donors (matched|notified)/)).toBeVisible({ timeout: 15_000 });
  });
});
