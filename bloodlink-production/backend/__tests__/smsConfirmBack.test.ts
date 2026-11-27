import { describe, it, expect } from "vitest";
import {
  MAX_CONFIRM_LENGTH,
  smsConfirmBackSchema,
  confirmSosReceived,
  confirmDuplicateRequest,
  confirmUnparseable,
  confirmProcessingFailed,
} from "../lib/smsConfirmBack";

// P3b-2: the confirmation the platform texts back to an inbound SMS sender
// must fit a single SMS segment, be plain text (no markdown), and pass the
// strict outbound schema. Deterministic templates — gateways, tests, and
// operators rely on their exact shape.

const ALL_CONFIRMATIONS = [
  confirmSosReceived("O+", 3),
  confirmSosReceived("AB-", 0),
  confirmDuplicateRequest("B+"),
  confirmUnparseable(),
  confirmProcessingFailed(),
];

describe("SMS confirm-back strict schema (P3b-2)", () => {
  it("every confirmation fits a single SMS segment (<= 160 chars)", () => {
    for (const text of ALL_CONFIRMATIONS) {
      expect(text.length).toBeLessThanOrEqual(MAX_CONFIRM_LENGTH);
    }
  });

  it("confirmations are plain text — no markdown or formatting characters", () => {
    for (const text of ALL_CONFIRMATIONS) {
      expect(text).not.toMatch(/[*_#`[\]]/);
    }
  });

  it("every confirmation passes the strict outbound schema", () => {
    for (const text of ALL_CONFIRMATIONS) {
      const parsed = smsConfirmBackSchema.safeParse({ to: "+923001112233", text });
      expect(parsed.success).toBe(true);
    }
  });

  it("mentions the blood group so the sender knows which request was parsed", () => {
    expect(confirmSosReceived("O+", 3)).toContain("O+");
    expect(confirmDuplicateRequest("B+")).toContain("B+");
  });

  it("distinguishes matched from zero-match outcomes", () => {
    expect(confirmSosReceived("O+", 2)).toContain("have been alerted");
    expect(confirmSosReceived("O+", 0)).toContain("call the hospital directly");
  });

  it("tells the sender the retry format when no group could be read", () => {
    expect(confirmUnparseable()).toContain("O+ ISLAMABAD");
  });

  it("rejects texts that violate the schema (over-length, formatting chars)", () => {
    expect(smsConfirmBackSchema.safeParse({ to: "+923001112233", text: "" }).success).toBe(false);
    expect(smsConfirmBackSchema.safeParse({ to: "+923001112233", text: "x".repeat(161) }).success).toBe(false);
    expect(smsConfirmBackSchema.safeParse({ to: "12", text: "hello" }).success).toBe(false);
  });
});
