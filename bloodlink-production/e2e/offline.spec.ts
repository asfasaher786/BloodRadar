import { test, expect } from "@playwright/test";

// The offline safety net: when the network drops, the app must tell the
// user to call the hospital directly instead of silently showing a stale
// board.

test.describe("offline safety net", () => {
  test("shows the call-directly banner offline and hides it when back online", async ({ page, context }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // domcontentloaded fires while the app is still mounting. The offline
    // banner depends on the window online/offline listeners React attaches —
    // flipping the network before the app mounts means the event is silently
    // missed (observed in the full gate: banner never appeared). The SOS
    // card only exists once the app is mounted, so wait for it first.
    await expect(page.locator("#sos-request-form-card")).toBeVisible();
    await expect(page.getByText(/You're offline/)).toBeHidden();

    await context.setOffline(true);
    const banner = page.getByText(/You're offline — the map and live updates won't refresh/);
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner.getByText(/call the hospital directly/i)).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/You're offline/)).toBeHidden({ timeout: 10_000 });
  });
});
