// Home-page bands: "Become a donor" (blood-tint) and the trust band (wine).
// Both are honest-claim surfaces — what the project actually verifies, what
// it doesn't, and how phone numbers stay private. No superlatives.

import { ShieldCheck, EyeOff, Flag, Droplets, ChevronRight, CheckCircle2, Phone, HeartPulse, Info } from "lucide-react";

export function BecomeDonorBand({ onBecomeDonor }: { onBecomeDonor: () => void }) {
  const BENEFITS = [
    {
      icon: HeartPulse,
      title: "Help within minutes",
      body: "You're alerted the moment an SOS matches your blood group and city — you decide whether to respond.",
    },
    {
      icon: EyeOff,
      title: "Your number stays private",
      body: "Requesters only see your phone number after you accept their request. Until then it's masked.",
    },
    {
      icon: ShieldCheck,
      title: "Verified, on your terms",
      body: "An optional one-time code verifies your number. Your donation streak and badges are yours to show.",
    },
  ];

  return (
    <section
      id="become-a-donor"
      aria-labelledby="become-a-donor-title"
      className="scroll-mt-24 border-y"
      style={{ background: 'var(--blood-tint)', borderColor: 'var(--blood-border)' }}
    >
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Copy + CTA */}
          <div className="lg:col-span-7">
            <h2 id="become-a-donor-title" className="font-display font-extrabold text-2xl md:text-3xl" style={{ color: 'var(--ink)' }}>
              Become a donor
            </h2>
            <p className="font-serif-accent text-xl md:text-2xl mt-2" style={{ color: 'var(--ink)' }}>
              When you can, you save lives.
            </p>
            <ul className="mt-8 space-y-5">
              {BENEFITS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex items-start gap-3.5">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--card)' }}>
                    <Icon className="w-5 h-5" style={{ color: 'var(--blood)' }} aria-hidden="true" />
                  </span>
                  <div>
                    <div className="font-display font-bold text-sm" style={{ color: 'var(--ink)' }}>{title}</div>
                    <p className="text-sm mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                onClick={onBecomeDonor}
                className="inline-flex items-center gap-2 px-7 py-4 rounded-2xl font-display font-bold text-base text-white transition-all duration-150 shadow-2 hover:shadow-3 hover:-translate-y-px"
                style={{ background: 'var(--blood)' }}
              >
                <Droplets className="w-5 h-5" aria-hidden="true" />
                Become a donor
              </button>
              <p className="text-xs leading-relaxed max-w-sm" style={{ color: 'var(--muted)' }}>
                Eligibility: you must be 18 or older and at least 90 days past your last donation. You confirm this during signup.
              </p>
            </div>
          </div>

          {/* Gold badge preview — the one gold touch on the page */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="brand-card rounded-3xl p-8 w-full max-w-sm fade-up">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'var(--gold-soft)' }}>
                  <Droplets className="w-7 h-7" style={{ color: 'var(--gold-ink)' }} aria-hidden="true" />
                </div>
                <div>
                  <div className="font-display font-bold text-sm" style={{ color: 'var(--ink)' }}>Gold badge</div>
                  <div className="font-mono text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Unlocks as your streak grows</div>
                </div>
              </div>
              <p className="text-sm mt-4 leading-relaxed" style={{ color: 'var(--muted)' }}>
                Every completed donation you log adds to a streak you can be proud of — quietly, no gamified noise.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function TrustBand() {
  const CARDS = [
    {
      icon: CheckCircle2,
      title: "What we verify",
      body: "Donor phone numbers via one-time code when a donor opts in, and eligibility (age and donation interval) with the donor's consent.",
    },
    {
      icon: Info,
      title: "What we don't",
      body: "Hospital stock levels here are sample data compiled from public information — not live hospital systems. Always call the hospital to confirm.",
    },
    {
      icon: EyeOff,
      title: "How numbers stay protected",
      body: "Contact numbers are masked on the public site and revealed only between a requester and a donor who accepts the request.",
    },
    {
      icon: Flag,
      title: "Feedback & corrections",
      body: "Early-stage community project. Use the flag button on any listing or the assistant chat (bottom right) — a real person reviews every report.",
    },
  ];

  return (
    <section id="trust" aria-labelledby="trust-title" className="wine-band">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-16">
        <h2 id="trust-title" className="font-display font-extrabold text-2xl md:text-3xl">
          What we verify — and what we don't
        </h2>
        <p className="text-sm md:text-base mt-2 max-w-2xl wine-muted">
          Trust comes from saying what's real. Here is exactly what this project checks, and what it can't.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-10">
          {CARDS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="wine-card rounded-2xl p-6">
              <div className="flex items-center gap-2.5 mb-3">
                <Icon className="w-5 h-5 shrink-0" style={{ color: 'var(--blood-light)' }} aria-hidden="true" />
                <h3 className="font-display font-bold text-sm">{title}</h3>
              </div>
              <p className="text-sm leading-relaxed wine-muted">{body}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 flex items-start gap-2.5 text-sm wine-muted max-w-2xl">
          <Phone className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            This is not a medical service. In an emergency, always call the hospital directly — the hotline numbers on this page are real and always clickable.
          </span>
        </p>
      </div>
    </section>
  );
}
