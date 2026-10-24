import { useEffect, useState } from "react";
import Skeleton from "./ui/Skeleton";
import BrandMark from "./ui/BrandMark";

/**
 * Full-page loading skeleton that mirrors the real layout (nav, hero,
 * map, directory, SOS board, right column) so the first paint is stable
 * and honest: users see structure, not a blank screen or fake content.
 * Wrap in role="status" + sr-only text by the caller for screen readers.
 *
 * Free-tier cold start: after 3s of waiting the skeleton admits what is
 * happening ("Waking up the server…") instead of shimmering forever.
 */
export default function PageSkeleton() {
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), 3000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--surface)" }} aria-busy="true">
      {/* Nav skeleton */}
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-2.5 w-36" />
            </div>
          </div>
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </header>

      {/* Honest wait notice — appears only after 3s (free-tier cold start). */}
      {waited && (
        <div
          role="status"
          className="flex items-center justify-center gap-2.5 px-4 py-2.5 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <BrandMark className="w-5 h-5 shrink-0" />
          <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
            Waking up the server…
          </p>
          <p className="text-xs hidden sm:inline" style={{ color: "var(--muted)" }}>
            Free-tier servers sleep when idle — the first load takes a moment.
          </p>
        </div>
      )}

      {/* Hero skeleton */}
      <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-10 pb-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-5">
          <Skeleton className="h-6 w-56 rounded-full" />
          <div className="space-y-3 pt-2">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-12 w-1/2" />
          </div>
          <div className="space-y-2 pt-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Skeleton className="h-11 w-32 rounded-xl" />
            <Skeleton className="h-11 w-32 rounded-xl" />
            <Skeleton className="h-11 w-32 rounded-xl" />
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Skeleton className="h-11 w-48 rounded-xl" />
            <Skeleton className="h-11 w-48 rounded-xl" />
          </div>
        </div>
        <div className="lg:col-span-5 space-y-6">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      </section>

      {/* Main content skeleton */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          {/* Map card */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <Skeleton className="h-5 w-36" />
              <div className="flex gap-1.5">
                <Skeleton className="h-8 w-20 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
            </div>
            <Skeleton className="h-105 w-full rounded-none" />
            <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
              <Skeleton className="h-3 w-64 mx-auto" />
            </div>
          </div>
          {/* Directory tabs + grid */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex gap-1 p-1.5 border-b" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
              <Skeleton className="h-8 flex-1 rounded-lg" />
              <Skeleton className="h-8 flex-1 rounded-lg" />
              <Skeleton className="h-8 flex-1 rounded-lg" />
              <Skeleton className="h-8 flex-1 rounded-lg" />
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          </div>
          {/* SOS board */}
          <div className="rounded-2xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="px-5 pt-5 pb-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-6 w-20 rounded" />
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Skeleton className="h-44 w-full rounded-xl" />
              <Skeleton className="h-44 w-full rounded-xl" />
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <Skeleton className="h-80 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
          <Skeleton className="h-52 w-full rounded-2xl" />
        </div>
      </main>
    </div>
  );
}
