import { getEligibleDonorsForPatient } from "../lib/bloodCompatibility";
import { haversineKm } from "../lib/geo";

// Transparent donor ranking (Phase 3): a plain, explainable rule-based
// score — NO machine learning, no hidden weights. Every point is returned
// with a human-readable reason so the "why this donor" tooltip is just the
// score's own explanation. Max possible score is 100.

export interface DonorResponseStats {
  accepted: number;
  declined: number;
  expired: number;
  superseded: number;
}

export interface RankedMatch {
  donor: any;
  score: number; // 0–100
  reasons: string[]; // one line per scored factor
}

function daysUntil(dateIso: string | undefined | null): number | null {
  if (!dateIso) return null;
  const t = new Date(dateIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

export function scoreDonorForSos(
  donor: any,
  sos: any,
  hospital: any | null,
  stats: DonorResponseStats
): RankedMatch {
  const reasons: string[] = [];
  let score = 0;
  const patientGroup = sos.bloodGroup || "O-";

  // 1. Blood compatibility — the medical constraint (up to +40).
  const eligible = getEligibleDonorsForPatient(patientGroup);
  if (!eligible.includes(donor.bloodGroup)) {
    return { donor, score: 0, reasons: [`${donor.bloodGroup} cannot donate to ${patientGroup} — excluded`] };
  }
  if (donor.bloodGroup === "O-") {
    score += 40;
    reasons.push("Universal O- donor (+40)");
  } else if (donor.bloodGroup === patientGroup) {
    score += 35;
    reasons.push(`Exact ${donor.bloodGroup} match (+35)`);
  } else {
    score += 25;
    reasons.push(`${donor.bloodGroup} is compatible with ${patientGroup} (+25)`);
  }

  // 2. Distance from the request (up to +20). P2-4: when the requester
  // picked a neighbourhood, the SOS carries that centroid; otherwise we use
  // the hospital's location. Straight-line km when both sides have
  // coordinates; falls back to a city comparison honestly.
  const refLat = sos.latitude != null ? sos.latitude : hospital?.latitude ?? null;
  const refLon = sos.latitude != null ? sos.longitude : hospital?.longitude ?? null;
  const km = refLat != null && refLon != null
    ? haversineKm(donor.latitude, donor.longitude, refLat, refLon)
    : null;
  if (km !== null) {
    if (km <= 5) { score += 20; reasons.push(`${km.toFixed(1)} km from the request (+20)`); }
    else if (km <= 15) { score += 15; reasons.push(`${km.toFixed(1)} km from the request (+15)`); }
    else if (km <= 30) { score += 10; reasons.push(`${km.toFixed(1)} km from the request (+10)`); }
    else { score += 5; reasons.push(`${km.toFixed(1)} km from the request (+5)`); }
  } else {
    const sameCity = (donor.city || "").toLowerCase() === (sos.city || "").toLowerCase();
    score += sameCity ? 20 : 10;
    reasons.push(sameCity ? `Same city — ${sos.city || "unknown"} (+20)` : "Different city (+10)");
  }

  // 3. Availability (+15). Offline donors are not matched at all.
  if (donor.isAvailable) {
    score += 15;
    reasons.push("Available now (+15)");
  } else {
    reasons.push("Marked unavailable (0)");
  }

  // 4. Donation eligibility — the 90-day rule (+15).
  const days = daysUntil(donor.nextEligibleDate);
  if (days === null || days <= 0) {
    score += 15;
    reasons.push("Eligible to donate now (+15)");
  } else if (days <= 7) {
    score += 5;
    reasons.push(`Eligible again in ${days} day${days === 1 ? "" : "s"} (+5)`);
  } else {
    reasons.push(`Not yet eligible — next donation from ${donor.nextEligibleDate} (0)`);
  }

  // 5. Past response rate — accepted / decided requests (up to +10).
  const decided = stats.accepted + stats.declined + stats.expired;
  if (decided === 0) {
    reasons.push("No response history yet (0)");
  } else {
    const rate = stats.accepted / decided;
    const pts = rate >= 0.8 ? 10 : rate >= 0.5 ? 7 : rate >= 0.2 ? 4 : 2;
    score += pts;
    reasons.push(`Responded to ${stats.accepted} of ${decided} requests (${Math.round(rate * 100)}%) (+${pts})`);
  }

  return { donor, score, reasons };
}

export function rankDonorsForSos(
  donors: any[],
  sos: any,
  hospital: any | null,
  statsByPhone: Record<string, DonorResponseStats>
): RankedMatch[] {
  return donors
    .filter(d => d.isAvailable)
    .map(d => scoreDonorForSos(d, sos, hospital, statsByPhone[d.phone] || { accepted: 0, declined: 0, expired: 0, superseded: 0 }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
