import { useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { API_BASE } from "../lib/api";
import Button from "./ui/Button";

// P3b-10: the donor-facing privacy controls — link to the policy page and
// the delete-my-data action. Deletion is a deliberate two-step (confirm
// row appears after the first press) because it is permanent, and the
// server may refuse while a contact handoff is in flight.
interface PrivacyControlsProps {
  onDeleted: () => void;
}

export default function PrivacyControls({ onDeleted }: PrivacyControlsProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        localStorage.removeItem("bloodradar_my_donor_phone");
        setConfirming(false);
        onDeleted();
      } else {
        setError(data.error || "Couldn't delete your data right now. Try again.");
      }
    } catch {
      setError("Network error. Try again shortly.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="privacy-controls"
      aria-label="Privacy controls"
      className="rounded-2xl border p-5 shadow-sm"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4" style={{ color: 'var(--blood)' }} aria-hidden="true" />
        <h3 className="font-display font-bold text-base" style={{ color: 'var(--ink)' }}>Your data</h3>
      </div>
      <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--muted)' }}>
        Read our <a href="#privacy" className="font-semibold underline underline-offset-2" style={{ color: 'var(--blood)' }}>privacy policy</a> to see exactly what we keep, for how long, and when it is removed.
      </p>
      {!confirming ? (
        <Button
          variant="danger"
          size="sm"
          onClick={() => { setError(null); setConfirming(true); }}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          Delete my data
        </Button>
      ) : (
        <div className="rounded-xl border p-3.5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--blood-soft)' }}>
          <p className="text-xs leading-relaxed font-semibold" style={{ color: 'var(--ink)' }}>
            This permanently deletes your donor profile, inbox history, notifications and push subscription, and signs you out everywhere. This cannot be undone.
          </p>
          {error && (
            <p className="text-xs" role="alert" style={{ color: 'var(--blood)' }}>{error}</p>
          )}
          <div className="flex gap-2">
            <Button variant="danger" size="sm" onClick={handleDelete} loading={busy} disabled={busy}>
              Yes, delete everything
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
