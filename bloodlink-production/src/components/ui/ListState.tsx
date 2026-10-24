import { RefreshCw } from "lucide-react";
import BrandMark from "./BrandMark";

interface ListStateProps {
  kind: "empty" | "error";
  title: string;
  sub?: string;
  /** When set, renders a retry button (e.g. "Try again"). */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/**
 * Shared empty/error state for lists: small brand SVG + one honest sentence.
 * Never a blank white box. `role` is status for empty, alert for error so
 * screen readers hear a failed load immediately.
 */
export default function ListState({ kind, title, sub, actionLabel, onAction, className = "" }: ListStateProps) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex flex-col items-center justify-center text-center px-6 py-10 ${className}`}
    >
      <BrandMark className={`w-10 h-10 ${kind === "error" ? "opacity-60" : "opacity-75"}`} />
      <p className="mt-3 text-sm font-semibold" style={{ color: "var(--ink)" }}>{title}</p>
      {sub && (
        <p className="mt-1.5 text-xs max-w-xs leading-relaxed" style={{ color: "var(--muted)" }}>{sub}</p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-white transition hover:opacity-90"
          style={{ background: kind === "error" ? "var(--blood)" : "var(--ink)" }}
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
