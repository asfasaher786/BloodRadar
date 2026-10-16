import { test, expect } from "@playwright/test";
import { registerDonorViaUi, loginViaUi, uniquePhone } from "./helpers";

// The donor lifecycle: register → verified badge → log donation (with the
// 90-day rejection on repeat) → availability toggle → login from scratch.

test.describe("donor lifecycle", () => {
  test("registers a donor through the full stepper with OTP", async ({ page }) => {
    await page.goto("/");
    const donor = await registerDonorViaUi(page, { bloodGroup: "O+", city: "Rawalpindi" });

    // The streak/gamification card is the logged-in donor's home.
    const card = page.locator("#donor-streak-gamification-card");
    await expect(card).toBeVisible();
    await expect(card.getByText(donor.name)).toBeVisible();
  });

  test("logs a donation, then rejects an immediate repeat with the 90-day rule", async ({ page }) => {
    await page.goto("/");
    await registerDonorViaUi(page, { bloodGroup: "O+", city: "Rawalpindi" });

    await page.locator("#btn-log-donation").click();
    await expect(page.getByText("Recorded — thank you for saving lives.")).toBeVisible();

    // The 90-day eligibility rule: a second donation today must be refused.
    await page.locator("#btn-log-donation").click();
    await expect(page.locator("#donor-streak-gamification-card").getByText(/donate again|not eligible/i)).toBeVisible({ timeout: 10_000 });
  });

  test("toggles availability between AVAILABLE and OFFLINE", async ({ page }) => {
    await page.goto("/");
    await registerDonorViaUi(page, { bloodGroup: "O+", city: "Rawalpindi" });

    const toggle = page.locator("#btn-toggle-availability-streak");
    await expect(toggle).toContainText("AVAILABLE"); // new donors default to available
    await toggle.click();
    await expect(toggle).toContainText("OFFLINE");
    await toggle.click();
    await expect(toggle).toContainText("AVAILABLE");
  });

  test("a registered donor can log in again from a fresh browser", async ({ browser }) => {
    const phone = uniquePhone();

    // First browser: register.
    const regContext = await browser.newContext();
    const regPage = await regContext.newPage();
    await regPage.goto("/");
    await registerDonorViaUi(regPage, { phone, bloodGroup: "A+", city: "Islamabad" });
    await regContext.close();

    // Second browser: log in with the same phone via the org-portal OTP door.
    const loginContext = await browser.newContext();
    const loginPage = await loginContext.newPage();
    await loginPage.goto("/");
    await loginViaUi(loginPage, phone);
    await expect(loginPage.locator("#donor-streak-gamification-card")).toBeVisible({ timeout: 15_000 });
    await loginContext.close();
  });
});
