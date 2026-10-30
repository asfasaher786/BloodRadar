// Decorative hero starfield — slow drifting crimson/white particles behind
// the hero copy. Purely visual: pointer-events-none, aria-hidden, hidden
// entirely under prefers-reduced-motion. Deterministic pseudo-random
// values so the field is identical on every render (no hydration/layout
// surprises, no Math.random churn).
//
// Perf contract: the hero stays mounted on every view (it is just scrolled
// out of sight), so the field must NOT keep animating while offscreen —
// webkit's software compositor degrades under a dozen+ always-on layers and
// its hit-testing starts alternating every other frame (the "element is not
// stable" E2E failure). An IntersectionObserver pauses the whole field via
// animation-play-state when the hero leaves the viewport and resumes it the
// moment it returns.
import { useEffect, useRef, useState } from "react";

const STARS = Array.from({ length: 14 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const palette = [
    "rgb(196 18 48 / 0.40)",
    "rgb(244 114 133 / 0.55)",
    "rgb(255 154 174 / 0.50)",
  ];
  return {
    left: r(1) * 100,
    size: 1.5 + r(2) * 2,
    dur: 22 + r(3) * 26,
    delay: -(r(4) * 45),
    color: palette[Math.floor(r(5) * palette.length)],
    o: 0.25 + r(6) * 0.4,
  };
});

export default function Starfield() {
  const ref = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setPlaying(entry.isIntersecting),
      { rootMargin: "0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className="starfield"
      ref={ref}
      style={{ ["--star-play" as string]: playing ? "running" : "paused" }}
      aria-hidden="true"
    >
      {STARS.map((s, i) => (
        <span
          key={i}
          style={{
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            background: s.color,
            animationDuration: `${s.dur}s`,
            animationDelay: `${s.delay}s`,
            ["--star-o" as string]: s.o,
          }}
        />
      ))}
    </div>
  );
}
