import { CONFIG } from "../config/config";
import { logger } from "../lib/logger";
import { getDonors, addNotification, updateDonorField } from "../services/dbService";

// Donation eligibility reminders. The 90-day rule is enforced at
// log-donation time; this job nudges donors who are eligible again.
// Opt-outs are respected — a donor with notificationsOptOut never hears
// from this job. Disabled by default; enable with ENABLE_DONATION_REMINDERS
// (and in production that means running one instance, see ops notes).

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function runReminderCheck(): Promise<void> {
  try {
    const donors = await getDonors();
    const today = new Date().toISOString().split("T")[0];
    let remindersSent = 0;

    for (const donor of donors) {
      if (donor.notificationsOptOut) continue;
      if (!donor.nextEligibleDate) continue;
      if (donor.nextEligibleDate > today) continue; // not eligible yet
      if (donor.lastReminderAt && donor.lastReminderAt >= donor.nextEligibleDate) continue; // already reminded for this window

      await addNotification({
        id: "notif-" + Date.now() + "-" + remindersSent,
        title: "You can donate again",
        message: `Hi ${donor.name}, your recovery window is complete and you're eligible to donate blood again. Your next donation could save up to 3 lives.`,
        type: "reminder",
        timestamp: new Date().toISOString(),
        read: false,
      });
      await updateDonorField(donor.phone, { lastReminderAt: today });
      remindersSent++;
    }

    if (remindersSent > 0) {
      logger.info({ remindersSent }, "Eligibility reminders sent");
    }
  } catch (err) {
    logger.error({ err }, "Reminder check failed");
  }
}

export function startReminderJob(): void {
  if (!CONFIG.ENABLE_DONATION_REMINDERS) {
    logger.info("Donation reminder job disabled (set ENABLE_DONATION_REMINDERS=true to enable)");
    return;
  }
  logger.info("Donation reminder job enabled — checking daily");
  runReminderCheck(); // once at boot
  setInterval(runReminderCheck, CHECK_INTERVAL_MS);
}
