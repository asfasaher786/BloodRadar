// Cute hero mascot — a chunky crimson blood drop with a kawaii face that
// bobs gently while tiny hearts drift up around it. Pure decorative SVG:
// pointer-events-none, aria-hidden, static under prefers-reduced-motion.
//
// Perf contract: same rules as the starfield — transform-only keyframes,
// a handful of layers, and every animation paused via .hero-rest when the
// hero scrolls out of view (webkit software compositor stays healthy).

export default function HeroMascot() {
  return (
    <div
      className="hero-mascot relative w-56 sm:w-64 select-none"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      {/* Soft blush halo behind the character. */}
      <div
        className="absolute inset-x-0 top-10 mx-auto w-52 sm:w-56 h-52 sm:h-56 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgb(196 18 48 / 0.10), transparent 72%)" }}
      />

      {/* Ground shadow — squashes in sync with the bob. */}
      <svg viewBox="0 0 160 200" className="mascot-shadow absolute bottom-2 left-1/2 -translate-x-1/2 w-36 sm:w-40">
        <ellipse cx="80" cy="188" rx="52" ry="8" fill="rgb(196 18 48 / 0.16)" />
      </svg>

      {/* The drop — bobs up and down. */}
      <svg viewBox="0 0 160 200" className="mascot-bob relative w-full">
        <defs>
          <linearGradient id="mascot-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#E02A4C" />
            <stop offset="1" stopColor="#8B0A1F" />
          </linearGradient>
          <radialGradient id="mascot-shine" cx="0.35" cy="0.25" r="0.5">
            <stop offset="0" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="1" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>

        {/* Stub arms. */}
        <g className="mascot-arm-left">
          <path d="M56 108 q-10 2 -13 10 q9 1 15 -4 z" fill="#A80F29" />
        </g>
        <g className="mascot-arm-right">
          <path d="M104 108 q10 2 13 10 q-9 1 -15 -4 z" fill="#A80F29" />
        </g>

        {/* Body — a chunky rounded drop. */}
        <path
          d="M80 18 C 108 44, 126 66, 126 98 A 46 46 0 1 1 34 98 C 34 66, 52 44, 80 18 Z"
          fill="url(#mascot-body)"
        />
        {/* Glossy highlight. */}
        <ellipse cx="64" cy="62" rx="16" ry="24" fill="url(#mascot-shine)" transform="rotate(-18 64 62)" />

        {/* Tiny white cross badge on the chest. */}
        <g opacity="0.92">
          <rect x="72" y="128" width="16" height="6" rx="3" fill="#FFFFFF" />
          <rect x="77" y="123" width="6" height="16" rx="3" fill="#FFFFFF" />
        </g>

        {/* Face. */}
        <g fill="#2A0A12">
          <circle cx="64" cy="92" r="5" />
          <circle cx="96" cy="92" r="5" />
        </g>
        <g fill="#FFFFFF">
          <circle cx="65.8" cy="90" r="1.6" />
          <circle cx="97.8" cy="90" r="1.6" />
        </g>
        {/* Smile. */}
        <path d="M72 102 q8 7 16 0" fill="none" stroke="#2A0A12" strokeWidth="3" strokeLinecap="round" />
        {/* Blush cheeks. */}
        <g fill="rgb(255 154 174 / 0.75)">
          <ellipse cx="52" cy="101" rx="6" ry="4" />
          <ellipse cx="108" cy="101" rx="6" ry="4" />
        </g>
      </svg>

      {/* Floating hearts — positioned by the <g> transform; the path itself is
          CSS-animated (translateY + fade) so no attribute/CSS transform clash. */}
      <svg viewBox="0 0 160 200" className="absolute inset-0">
        {[
          { x: 18, s: 1.0, dur: "4.6s", delay: "0s" },
          { x: 122, s: 0.8, dur: "5.4s", delay: "1.4s" },
          { x: 68, s: 0.65, dur: "4.2s", delay: "2.6s" },
        ].map((h, i) => (
          <g key={i} transform={`translate(${h.x} 148) scale(${h.s})`}>
            <path
              d="M12 21s-6.7-4.3-9.3-8C.6 10 2 6.5 5.2 6.1c2-.2 3.9.9 4.8 2.6.9-1.7 2.8-2.8 4.8-2.6C18 6.5 19.4 10 17.3 13c-2.6 3.7-9.3 8-9.3 8z"
              fill="rgb(196 18 48 / 0.5)"
              className="mascot-heart"
              style={{ animationDuration: h.dur, animationDelay: h.delay }}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
