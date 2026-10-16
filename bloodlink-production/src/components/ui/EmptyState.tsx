import React from "react";
import { IllustrationDrop } from "./Illustrations";
import Button from "./Button";

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  illustration?: React.ReactNode;
  className?: string;
}

/** Empty state with a brand illustration and one optional action. */
export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  illustration,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center text-center py-10 px-6 ${className}`}>
      <div className="mb-4 opacity-90">{illustration ?? <IllustrationDrop className="w-20 h-20" />}</div>
      <h4 className="font-display font-bold text-sm text-ink">{title}</h4>
      {description && <p className="text-xs text-muted mt-1.5 max-w-xs leading-relaxed">{description}</p>}
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction} className="mt-4">{actionLabel}</Button>
      )}
    </div>
  );
}
