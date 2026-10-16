import React from "react";

export type BadgeTone = "neutral" | "blood" | "safe" | "warn" | "gold" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  blood: "bg-blood-soft text-blood-ink border-blood/30",
  safe: "bg-safe-soft text-safe-ink border-safe/40",
  warn: "bg-warn-soft text-warn-ink border-warn/40",
  gold: "bg-gold-soft text-gold-ink border-gold/40",
  info: "bg-ink text-white border-ink",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  mono?: boolean;
  children?: React.ReactNode;
}

/** Small status chip. All text tones meet 4.5:1 on their tint. */
export default function Badge({ tone = "neutral", icon, mono = false, className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold
        ${mono ? "font-mono" : "font-sans"} ${TONES[tone]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
