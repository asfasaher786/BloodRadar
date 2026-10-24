/**
 * Inline brand mark: a crimson drop inside a radar ring.
 * Used in skeletons, empty/error states and other quiet spots where a full
 * logo would be noise. Pure SVG, tokens only, <1KB.
 */
export default function BrandMark({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} focusable="false">
      <circle cx="12" cy="12" r="9" stroke="var(--blood)" strokeWidth="1.5" strokeDasharray="2.5 2.5" opacity="0.45" />
      <path
        d="M12 5.6c2.5 2.9 4 5 4 6.8a4 4 0 1 1-8 0c0-1.8 1.5-3.9 4-6.8z"
        fill="var(--blood)"
      />
    </svg>
  );
}
