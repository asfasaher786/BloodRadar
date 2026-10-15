import { describe, it, expect } from "vitest";
import { normalizePhone, maskPhone } from "../lib/phoneUtils";

// Phone normalization is the foundation of identity: the same donor must be
// recognized whether they typed "+92 300 5551234", "0300 5551234" or a bare
// local number. It is also what makes the platform internationally
// configurable (COUNTRY_CODE env) without code edits.
describe("normalizePhone", () => {
  it("keeps international numbers with a leading + as-is", () => {
    expect(normalizePhone("+92 300 5551234")).toBe("+923005551234");
    expect(normalizePhone("+923005551234")).toBe("+923005551234");
  });

  it("never overwrites a real foreign country code", () => {
    expect(normalizePhone("+1 415 555 2671")).toBe("+14155552671");
    expect(normalizePhone("+971501234567")).toBe("+971501234567");
  });

  it("maps local trunk-prefixed numbers to the configured country code", () => {
    expect(normalizePhone("0300 5551234")).toBe("+923005551234");
    expect(normalizePhone("03005551234")).toBe("+923005551234");
  });

  it("maps bare 10-digit numbers to the configured country code", () => {
    expect(normalizePhone("3005551234")).toBe("+923005551234");
  });

  it("maps numbers already containing the country code without a +", () => {
    expect(normalizePhone("923005551234")).toBe("+923005551234");
  });

  it("respects a different COUNTRY_CODE when configured", () => {
    const prev = process.env.COUNTRY_CODE;
    process.env.COUNTRY_CODE = "971";
    try {
      expect(normalizePhone("0501234567")).toBe("+971501234567");
    } finally {
      if (prev === undefined) delete process.env.COUNTRY_CODE;
      else process.env.COUNTRY_CODE = prev;
    }
  });

  it("returns unrecognizable input unchanged rather than guessing", () => {
    expect(normalizePhone("123")).toBe("123");
    expect(normalizePhone("")).toBe("");
  });
});

describe("maskPhone", () => {
  it("masks the middle of the number and keeps the last 3 digits", () => {
    expect(maskPhone("+923005551234")).toBe("+92 300 •••• 234");
  });

  it("never returns the original digits for a maskable number", () => {
    const masked = maskPhone("+923005551234");
    expect(masked).not.toContain("5551");
    expect(masked).not.toBe("+923005551234");
  });

  it("leaves too-short values alone", () => {
    expect(maskPhone("1122")).toBe("1122");
  });
});
