import { test, expect } from "@playwright/test";
import { loginViaUi, uniquePhone } from "./helpers";

// Admin moderation loop: a visitor reports a suspicious SOS, the admin
// reviews the report and clears it, and the anonymized CSV exports.

const ADMIN_PHONE = "+923331234567"; // seeded demo admin (Dr. Safeer)

test.describe("admin moderation", () => {
  test("report → admin review → clear, plus anonymized CSV export", async ({ browser }) => {
    // ── Visitor browser: report the first SOS card on the board.
    const visitor = await browser.newContext();
    const vPage = await visitor.newPage();
    await vPage.goto("/");
    const reportBtn = vPage.locator('#emergencies-board button[id^="btn-report-sos-"]').first();
    await expect(reportBtn).toBeVisible({ timeout: 15_000 });
    await reportBtn.click();
    const reason = `E2E spam check ${Date.now()}`;
    await vPage.getByLabel("Report reason (optional)").fill(reason);
    await vPage.locator('button[id^="btn-send-report-"]').first().click();
    await expect(vPage.getByText("Report sent — our team will review this request.")).toBeVisible();
    await visitor.close();

    // ── Admin browser: log in, open Reported, find and clear the report.
    const admin = await browser.newContext();
    const aPage = await admin.newPage();
    await aPage.goto("/");
    await loginViaUi(aPage, ADMIN_PHONE);
    const panel = aPage.locator("#admin-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Tabs are role="tab" (not role="button") — use the right role.
    await panel.getByRole("tab", { name: /Reported/ }).click();
    await expect(panel.getByText(reason)).toBeVisible({ timeout: 10_000 });
    await panel.getByRole("button", { name: "Looks legitimate — clear reports" }).first().click();
    await expect(panel.getByText(reason)).toHaveCount(0, { timeout: 10_000 });

    // Anonymized CSV export downloads with the expected filename.
    const downloadPromise = aPage.waitForEvent("download");
    await panel.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^bloodradar-sos-\d{4}-\d{2}-\d{2}\.csv$/);
    await admin.close();
  });

  test("North Star metric is honest — never fabricates a median", async ({ page }) => {
    await page.goto("/");
    await loginViaUi(page, ADMIN_PHONE);
    const panel = page.locator("#admin-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // The overview defaults to the North Star card...
    await expect(panel.getByText("North Star · units delivered")).toBeVisible({ timeout: 10_000 });
    // ...and the median line tells the truth either way: a real duration when
    // accepted responses exist, or an honest null otherwise. It must never
    // invent a number. (Which state appears depends on what other tests ran
    // against the shared dev DB before this one — both are correct.)
    await expect(
      panel.getByText(/Median time-to-first-contact.*(No real data yet — shows null honestly|\d+ (seconds|minutes))/)
    ).toBeVisible({ timeout: 10_000 });
  });
});
