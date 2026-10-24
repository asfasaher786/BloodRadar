// "How it works" — three steps with hand-drawn line illustrations.
// Illustration language per the design spec: 1.75px stroke, round caps,
// crimson + ink on cream, exactly one filled shape per drawing, inline SVG
// (each well under 8KB). Stroke colours use CSS vars so the drawings adapt
// to dark mode like the rest of the page.

function RequestIllustration() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full" role="img" aria-label="A phone sending a blood request">
      {/* Phone body */}
      <rect x="20" y="8" width="24" height="48" rx="5" fill="none" stroke="var(--color-ink)" strokeWidth="1.75" />
      <line x1="27" y1="14" x2="37" y2="14" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinecap="round" />
      {/* Ping rings + the one filled crimson dot */}
      <circle cx="32" cy="26" r="10" fill="none" stroke="var(--color-blood)" strokeWidth="1.75" opacity="0.4" />
      <circle cx="32" cy="26" r="4.5" fill="none" stroke="var(--color-blood)" strokeWidth="1.75" />
      <circle cx="32" cy="26" r="2.4" fill="var(--color-blood)" />
      {/* Home button */}
      <circle cx="32" cy="50" r="1.6" fill="var(--color-ink)" opacity="0.5" />
    </svg>
  );
}

function NotifiedIllustration() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full" role="img" aria-label="Compatible donors are notified on a radar">
      {/* Radar sweep */}
      <circle cx="32" cy="34" r="22" fill="none" stroke="var(--color-blood)" strokeWidth="1.75" opacity="0.35" />
      <circle cx="32" cy="34" r="13" fill="none" stroke="var(--color-blood)" strokeWidth="1.75" opacity="0.5" />
      <line x1="32" y1="34" x2="52" y2="20" stroke="var(--color-blood)" strokeWidth="1.75" strokeLinecap="round" />
      {/* Three pin outlines; the middle pin is the one filled shape */}
      <path d="M17 26c-2.6 0-4.6 2-4.6 4.6 0 3.2 4.6 7.9 4.6 7.9s4.6-4.7 4.6-7.9c0-2.6-2-4.6-4.6-4.6z" fill="none" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M32 18c-2.6 0-4.6 2-4.6 4.6 0 3.2 4.6 7.9 4.6 7.9s4.6-4.7 4.6-7.9c0-2.6-2-4.6-4.6-4.6z" fill="var(--color-blood)" />
      <path d="M47 26c-2.6 0-4.6 2-4.6 4.6 0 3.2 4.6 7.9 4.6 7.9s4.6-4.7 4.6-7.9c0-2.6-2-4.6-4.6-4.6z" fill="none" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinejoin="round" />
      {/* Signal ticks toward the filled pin */}
      <path d="M38 22l5-5M40 27l7-4" stroke="var(--color-blood)" strokeWidth="1.75" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function DonorCallsIllustration() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full" role="img" aria-label="Hands passing a blood drop">
      {/* Left hand, palm up */}
      <path d="M12 44c-1.5-6.5 5-10 8.5-6.5-0.5-4.5 3.5-8 7.5-5.5 1-3.5 5.5-4 7.5-0.5l-1.5 8.5c2.5 0.5 5 2.5 5 4.5" fill="none" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {/* Right hand, palm up */}
      <path d="M52 44c1.5-6.5-5-10-8.5-6.5 0.5-4.5-3.5-8-7.5-5.5-1-3.5-5.5-4-7.5-0.5l1.5 8.5c-2.5 0.5-5 2.5-5 4.5" fill="none" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {/* The one filled shape: the drop being passed */}
      <path d="M32 22c3.6 4.1 6.4 7.4 6.4 10.1a6.4 6.4 0 1 1-12.8 0C25.6 29.4 28.4 26.1 32 22z" fill="var(--color-blood)" />
    </svg>
  );
}

const STEPS = [
  {
    title: "Request",
    body: "Choose the blood group and hospital, and send. It takes about 30 seconds from a phone.",
    illustration: <RequestIllustration />,
  },
  {
    title: "Compatible donors notified",
    body: "Matching donors nearby are alerted right away — their numbers stay masked until they accept.",
    illustration: <NotifiedIllustration />,
  },
  {
    title: "Donor calls you",
    body: "You talk directly and arrange the donation with the hospital. No middlemen, no fees.",
    illustration: <DonorCallsIllustration />,
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-24 border-y" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-16">
        <div className="flex items-center gap-3 mb-3">
          <span className="radar-glyph" aria-hidden="true" />
          <h2 id="how-it-works-title" className="font-display font-extrabold text-2xl md:text-3xl" style={{ color: 'var(--ink)' }}>
            How it works
          </h2>
        </div>
        <p className="text-base mb-10 max-w-2xl" style={{ color: 'var(--muted)' }}>
          Three steps between an emergency and a phone call.
        </p>

        <ol className="grid grid-cols-1 md:grid-cols-3 gap-6 list-none">
          {STEPS.map((step, i) => (
            <li key={step.title} className="brand-card rounded-2xl p-6 fade-up" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--surface)' }}>
                {step.illustration}
              </div>
              <div className="font-mono text-xs font-bold mb-1.5" style={{ color: 'var(--blood)' }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <h3 className="font-display font-bold text-base" style={{ color: 'var(--ink)' }}>{step.title}</h3>
              <p className="text-sm mt-1.5 leading-relaxed" style={{ color: 'var(--muted)' }}>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
