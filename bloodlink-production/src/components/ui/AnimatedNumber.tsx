import { useEffect, useRef, useState } from "react";

/**
 * Timer-based count-up that works even in throttled/background tabs
 * (no requestAnimationFrame) and instantly shows the final value for
 * users with prefers-reduced-motion (WCAG 2.3.3).
 */
export default function AnimatedNumber({ value, duration = 600, suffix = "" }: { value: number; duration?: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const reducedMotion = typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || duration <= 0) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out so the number settles softly instead of ticking flat.
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) frameRef.current = window.setTimeout(tick, 32);
    };
    frameRef.current = window.setTimeout(tick, 0);
    return () => { if (frameRef.current !== null) window.clearTimeout(frameRef.current); };
  }, [value, duration]);

  return <>{display}{suffix}</>;
}
