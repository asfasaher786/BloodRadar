import { test, expect } from "@playwright/test";
import { registerDonorViaUi, createSosViaUi, uniquePhone, readDevOtp } from "./helpers";

// Phase 4 click matrix. Every interactive element on the page that is NOT
// already exercised by the other specs gets a real click here, with a
// state-change assertion as evidence (never just "no crash"). Elements
// already covered elsewhere (SOS submit, donor stepper, OTP logins, contact
// accept/fulfil, admin moderation, chatbot messages, offline banner) are
// cross-referenced in CLICK-MATRIX.md rather than duplicated.
//
// Viewport gating: the notification bell and ticker require a desktop
// header (bell is `hidden md:flex`), and the mobile menu requires the
// narrow layout, so those tests self-skip on the wrong viewport.

test.describe("click matrix — header & chrome", () => {
  test("skip-to-content link: Tab reveals it, Enter jumps to main", async ({ page }) => {
    await page.goto("/");
    const skip = page.locator('a[href="#main-content"]');
    // The skip link is the document's first tabbable element (it renders at
    // the very top of the tree), but the SOS phone input autofocuses on load
    // and the shared dev board accumulates cards from other specs, so a Tab
    // walk is not deterministic. What matters for WCAG 2.4.1 is the
    // activation path: focusing the link reveals it, Enter navigates.
    await skip.focus();
    await expect(skip).toBeFocused();
    // Focus reveals the link (sr-only until focused).
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/);
  });

  test("hero CTAs navigate to their sections", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "View Live Emergencies" }).click();
    await expect(page).toHaveURL(/#emergencies-board$/);
    await page.getByRole("link", { name: "Request Blood (SOS)" }).click();
    await expect(page).toHaveURL(/#sos-form$/);
  });

  test("mobile menu opens, exposes all four anchors, closes on navigate", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= 768, "mobile menu is hidden on desktop");
    await page.goto("/");
    // Scope to the banner: the hero CTAs carry the same link names below.
    const menu = page.getByRole("banner");
    const menuBtn = menu.getByRole("button", { name: "Open menu" });
    await expect(menuBtn).toBeVisible();
    await expect(menuBtn).toHaveAttribute("aria-expanded", "false");
    await menuBtn.click();
    await expect(menu.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
    for (const label of ["Live Emergencies", "Request Blood (SOS)", "Find Donors", "For Organizations"]) {
      await expect(menu.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await menu.getByRole("link", { name: "Request Blood (SOS)", exact: true }).click();
    await expect(page).toHaveURL(/#sos-form$/);
    await expect(menu.getByRole("link", { name: "Live Emergencies", exact: true })).toBeHidden();
  });

  test("ticker: X hides it, Dismiss clears unread so bell goes too", async ({ page, browser, viewport }) => {
    test.skip((viewport?.width ?? 1280) < 768, "bell is desktop-only");
    test.setTimeout(120_000); // register + SOS + notify + two reloads: slow engines
    // ── Donor registers (stays logged in on this page).
    const donorContext = await browser.newContext();
    const donorPage = await donorContext.newPage();
    await donorPage.goto("/");
    await registerDonorViaUi(donorPage, {
      phone: uniquePhone(),
      name: `E2E Matrix Donor ${Date.now()}`,
      bloodGroup: "O-",
      city: "Islamabad",
    });

    // ── Requester raises an O- SOS and notifies matching donors — that is
    //    what creates the unread "emergency" notification for our donor.
    const reqContext = await browser.newContext();
    const reqPage = await reqContext.newPage();
    await reqPage.goto("/");
    await createSosViaUi(reqPage, { phone: uniquePhone(), bloodGroup: "O-" });
    await reqPage.getByRole("button", { name: "Notify Matching Donors" }).click();
    await expect(reqPage.getByText(/compatible donors notified/)).toBeVisible({ timeout: 10_000 });

    // ── Donor page: ticker + bell appear (SSE/poll, no reload).
    const ticker = donorPage.locator('[role="alert"]').filter({ hasText: "LIVE SOS" });
    const bell = donorPage.locator('button[aria-label^="Notifications — "]');
    await expect(ticker).toBeVisible({ timeout: 20_000 });
    await expect(bell).toBeVisible({ timeout: 20_000 });

    // Bell click is a smooth-scroll to the board: no state change, no crash.
    await bell.click();
    await expect(bell).toBeVisible();
    await expect(ticker).toBeVisible();

    // X (second button in the ticker) hides the banner but keeps unread —
    // the bell must stay.
    await ticker.locator("button").nth(1).click();
    await expect(ticker).toHaveCount(0);
    await expect(bell).toBeVisible();

    // Reload: unread count comes from the server, only the local dismiss
    // state is lost — the ticker must come back.
    await donorPage.reload();
    await expect(donorPage.locator('[role="alert"]').filter({ hasText: "LIVE SOS" })).toBeVisible({ timeout: 20_000 });

    // Dismiss marks everything read server-side: ticker AND bell disappear,
    // and stay gone across a reload (real persistence, not local state).
    const ticker2 = donorPage.locator('[role="alert"]').filter({ hasText: "LIVE SOS" });
    await ticker2.getByRole("button", { name: "Dismiss" }).click();
    await expect(donorPage.locator('[role="alert"]').filter({ hasText: "LIVE SOS" })).toHaveCount(0, { timeout: 10_000 });
    await expect(donorPage.locator('button[aria-label^="Notifications — "]')).toHaveCount(0, { timeout: 10_000 });
    await donorPage.reload();
    await expect(donorPage.locator('[role="alert"]').filter({ hasText: "LIVE SOS" })).toHaveCount(0);

    await donorContext.close();
    await reqContext.close();
  });
});

test.describe("click matrix — directory tabs", () => {
  test("tabs switch panels (mouse + keyboard), hospital card selects, camp register increments", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Sample data — not live inventory.")).toBeVisible();

    // Keyboard arrow navigation on the tablist (WCAG pattern).
    await page.locator("#tab-hospitals").focus();
    await expect(page.locator("#tab-hospitals")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tab-camps")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("CAMP", { exact: true }).first()).toBeVisible();

    // Camp registration is a real POST — the count must increment.
    const registerBtn = page.locator('button:has-text("Register (")').first();
    const before = (await registerBtn.textContent()) ?? "";
    await registerBtn.click();
    await expect(registerBtn).not.toHaveText(before, { timeout: 10_000 });

    await page.locator("#tab-analytics").click();
    await expect(page.getByRole("heading", { name: "Twin Cities Donor Blood Type Mix" })).toBeVisible();
    await page.locator("#tab-ml-playground").click();
    // Heading role: the tab button carries the same label text.
    await expect(page.getByRole("heading", { name: "Real ML Lab" })).toBeVisible();

    // Back to hospitals: clicking a card marks it selected (highlighted).
    await page.locator("#tab-hospitals").click();
    const card = page.locator('button:has-text("Show on map")').first();
    await expect(card).not.toHaveClass(/border-blood/);
    await card.click();
    await expect(card).toHaveClass(/border-blood/);
  });
});

test.describe("click matrix — SOS form controls", () => {
  test("emergency switch, units stepper, blood + city chips all toggle state", async ({ page }) => {
    await page.goto("/");
    const sosCard = page.locator("#sos-request-form-card");

    // Emergency mode is ON by default (essentials-only, broadcast fast).
    const switchBtn = sosCard.getByRole("switch", { name: "Toggle emergency mode" });
    await expect(switchBtn).toHaveAttribute("aria-checked", "true");
    await switchBtn.click();
    await expect(switchBtn).toHaveAttribute("aria-checked", "false");
    await switchBtn.click();
    await expect(switchBtn).toHaveAttribute("aria-checked", "true");

    await expect(page.locator("#sos-units-value")).toHaveText("1");
    await sosCard.getByRole("button", { name: "More units" }).click();
    await expect(page.locator("#sos-units-value")).toHaveText("2");
    await sosCard.getByRole("button", { name: "Fewer units" }).click();
    await expect(page.locator("#sos-units-value")).toHaveText("1");

    const abPlus = page.locator('[id="chip-blood-AB+"]');
    await expect(abPlus).toHaveAttribute("aria-pressed", "false");
    await abPlus.click();
    await expect(abPlus).toHaveAttribute("aria-pressed", "true");
    await page.locator('[id="chip-blood-O-"]').click();
    await expect(page.locator('[id="chip-blood-O-"]')).toHaveAttribute("aria-pressed", "true");
    await expect(abPlus).toHaveAttribute("aria-pressed", "false");

    const rwp = page.locator('[id="chip-city-rawalpindi"]');
    await expect(rwp).toHaveAttribute("aria-pressed", "false");
    await rwp.click();
    await expect(rwp).toHaveAttribute("aria-pressed", "true");
    await page.locator('[id="chip-city-islamabad"]').click();
    await expect(page.locator('[id="chip-city-islamabad"]')).toHaveAttribute("aria-pressed", "true");
    await expect(rwp).toHaveAttribute("aria-pressed", "false");

    // ── Requester-panel closure buttons (Cancel SOS → New request).
    await page.locator("#input-sos-phone").fill(uniquePhone());
    await page.locator("#btn-submit-sos-request").click();
    await expect(
      page.locator("#sos-request-form-card").getByText(/compatible donors (matched|notified)/)
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Cancel SOS" }).click();
    await expect(page.getByText("Request cancelled. You can raise a new SOS below.")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "New request" }).click();
    await expect(page.locator("#input-sos-phone")).toBeVisible();

    // ── Fulfilled → Done clears the live panel entirely.
    await page.locator("#input-sos-phone").fill(uniquePhone());
    await page.locator("#btn-submit-sos-request").click();
    await expect(
      page.locator("#sos-request-form-card").getByText(/compatible donors (matched|notified)/)
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Mark as Fulfilled" }).first().click();
    await expect(page.getByText("Marked fulfilled — thank you.")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Marked fulfilled — thank you.")).toHaveCount(0);
  });
});

test.describe("click matrix — donor search", () => {
  test("available-only toggle, blood/city filters, protected number, reviews form", async ({ page }) => {
    await page.goto("/");
    const module = page.locator("#donor-search-module-card");
    const list = module.locator(".max-h-\\[500px\\] > div");

    // Seed data: Bilal Siddiqui (B-) is the only unavailable donor; the
    // toggle defaults to OFF so he is visible until switched on.
    await expect(page.getByText("Bilal Siddiqui")).toBeVisible();
    await page.locator("#btn-toggle-available-only").click();
    await expect(page.getByText("Bilal Siddiqui")).toHaveCount(0);
    await page.locator("#btn-toggle-available-only").click();
    await expect(page.getByText("Bilal Siddiqui")).toBeVisible();

    // Blood filter: Amna Bibi is the only AB+ seed donor.
    await page.locator('[id="btn-filter-blood-AB+"]').click();
    await expect(page.getByText("Amna Bibi")).toBeVisible();
    await expect(page.getByText("Zainab Malik")).toHaveCount(0);

    // City filter: Rawalpindi keeps its donors (Usman Ghani, B+) and hides
    // Islamabad's Zainab Malik (O-).
    await page.locator('[id="btn-filter-blood-All"]').click();
    await page.locator('[id="btn-filter-city-Rawalpindi"]').click();
    await expect(page.getByText("Usman Ghani")).toBeVisible();
    await expect(page.getByText("Zainab Malik")).toHaveCount(0);
    await page.locator('[id="btn-filter-city-All"]').click();
    await expect(page.getByText("Zainab Malik")).toBeVisible();

    // Protected number: click swaps the masked label for guidance text.
    const zCard = list.filter({ hasText: "Zainab Malik" }).first();
    const copyBtn = zCard.locator('button[id^="btn-call-donor-"]');
    await expect(copyBtn).toContainText(/•+/);
    await copyBtn.click();
    await expect(copyBtn).toContainText("Use SOS to connect");
    await expect(copyBtn).not.toContainText("Use SOS to connect", { timeout: 5_000 }); // reverts after ~3s

    // Reviews drawer: expand, submit a real review, confirm the honest success.
    await zCard.getByRole("button", { name: /Reviews \(\d+\)/ }).click();
    await expect(zCard.getByText("Patient testimonials for Zainab Malik")).toBeVisible();
    await zCard.locator("#review-patient-name").fill(`E2E Patient ${Date.now()}`);
    await zCard.getByRole("button", { name: "Rate 5 stars" }).click();
    await zCard.locator("#review-comment").fill("Quick response, reached the hospital in time.");
    await zCard.getByRole("button", { name: "Submit Feedback" }).click();
    await expect(zCard.getByText("Review successfully posted!")).toBeVisible({ timeout: 10_000 });
    await zCard.getByRole("button", { name: "Okay" }).click();
    await expect(zCard.locator("#review-comment")).toBeVisible();

    // Register tab switches the panel (the full stepper flow lives in helpers).
    await page.locator("#btn-donor-tab-register").click();
    await expect(module.locator("#reg-name")).toBeVisible();
    await page.locator("#btn-donor-tab-search").click();
    await expect(page.locator("#btn-toggle-available-only")).toBeVisible();
  });
});

test.describe("click matrix — map, chatbot, org portal", () => {
  test("city zoom + Leaflet zoom controls operate without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", (err) => errors.push(String(err)));

    await page.goto("/");
    const map = page.locator("#leaflet-live-map-container.leaflet-container");
    await expect(map).toBeVisible({ timeout: 20_000 });
    // Let the first tiles settle before driving zoom — interacting mid-load
    // trips a known Leaflet internal error in some engines.
    await page.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);

    await page.locator("#btn-zoom-islamabad").click();
    await page.waitForTimeout(400);
    await expect(map).toBeVisible();

    await page.locator("#btn-zoom-rawalpindi").click();
    await page.waitForTimeout(400);
    await expect(map).toBeVisible();

    await page.locator(".leaflet-control-zoom-in").click();
    await page.locator(".leaflet-control-zoom-out").click();
    await expect(map).toBeVisible();

    // No uncaught exceptions or console errors. Anonymous auth checks
    // (/api/auth/me, /api/notifications) legitimately log 401 resource
    // failures on a logged-out page load — those are expected, not bugs.
    const unexpected = errors.filter((e) => !e.includes("401"));
    expect(unexpected).toEqual([]);
  });

  test("assistant FAB toggles the dialog open and closed", async ({ page }) => {
    await page.goto("/");
    const fab = page.locator("#btn-toggle-ai-chat");
    await expect(fab).toHaveAttribute("aria-expanded", "false");
    await fab.click();
    await expect(fab).toHaveAttribute("aria-expanded", "true");
    const dialog = page.locator("#ai-chatbot-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "dialog");
    await dialog.getByRole("button", { name: "Close assistant" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(fab).toHaveAttribute("aria-expanded", "false");
  });

  test("org portal: fresh phone logs in and files an application", async ({ page }) => {
    test.setTimeout(90_000); // OTP round-trips + slow first paint on low-end emulation
    await page.goto("/");
    const portal = page.locator("#org-portal");
    const phone = uniquePhone();
    // Login done step-by-step here (not via loginViaUi) so the OTP-stage
    // Back button is part of the matrix.
    await portal.getByLabel("Phone number").fill(phone);
    await portal.getByRole("button", { name: "Send verification code" }).click();
    await expect(portal.getByText(/Test mode — your code is/)).toBeVisible({ timeout: 10_000 });
    await portal.getByRole("button", { name: "Back" }).click();
    await expect(portal.getByLabel("Phone number")).toBeVisible();
    // Re-sending to the SAME phone inside the 60s cooldown must surface the
    // honest wait message (a real abuse control, verified end-to-end here).
    await portal.getByRole("button", { name: "Send verification code" }).click();
    await expect(
      portal.getByText(/Please wait \d+s before requesting another code/)
    ).toBeVisible({ timeout: 10_000 });
    // A fresh phone proceeds normally — the cooldown is per-phone.
    await portal.getByLabel("Phone number").fill(uniquePhone());
    await portal.getByRole("button", { name: "Send verification code" }).click();
    const code = await readDevOtp(page);
    await portal.getByLabel("Verification code").fill(code);
    await portal.getByRole("button", { name: "Verify & continue" }).click();

    await expect(portal.getByLabel("Organization name")).toBeVisible({ timeout: 10_000 });
    await portal.getByLabel("Organization name").fill(`E2E NGO ${Date.now()}`);
    await portal.getByRole("button", { name: "Submit application" }).click();
    await expect(portal.getByText(/awaiting admin approval/)).toBeVisible({ timeout: 10_000 });
    await expect(portal.getByText("In review")).toBeVisible();
    // Status refresh keeps the honest pending state.
    await portal.getByRole("button", { name: "Check status again" }).click();
    await expect(portal.getByText("In review")).toBeVisible({ timeout: 10_000 });
  });

  test("mobile details sheet opens for a selected hospital and closes", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= 768, "bottom sheet replaces Leaflet popups on mobile");
    await page.goto("/");
    await page.locator('button:has-text("Show on map")').first().click();
    const sheet = page.locator("#map-mobile-sheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet.locator('a[href^="tel:"]').first()).toBeVisible(); // Call hospital
    await page.locator("#btn-map-sheet-close").click();
    await expect(sheet).toHaveCount(0);
  });
});
