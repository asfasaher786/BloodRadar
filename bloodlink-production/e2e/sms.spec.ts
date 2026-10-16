import { test, expect } from "@playwright/test";
import { uniquePhone } from "./helpers";

// API-level checks for the SMS webhook (the UI can't drive a real gateway,
// so the webhook contract is exercised directly against the live server).

test.describe("SMS webhook (API-level)", () => {
  test("accepts a Twilio-style payload and creates an SOS", async ({ request }) => {
    const res = await request.post("/api/sms/incoming", {
      // Unique sender per run: the duplicate-detection control (tested in the
      // unit suite) answers "already have your open request" for repeat
      // phone+group pairs, which would mask this parsing check.
      data: { From: uniquePhone(), Body: "NEED O+ BLOOD URGENT ISLAMABAD" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.reply).toContain("Request received");
  });

  test("accepts generic gateway field names (from/text)", async ({ request }) => {
    const res = await request.post("/api/sms/incoming", {
      data: { from: uniquePhone(), text: "o+ rawalpindi" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).reply).toContain("Request received");
  });

  test("answers honestly when no blood group can be read", async ({ request }) => {
    const res = await request.post("/api/sms/incoming", {
      data: { From: uniquePhone(), Body: "please help me urgently" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).reply).toContain("couldn't read your blood group");
  });

  test("rejects malformed payloads with 400", async ({ request }) => {
    const malformed = await request.post("/api/sms/incoming", {
      data: { From: { nested: "object" } },
    });
    expect(malformed.status()).toBe(400);

    const noSender = await request.post("/api/sms/incoming", { data: { Body: "O+ ISLAMABAD" } });
    expect(noSender.status()).toBe(400);
  });
});
