import { test, expect } from "@playwright/test";

// The offline safety net: when the network drops, the app must tell the
// user to call the hospital directly instead of silently showing a stale
// board.

test.describe("offline safety net", () => {
  test("shows the call-directly banner offline and hides it when back online", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.getByText(/You're offline/)).toBeHidden();

    await context.setOffline(true);
    const banner = page.getByText(/You're offline — the map and live updates won't refresh/);
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner.getByText(/call the hospital directly/i)).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/You're offline/)).toBeHidden({ timeout: 10_000 });
  });
});
