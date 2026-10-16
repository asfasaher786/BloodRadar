import { CONFIG } from "../config/config";
import { getEligibleDonorsForPatient } from "./bloodCompatibility";
import { getDonors, addTargetedNotification, getPushSubscriptionForPhone, removePushSubscription } from "../services/dbService";
import { getSmsProvider } from "./smsProvider";
import { maskPhone } from "./phoneUtils";
import { pushConfigured, sendWebPush } from "./pushService";

// Donor alerting (Phase 3.5). When a new SOS is created, donors who are
// verified, available, blood-compatible and in the same city are alerted
// through the channels they opted into — in-app, SMS, or web push — unless
// their quiet hours are active. "Immediate (SOS)" requests bypass quiet
// hours only for donors who explicitly opted into that bypass, because
// those are the life-critical minutes this product exists for.

export interface NotifyPrefs {
  appAlerts: boolean;
  smsAlerts: boolean;
  quietHoursEnabled: boolean;
  quietStart: string; // "HH:MM", 24h, in NOTIFICATION_TZ
  quietEnd: string;   // "HH:MM", 24h, in NOTIFICATION_TZ
  allowImmediateDuringQuiet: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  appAlerts: true,
  smsAlerts: false, // SMS costs money and needs a real provider — opt-in only
  quietHoursEnabled: true,
  quietStart: "22:00",
  quietEnd: "08:00",
  allowImmediateDuringQuiet: true,
};

export function validateNotifyPrefs(raw: any): NotifyPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const k of ["appAlerts", "smsAlerts", "quietHoursEnabled", "allowImmediateDuringQuiet"]) {
    if (typeof raw[k] !== "boolean") return null;
  }
  if (typeof raw.quietStart !== "string" || !timeRe.test(raw.quietStart)) return null;
  if (typeof raw.quietEnd !== "string" || !timeRe.test(raw.quietEnd)) return null;
  return {
    appAlerts: raw.appAlerts,
    smsAlerts: raw.smsAlerts,
    quietHoursEnabled: raw.quietHoursEnabled,
    quietStart: raw.quietStart,
    quietEnd: raw.quietEnd,
    allowImmediateDuringQuiet: raw.allowImmediateDuringQuiet,
  };
}

export function hourMinuteInTz(date: Date, tz: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
    return { hour: get("hour"), minute: get("minute") };
  } catch {
    // Unknown timezone in env: fall back to the server's local time rather
    // than failing SOS creation over a config typo.
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Pure quiet-hours test. Handles overnight windows (start > end). */
export function isWithinQuietHours(prefs: NotifyPrefs, hour: number, minute: number): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const now = hour * 60 + minute;
  const start = toMinutes(prefs.quietStart);
  const end = toMinutes(prefs.quietEnd);
  if (start === end) return false; // zero-length window means "off"
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // wraps midnight
}

export interface NotifyStats {
  matched: number;
  notifiedInApp: number;
  smsSent: number;
  pushSent: number;
  quietSuppressed: number;
}

export async function notifyMatchingDonors(sos: any, now: Date = new Date()): Promise<NotifyStats> {
  const stats: NotifyStats = { matched: 0, notifiedInApp: 0, smsSent: 0, pushSent: 0, quietSuppressed: 0 };
  try {
    const eligibleGroups = getEligibleDonorsForPatient(sos.bloodGroup);
    if (eligibleGroups.length === 0) return stats;
    const donors = await getDonors();
    const { hour, minute } = hourMinuteInTz(now, CONFIG.NOTIFICATION_TZ);
    const immediate = sos.urgency === "Immediate (SOS)";

    for (const donor of donors) {
      if (!donor.isVerified || !donor.isAvailable) continue;
      if (!eligibleGroups.includes(donor.bloodGroup)) continue;
      if (sos.city && donor.city && donor.city !== sos.city) continue;
      if (donor.phone === sos.contactPhone) continue; // the requester themself
      stats.matched++;

      const prefs: NotifyPrefs = { ...DEFAULT_NOTIFY_PREFS, ...(donor.notifyPrefs || {}) };
      if (isWithinQuietHours(prefs, hour, minute) && !(immediate && prefs.allowImmediateDuringQuiet)) {
        stats.quietSuppressed++;
        continue;
      }

      if (prefs.appAlerts) {
        await addTargetedNotification({
          id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          targetPhone: donor.phone,
          title: `New ${sos.bloodGroup} request${immediate ? " (SOS)" : ""}`,
          message: `${sos.unitsNeeded} unit${sos.unitsNeeded === 1 ? "" : "s"} of ${sos.bloodGroup} needed${sos.hospitalName ? ` at ${sos.hospitalName}` : ""}. Contact: ${maskPhone(sos.contactPhone)}. Open the SOS board to respond.`,
          type: "emergency",
          sosId: sos.id,
          read: false,
          timestamp: new Date().toISOString(),
        });
        stats.notifiedInApp++;
      }

      if (prefs.smsAlerts) {
        const ok = await getSmsProvider().sendSms(
          donor.phone,
          `BloodRadar: ${sos.unitsNeeded} unit${sos.unitsNeeded === 1 ? "" : "s"} of ${sos.bloodGroup} needed${sos.hospitalName ? ` at ${sos.hospitalName}` : ""} (${sos.city || "your city"}). Reply YES to accept, or open BloodRadar to respond.`
        );
        if (ok) stats.smsSent++;
      }

      if (pushConfigured()) {
        const sub = await getPushSubscriptionForPhone(donor.phone);
        if (sub) {
          const result = await sendWebPush(sub, {
            title: `BloodRadar: ${sos.bloodGroup} needed ${immediate ? "— SOS" : ""}`,
            body: `${sos.unitsNeeded} unit${sos.unitsNeeded === 1 ? "" : "s"} needed${sos.hospitalName ? ` at ${sos.hospitalName}` : ""} (${sos.city || "nearby"}). Open BloodRadar to respond.`,
            url: "/",
          });
          if (result.ok) stats.pushSent++;
          if (result.gone) await removePushSubscription(donor.phone);
        }
      }
    }
  } catch (err) {
    // Alerting must never break SOS creation — log and report honestly.
    console.error("[notify] matching-donor alert failed:", err);
  }
  return stats;
}
