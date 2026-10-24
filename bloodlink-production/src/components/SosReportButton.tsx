import { useState } from "react";
import { Flag } from "lucide-react";
import { API_BASE } from "../lib/api";

// Abuse controls (Phase 3): anyone can report a suspicious SOS. This
// keeps its own state per card — idle → optional reason → POST → thanks.
// No auth wall: reporting must never be gated behind an account.
export default function SosReportButton({ sosId }: { sosId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submitReport = async () => {
    if (sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/emergencies/${sosId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        setError("Could not send the report. Please try again.");
        setSending(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Network problem — the report was not sent.");
      setSending(false);
    }
  };

  if (done) {
    return (
      <p className="text-xs font-semibold mt-2 text-right" style={{ color: 'var(--safe-ink)' }} role="status">
        {'Report sent — our team will review this request.'}
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mt-2 flex justify-end">
        <button
          id={`btn-report-sos-${sosId}`}
          onClick={() => { setOpen(true); setError(""); }}
          aria-expanded="false"
          className="inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2 hover:opacity-70 transition"
          style={{ color: 'var(--muted)' }}
        >
          <Flag className="w-3 h-3" aria-hidden="true" />
          {'Report this request'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border p-2.5 text-left" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <label htmlFor={`report-reason-${sosId}`} className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
        {'Why does this request look wrong? (optional)'}
      </label>
      <input
        id={`report-reason-${sosId}`}
        type="text"
        maxLength={200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder='e.g. looks like spam'
        className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2"
        style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)' }}
        aria-label='Report reason (optional)'
      />
      {error && <p className="text-xs mt-1.5 font-semibold" style={{ color: 'var(--blood)' }} role="alert">{error}</p>}
      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          onClick={() => setOpen(false)}
          className="text-xs font-semibold px-2 py-1 rounded-md hover:bg-surface-2 transition"
          style={{ color: 'var(--muted)' }}
        >
          {'Cancel'}
        </button>
        <button
          id={`btn-send-report-${sosId}`}
          onClick={submitReport}
          disabled={sending}
          className="text-xs font-bold px-2.5 py-1 rounded-md text-white transition disabled:opacity-50"
          style={{ background: 'var(--blood)' }}
        >
          {sending ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </div>
  );
}
