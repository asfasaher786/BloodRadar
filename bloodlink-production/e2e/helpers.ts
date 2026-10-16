import { Page, expect } from "@playwright/test";

// Shared E2E helpers. The dev server's console SMS provider echoes the OTP
// into the response and the UI shows it as "Test mode — your code: XXXXXX"
// (a field that must never exist in production). Tests parse that hint
// instead of calling the API, so they exercise the real UI paths.

let counter = 0;

/** Unique phone per call so repeated runs never collide in the shared dev DB. */
export function uniquePhone(): string {
  counter += 1;
  return `+9232${String(2000000 + counter)}${String(Date.now()).slice(-4)}`;
}

/** Extracts the 6-digit code from the dev-mode hint text.
 *  Two wordings exist: register stepper "your code: 123456",
 *  org portal "your code is 123456". */
export async function readDevOtp(page: Page): Promise<string> {
  const hint = page.locator('text=/Test mode — your code(?: is|:)?\\s+(\\d{6})/');
  await expect(hint).toBeVisible({ timeout: 10_000 });
  const text = await hint.textContent();
  const match = text?.match(/(\d{6})/);
  if (!match) throw new Error(`Could not read dev OTP from hint: ${text}`);
  return match[1];
}

/**
 * Full donor registration through the UI: register tab → stepper → OTP.
 * Assumes the DonorSearch register tab is reachable from the page.
 */
export async function registerDonorViaUi(
  page: Page,
  opts: { phone?: string; name?: string; bloodGroup?: string; city?: string } = {}
) {
  const phone = opts.phone || uniquePhone();
  const name = opts.name || "E2E Donor";
  const bloodGroup = opts.bloodGroup || "O-";
  const city = opts.city || "Islamabad";

  await page.locator("#btn-donor-tab-register").click();
  // Scope to the register card: the OrgPortal login form on the same page
  // also has "Send verification code" (and "Continue"-less, but scoping
  // everything keeps strict mode deterministic).
  const reg = page.locator("#donor-search-module-card");
  await reg.locator("#reg-name").fill(name);
  await reg.locator("#reg-phone").fill(phone);
  // Attribute selector: group ids contain "+" (e.g. chip-reg-blood-O+),
  // which CSS id selectors mis-parse as combinators.
  await reg.locator(`[id="chip-reg-blood-${bloodGroup}"]`).click();
  await reg.locator(`[id="chip-reg-city-${city.toLowerCase()}"]`).click();
  await reg.locator("#reg-location").fill("G-10/4");
  await reg.getByRole("button", { name: "Continue" }).click();
  await reg.locator("#reg-age-confirm").check();
  await reg.locator("#reg-health-confirm").check();
  // Stepper: details → eligibility → consent → verify. Each Continue advances.
  await reg.getByRole("button", { name: "Continue" }).click();
  await reg.locator("#reg-consent").check();
  await reg.getByRole("button", { name: "Continue" }).click();
  await reg.getByRole("button", { name: "Send verification code" }).click();
  const code = await readDevOtp(page);
  await reg.getByLabel("6-digit verification code").fill(code);
  await reg.getByRole("button", { name: "Verify & Create" }).click();
  await expect(page.locator("#donor-streak-gamification-card")).toBeVisible({ timeout: 15_000 });
  return { phone, name, bloodGroup, city };
}

/**
 * Logs an existing phone in through the OrgPortal OTP login (the generic
 * phone-OTP door used by donors, org staff and admins alike).
 */
export async function loginViaUi(page: Page, phone: string) {
  const portal = page.locator("#org-portal");
  await portal.getByLabel("Phone number").fill(phone);
  await portal.getByRole("button", { name: "Send verification code" }).click();
  const code = await readDevOtp(page);
  await portal.getByLabel("Verification code").fill(code);
  await portal.getByRole("button", { name: "Verify & continue" }).click();
}

/**
 * Fills and submits the SOS form (only the phone is required) and waits
 * for the LIVE requester panel with the matching-donor count.
 */
export async function createSosViaUi(
  page: Page,
  opts: { phone?: string; bloodGroup?: string } = {}
) {
  const phone = opts.phone || uniquePhone();
  const bloodGroup = opts.bloodGroup || "O-";
  await page.locator("#input-sos-phone").fill(phone);
  await page.locator(`[id="chip-blood-${bloodGroup}"]`).click();
  await page.locator("#btn-submit-sos-request").click();
  await expect(
    page.locator("#sos-request-form-card").getByText(/compatible donors (matched|notified)/)
  ).toBeVisible({ timeout: 15_000 });
  return { phone };
}
