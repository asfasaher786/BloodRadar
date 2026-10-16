import React from "react";
import { AlertTriangle } from "lucide-react";
import Button from "./Button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

/** Error state with an honest message and a retry action when possible. */
export default function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className = "",
}: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center text-center py-10 px-6 ${className}`} role="alert">
      <div className="w-11 h-11 rounded-xl bg-blood-soft border border-blood/30 flex items-center justify-center mb-4">
        <AlertTriangle className="w-5 h-5 text-blood" aria-hidden="true" />
      </div>
      <h4 className="font-display font-bold text-sm text-ink">{title}</h4>
      {description && <p className="text-xs text-muted mt-1.5 max-w-xs leading-relaxed">{description}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">Try again</Button>
      )}
    </div>
  );
}
