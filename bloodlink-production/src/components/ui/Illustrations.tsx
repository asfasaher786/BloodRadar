import React from "react";

/* Lightweight brand SVG illustrations — drop, heart, map pin motifs.
   Hand-drawn paths in brand colors; no stock imagery anywhere. */

export function IllustrationDrop({ className = "w-24 h-24" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} role="img" aria-label="Blood drop illustration">
      <path
        d="M48 8C48 8 20 40 20 62a28 28 0 0 0 56 0C76 40 48 8 48 8Z"
        fill="var(--color-blood-soft)"
        stroke="var(--color-blood)"
        strokeWidth="3"
      />
      <path d="M48 26C48 26 33 46 33 60a15 15 0 0 0 30 0C63 46 48 26 48 26Z" fill="var(--color-blood)" />
      <path d="M42 50a8 8 0 0 0 6 6" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function IllustrationHeart({ className = "w-24 h-24" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} role="img" aria-label="Heart illustration">
      <path
        d="M48 82S14 62 14 36c0-13 10-22 21-22 6 0 10 2.5 13 6.5C51 16.5 55 14 61 14c11 0 21 9 21 22 0 26-34 46-34 46Z"
        fill="var(--color-blood-soft)"
        stroke="var(--color-blood)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M48 74S26 60 26 42c0-7 5-12 12-12 3.5 0 6.5 1.5 8.5 4 1-1.5 2-2.5 3.5-3.5"
        stroke="var(--color-blood)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M38 44h20M48 34v20" stroke="var(--color-blood)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function IllustrationMapPin({ className = "w-24 h-24" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} role="img" aria-label="Map pin illustration">
      <path
        d="M48 88C48 88 22 60 22 40a26 26 0 0 1 52 0c0 20-26 48-26 48Z"
        fill="var(--color-blood-soft)"
        stroke="var(--color-blood)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="48" cy="40" r="13" fill="var(--color-blood)" />
      <circle cx="48" cy="40" r="4.5" fill="#fff" />
    </svg>
  );
}

export function IllustrationHospital({ className = "w-24 h-24" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} role="img" aria-label="Hospital illustration">
      <rect x="14" y="22" width="68" height="60" rx="6" fill="var(--color-blood-soft)" stroke="var(--color-blood)" strokeWidth="3" />
      <path d="M34 82V66a14 14 0 0 1 28 0v16" stroke="var(--color-blood)" strokeWidth="3" />
      <path d="M48 38v20M38 48h20" stroke="var(--color-blood)" strokeWidth="4" strokeLinecap="round" />
      <path d="M14 48h68" stroke="var(--color-blood)" strokeWidth="3" opacity="0.5" />
    </svg>
  );
}
