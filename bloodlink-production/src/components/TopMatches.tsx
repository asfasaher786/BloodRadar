import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { API_BASE } from "../lib/api";

// Transparent donor ranking (Phase 3): shows the top ranked matches for an
// SOS with their rule-based scores and a "why" toggle that lists the exact
// reasons behind each point. No machine learning anywhere — the backend
// score IS the explanation.
export interface RankedMatch {
  id: string;
  name: string;
  bloodGroup: string;
  city: string;
  score: number; // 0–100
  reasons: string[];
}

export default function TopMatches({ sosId }: { sosId: string }) {
  const [matches, setMatches] = useState<RankedMatch[] | null>(null);
  const [openWhy, setOpenWhy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/emergencies/${sosId}/matches`)
      .then(r => { if (!r.ok) throw new Error("matches unavailable"); return r.json(); })
      .then(d => { if (!cancelled) setMatches(d.matches || []); })
      .catch(() => { if (!cancelled) setMatches([]); }); // ranking is additive — never block the SOS panel
    return () => { cancelled = true; };
  }, [sosId]);

  if (matches === null || matches.length === 0) return null;

  const top = matches.slice(0, 3);

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
        <Info className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--blood)' }} aria-hidden="true" />
        Top matches nearby — ranked by transparent rules, not AI
      </p>
      <div className="mt-2 space-y-2">
        {top.map(m => (
          <div key={m.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-display font-black text-white shrink-0"
                  style={{ background: 'var(--blood)' }}
                  aria-hidden="true"
                >
                  {m.bloodGroup}
                </span>
                <span className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>{m.name}</span>
                <span className="text-xs truncate" style={{ color: 'var(--muted)' }}>{m.city}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className="w-16 h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'var(--surface-2)' }}
                  role="img"
                  aria-label={`${m.name}: score ${m.score} out of 100`}
                >
                  <div className="h-full rounded-full" style={{ width: `${Math.min(m.score, 100)}%`, background: 'var(--safe)' }} />
                </div>
                <span className="text-xs font-mono font-bold" style={{ color: 'var(--safe-ink)' }}>{m.score}</span>
                <button
                  id={`btn-why-donor-${m.id}`}
                  onClick={() => setOpenWhy(openWhy === m.id ? null : m.id)}
                  aria-expanded={openWhy === m.id}
                  aria-label={`Why ${m.name} ranks at ${m.score}`}
                  className="p-1 rounded-md hover:bg-surface-2 transition"
                  style={{ color: 'var(--muted)' }}
                >
                  <Info className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
            {openWhy === m.id && (
              <ul className="mt-1.5 space-y-0.5 pl-9" aria-label={`Why ${m.name} ranks at ${m.score}`}>
                {m.reasons.map((r, i) => (
                  <li key={i} className="text-xs" style={{ color: 'var(--muted)' }}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
