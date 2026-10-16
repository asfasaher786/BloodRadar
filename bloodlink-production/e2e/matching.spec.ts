import { test, expect } from "@playwright/test";
import { registerDonorViaUi, createSosViaUi, uniquePhone } from "./helpers";

// The core product loop across two real browsers: a donor registers, a
// patient raises an SOS, the donor accepts the contact request (which is
// what reveals the requester's real phone — first-accept-wins), and the
// requester closes the loop by marking it fulfilled.

test("contact request: accept reveals contact to both sides, then fulfilled", async ({ browser }) => {
  const donorPhone = uniquePhone();
  const requesterPhone = uniquePhone();

  // ── Donor browser: register first so the SOS finds them eligible.
  // Unique name: other specs also register "E2E Donor" donors, and the
  // requester's TopMatches list shows every matched donor's name.
  const donorContext = await browser.newContext();
  const donorPage = await donorContext.newPage();
  await donorPage.goto("/");
  const donor = await registerDonorViaUi(donorPage, {
    phone: donorPhone,
    name: `E2E Donor ${Date.now()}`,
    bloodGroup: "O-",
    city: "Islamabad",
  });

  // ── Requester browser: raise an O- SOS in Islamabad.
  const reqContext = await browser.newContext();
  const reqPage = await reqContext.newPage();
  await reqPage.goto("/");
  await createSosViaUi(reqPage, { phone: requesterPhone, bloodGroup: "O-" });

  // Contact requests are an explicit requester action (privacy-first: nothing
  // is broadcast until they choose to notify).
  await reqPage.getByRole("button", { name: "Notify Matching Donors" }).click();
  await expect(reqPage.getByText(/compatible donors notified/)).toBeVisible({ timeout: 10_000 });

  // ── Donor side: the inbox must show the open contact request (SSE or poll).
  const inbox = donorPage.locator("#donor-inbox-card");
  await expect(inbox).toBeVisible({ timeout: 15_000 });
  await expect(inbox.getByText("O-")).toBeVisible();

  // The requester's number is masked before acceptance.
  await expect(inbox.getByText(/••••/)).toBeVisible();

  // Accept: this is the moment the real numbers are exchanged (audit-logged).
  await inbox.getByRole("button", { name: "Accept & Share My Number" }).first().click();
  await expect(inbox.locator('a[href^="tel:"]').first()).toBeVisible({ timeout: 10_000 });
  const telHref = await inbox.locator('a[href^="tel:"]').first().getAttribute("href");
  expect(telHref).toContain(requesterPhone.replace(/^\+/, "").replace(/\s/g, ""));

  // ── Requester side: the panel reveals WHO accepted (name + group + tel link).
  const reqCard = reqPage.locator("#sos-request-form-card");
  // .first(): the accepted-donor banner renders above the ranked list, which
  // also shows this donor's name.
  await expect(reqCard.getByText(donor.name).first()).toBeVisible({ timeout: 15_000 });
  await expect(reqCard.getByText(`(${donor.bloodGroup})`)).toBeVisible();
  await expect(reqCard.locator('a[href^="tel:"]').first()).toBeVisible();

  // ── Close the loop: fulfilled. Both boards must reflect the state.
  await reqPage.getByRole("button", { name: "Mark as Fulfilled" }).first().click();
  await expect(reqPage.getByText("Marked fulfilled — thank you.")).toBeVisible({ timeout: 10_000 });

  // The donor's inbox no longer shows an open request for it.
  await expect(inbox.getByRole("button", { name: "Accept & Share My Number" })).toHaveCount(0, { timeout: 15_000 });

  await donorContext.close();
  await reqContext.close();
});
