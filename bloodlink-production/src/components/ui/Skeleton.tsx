import React from "react";

/** Shimmer placeholder — pair with aria-hidden; the container owns the busy state. */
export default function Skeleton({ className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden="true" {...rest} />;
}

/** A few common skeleton compositions for async regions. */
export function SkeletonCard() {
  return (
    <div className="p-4 rounded-xl border border-border bg-card" aria-hidden="true">
      <Skeleton className="h-4 w-2/3 mb-3" />
      <Skeleton className="h-3 w-full mb-2" />
      <Skeleton className="h-3 w-4/5 mb-4" />
      <Skeleton className="h-9 w-full rounded-lg" />
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonStats() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
}
