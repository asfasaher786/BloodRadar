import { test, expect } from "@playwright/test";

// The AI triage chatbot: honest status labeling (no Gemini key in dev →
// "Offline assistant"), rules-based answers labeled as such, and emergency
// phrasing that escalates to triage framing.

test.describe("chatbot triage", () => {
  test("labels itself honestly and answers with the rules-based badge", async ({ page }) => {
    await page.goto("/");
    await page.locator("#btn-toggle-ai-chat").click();

    // Dev has no Gemini key → the header must say so (never claim AI).
    await expect(page.locator("#ai-chatbot-dialog").getByText(/Offline assistant · rules-based/)).toBeVisible({ timeout: 10_000 });

    await page.locator("#input-ai-chat-message").fill("explain blood compatibility for A-");
    await page.locator("#btn-send-ai-chat-message").click();

    await expect(page.locator("#ai-chatbot-dialog").getByText("Rules-based answer · no AI connected")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#ai-chatbot-dialog").getByText(/Blood Compatibility Guide/)).toBeVisible();
  });

  test("emergency phrasing escalates to triage framing", async ({ page }) => {
    await page.goto("/");
    await page.locator("#btn-toggle-ai-chat").click();

    await page.locator("#input-ai-chat-message").fill("emergency help blood needed");
    await page.locator("#btn-send-ai-chat-message").click();

    await expect(page.locator("#ai-chatbot-dialog").getByText("High Urgent Triage Action Requested")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#ai-chatbot-dialog").getByText(/EMERGENCY ASSISTANCE TRIAGE/)).toBeVisible();
  });

  test("Escape closes the dialog", async ({ page }) => {
    await page.goto("/");
    await page.locator("#btn-toggle-ai-chat").click();
    await expect(page.locator("#ai-chatbot-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ai-chatbot-dialog")).toBeHidden();
  });
});
