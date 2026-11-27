import { ChevronRight, ShieldCheck } from "lucide-react";

// P3b-10: the live privacy policy, hash-routed at #privacy. Every claim on
// this page is backed by real behaviour in the code — retention windows
// (SOS purge, 90-day chat, 12-month audit), the Gemini phone stripping, the
// delete-my-data endpoint — nothing aspirational. Version 1.0, effective
// 27 November 2026.
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "Who this covers",
    body: [
      "BloodRadar is a community blood-donation platform for Islamabad and Rawalpindi, Pakistan. This policy explains what personal information we hold, why we hold it, how long we keep it, and how you can delete it.",
      "We are an early-stage community project. We do not sell personal data, we do not show advertisements, and we never share your details with anyone except the people you choose to exchange them with during a blood request.",
    ],
  },
  {
    title: "What we collect",
    body: [
      "Donors: your name, blood group, phone number, city and area, your availability, and a record of when you agreed to this policy (version and time). Your phone is verified with a one-time code before you appear in the registry.",
      "Requesters (SOS): the contact phone number, patient name, hospital, urgency and blood details you submit when raising a blood request. Requesters do not need an account.",
      "Visitors: the messages you type in the help assistant are stored against an anonymous, random session ID. We do not link them to your name or phone unless you type those details yourself.",
    ],
  },
  {
    title: "How it is used",
    body: [
      "Your information is used to match blood requests with compatible donors, to send you alerts about requests you could help with, and to let both sides reach each other — and only after both sides agree: a donor's full number is revealed to a requester only when the donor accepts the request, and the requester's number is shown to the donor at that same moment.",
      "Phone numbers on the public board are always masked (country code and last two digits only). We never publish your full number.",
    ],
  },
  {
    title: "AI and third-party services",
    body: [
      "The help assistant and the SMS-to-request parser may use Google's Gemini AI. Before any text is sent to Gemini, phone-number-like sequences are stripped out — the AI never sees your number.",
      "Your phone number is passed to an SMS gateway only to deliver a verification code or an alert you opted into, and only when the gateway is active.",
      "The platform itself runs on standard hosting and database services (Render and MongoDB Atlas).",
    ],
  },
  {
    title: "How long we keep data",
    body: [
      "SOS requests: when a request is fulfilled or cancelled, the requester's phone number is removed from the request and replaced with its masked form. If a request expires (48 hours with no update), the number is kept for 30 days so the requester can re-open it, then removed automatically.",
      "Chat messages: visitor chat history is deleted automatically after 90 days.",
      "Security and audit logs: kept for up to 12 months, then deleted.",
      "Verification codes: hashed at rest, single-use, and deleted as soon as they are used or expire.",
    ],
  },
  {
    title: "Your rights — delete your data",
    body: [
      "If you are a registered donor, sign in and use the “Delete my data” action under your donor profile. This permanently removes your profile, your contact-request history, your notifications and your push subscription, and signs you out of every device.",
      "Deletion is paused only while you have a contact request in progress — because deleting you mid-handoff could strand a patient. Resolve or decline the open request first, then delete.",
      "Closed SOS requests you raised keep only a masked phone reference for the public record; the full number is removed as described above. For anything else, contact the platform admin through the Help section.",
    ],
  },
  {
    title: "Security",
    body: [
      "Sign-in uses one-time codes sent to your phone; passwords never exist. Sessions are protected with secure, httpOnly cookies, and high-risk endpoints (verification, SOS posting, admin access) are rate-limited and audited.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main id="main-content" className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 pb-28 md:pb-24">
      <div className="py-10 space-y-8">
        <div>
          <a href="#top" className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity duration-150 hover:opacity-75" style={{ color: 'var(--blood)' }}>
            <ChevronRight className="w-4 h-4 rotate-180" aria-hidden="true" />
            Back to home
          </a>
          <div className="flex items-center gap-3 mt-4">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--blood-soft)', color: 'var(--blood)' }}>
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            </span>
            <h1 className="font-display font-extrabold text-3xl md:text-4xl" style={{ color: 'var(--ink)' }}>Privacy policy</h1>
          </div>
          <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>
            Version 1.0 · Effective 27 November 2026 · Islamabad &amp; Rawalpindi, Pakistan
          </p>
        </div>

        {SECTIONS.map((section) => (
          <section key={section.title} className="rounded-2xl border p-5 md:p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
            <h2 className="font-display font-bold text-lg" style={{ color: 'var(--ink)' }}>{section.title}</h2>
            <div className="mt-3 space-y-3">
              {section.body.map((paragraph, i) => (
                <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{paragraph}</p>
              ))}
            </div>
          </section>
        ))}

        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          This is not a medical service. In a life-threatening emergency, call Rescue 1122 or your hospital directly.
        </p>
      </div>
    </main>
  );
}
