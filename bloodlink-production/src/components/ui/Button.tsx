import React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  // One primary action per screen: crimson, bold, calm elsewhere.
  // Primary lifts 1px on hover — a tactile cue, not decoration.
  primary: "bg-blood text-white hover:bg-blood-hover shadow-2 hover:shadow-3 hover:-translate-y-px",
  secondary: "bg-card text-ink border border-border-strong shadow-1 hover:border-blood/50 hover:text-blood hover:-translate-y-px",
  ghost: "bg-transparent text-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-blood-ink text-white hover:opacity-90 shadow-1",
  success: "bg-safe-ink text-white hover:opacity-90 shadow-1",
};

const SIZES: Record<ButtonSize, string> = {
  // md/lg are ≥48px tall — large tap targets (WCAG 2.5.5 / mobile).
  sm: "h-9 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-12 px-5 text-sm gap-2 rounded-xl",
  lg: "h-14 px-7 text-base gap-2.5 rounded-xl",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

/** Primary action button of the BloodRadar design system. */
export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  icon,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-display font-bold tracking-wide transition-all duration-150
        active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer select-none
        ${VARIANTS[variant]} ${SIZES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
