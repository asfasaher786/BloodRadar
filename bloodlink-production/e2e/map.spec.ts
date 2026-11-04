import { test, expect } from "@playwright/test";

// Map interactions: the Leaflet map renders with real markers, the city
// switch re-centers it, and locate-me is present with honest status text.

test.describe("map", () => {
  test("renders the map and re-centers it on the city switch", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Leaflet adds its container class to the SAME div that carries the id —
    // so the two classes must be matched on one element, not as descendants.
    // 60s: the map is a lazy chunk — under a full-gate dev-mode load in
    // webkit, Vite's on-demand transform of the chunk + its dep graph has
    // taken >20s (observed 2026-11-05; the module fetched fine at 8s, the
    // Suspense fallback stayed up while the dep graph resolved). The same
    // wait in click-matrix already uses 60s for this reason.
    await expect(page.locator("#leaflet-live-map-container.leaflet-container")).toBeVisible({ timeout: 60_000 });

    // Islamabad → Rawalpindi: the map pane transform must change (the two
    // city centers are ~13 km apart, so the pan is observable in the DOM).
    const transform = () =>
      page.evaluate(() => {
        const pane = document.querySelector("#leaflet-live-map-container .leaflet-map-pane") as HTMLElement | null;
        return pane ? pane.style.transform : null;
      });

    await page.waitForFunction(
      () => {
        const pane = document.querySelector("#leaflet-live-map-container .leaflet-map-pane") as HTMLElement | null;
        return !!(pane && pane.style.transform);
      },
      { timeout: 20_000 }
    );
    const before = await transform();

    await page.locator("#btn-zoom-rawalpindi").click();
    await expect
      .poll(async () => (await transform()) !== before, { timeout: 10_000 })
      .toBe(true);
  });

  test("locate-me reports its real state instead of pretending", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const btn = page.locator("#btn-locate-me");
    // Same lazy-chunk reality as above: in the full gate (2026-11-05) the
    // Suspense fallback was still up after 20s in webkit while the module
    // itself had fetched fine at t=8s — the dep-graph transform stalled.
    await expect(btn).toBeVisible({ timeout: 60_000 });
    await btn.click();
    // Honest reporting, whatever the browser does: headless Chromium/WebKit
    // deny geolocation outright (denied/error copy), while headless Firefox's
    // geolocation API stalls without ever firing a callback — the app must
    // keep saying it is searching rather than inventing a fix.
    await expect(
      page.getByText(/Location access denied|Couldn't get your location|Finding your location…/)
    ).toBeVisible({ timeout: 10_000 });
    // And it must NEVER claim a position it did not actually get.
    await expect(page.getByText(/map is centered on your location/)).toHaveCount(0);
  });
});
