// P3a-6: keyword flagging for fake/test-looking SOS content. The signal is
// SOFT: it never blocks a request (a real emergency must never be suppressed
// by a heuristic), it only surfaces the SOS in the admin review queue so a
// human can look at it, alongside the one-tap phone block. Honest by design:
// the flags travel with the SOS but are stripped from every public payload,
// and an admin dismissing the entry clears them.

export interface SosFlagInput {
  patientName?: string;
  reason?: string;
  urgency?: string;
  city?: string;
  neighbourhood?: string;
}

// Test/demo keywords. Word-boundary matched so "latest", "protest" or a
// patient actually named "Amber Testoni" are not falsely flagged.
const KEYWORD_PATTERN = /\b(test|testing|tested|tester|testers|demo|dummy|sample|fake|faked|spam|junk|asdf|qwerty|lorem|ipsum|placeholder|trial)\b/i;

// Gibberish signals: 5+ identical characters in a row ("aaaaa", "xxxxx"),
// a field that is ONLY a keyboard run ("asdfasdf", "1234abcd", "qwerty"),
// or a patient "name" made purely of digits.
const REPEATED_CHARS = /(.)\1{4,}/;
const KEYBOARD_MASH = /^(?:asdf|qwer|zxcv|uiop|hjkl|1234|abcd|0987|7894|1122|qwerty)+$/i;
const NUMBERS_ONLY = /^\d+$/;

export function detectSuspiciousFlags(input: SosFlagInput): string[] {
  const reasons: string[] = [];
  const fields = [
    { label: "patient name", value: input.patientName || "" },
    { label: "reason", value: input.reason || "" },
    { label: "urgency", value: input.urgency || "" },
    { label: "city", value: input.city || "" },
    { label: "neighbourhood", value: input.neighbourhood || "" },
  ];

  for (const field of fields) {
    if (!field.value.trim()) continue;
    if (KEYWORD_PATTERN.test(field.value)) {
      reasons.push(`test-like keyword in ${field.label}`);
    }
    if (REPEATED_CHARS.test(field.value)) {
      reasons.push(`repeated characters in ${field.label}`);
    }
    if (KEYBOARD_MASH.test(field.value)) {
      reasons.push(`keyboard mash in ${field.label}`);
    }
    if (field.label === "patient name" && NUMBERS_ONLY.test(field.value.trim())) {
      reasons.push("numbers-only patient name");
    }
  }
  return reasons;
}

// P3b-8: production hard-blocks test-like NAMES on new records (donor
// registrations, patient names). Unlike the soft flags above, a name is a
// person's identity — nobody real is named "Test User" or "Asdf", and such
// rows only pollute the public registry ("Contact reveal test" class). The
// block is production-only so dev/test/E2E flows keep their shortcuts.
// Word-boundary matching keeps real names safe ("Amber Testoni" passes).
export function testNameBlockReason(name: string): string | null {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  if (KEYWORD_PATTERN.test(trimmed)) return "test-like keyword";
  if (KEYBOARD_MASH.test(trimmed)) return "keyboard-mash name";
  if (NUMBERS_ONLY.test(trimmed)) return "numbers-only name";
  return null;
}
