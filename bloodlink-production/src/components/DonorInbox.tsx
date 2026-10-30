import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import { Inbox, CheckCircle2, XCircle, PhoneCall, Loader2, Heart, RefreshCw } from "lucide-react";
import Skeleton from "./ui/Skeleton";
import ListState from "./ui/ListState";

interface InboxItem {
  id: string;
  sosId: string;
  status: 'open' | 'accepted' | 'declined' | 'superseded';
  createdAt: string;
  acceptedAt?: string;
  patientName: string;
  bloodGroup: string;
  hospitalName: string;
  city: string;
  unitsNeeded: number;
  requesterPhone: string;
  phoneRevealed: boolean;
}

interface AcceptedInfo {
  requesterPhone: string;
  sos: { id: string; patientName: string; bloodGroup: string; hospitalName: string; unitsNeeded: number } | null;
}

interface DonorInboxProps {
  onChanged?: () => void;
}

// Contact requests waiting on THIS donor (proven by their login session).
// The requester's number stays masked until the donor accepts — then both
// sides get each other's real number (first-accept-wins, audit-logged).
export default function DonorInbox({ onChanged }: DonorInboxProps) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [acceptedInfo, setAcceptedInfo] = useState<AcceptedInfo | null>(null);

  const loadInbox = async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${API_BASE}/api/donors/inbox`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : []);
      } else {
        setItems([]);
      }
    } catch {
      /* keep last known list on transient failure, but say so honestly */
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { loadInbox(); }, []);

  // Live refresh: a new contact request for THIS donor arrives instantly.
  // The event carries only a PII-free sosId; details come from loadInbox().
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events`);
    es.addEventListener("contact-request-created", () => loadInbox());
    es.addEventListener("contact-request-accepted", () => loadInbox());
    es.addEventListener("contact-request-declined", () => loadInbox());
    return () => es.close();
  }, []);

  const handleAccept = async (id: string) => {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/donors/inbox/${id}/accept`, {
        method: "POST",
        credentials: "include"
      });
      const data = await res.json();
      if (res.ok) {
        setAcceptedInfo({ requesterPhone: data.requesterPhone, sos: data.sos || null });
        await loadInbox();
        onChanged?.();
      } else {
        setError(data.error || "Couldn't accept. Try again.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (id: string) => {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/donors/inbox/${id}/decline`, {
        method: "POST",
        credentials: "include"
      });
      if (res.ok) {
        await loadInbox();
        onChanged?.();
      } else {
        const data = await res.json();
        setError(data.error || "Couldn't decline. Try again.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const openItems = items.filter(i => i.status === 'open');
  // The card always renders for a signed-in donor — an invisible inbox was
  // the "where do I accept?" confusion. Empty state says so honestly and
  // offers a manual refresh for phones that missed the live update.

  return (
    <div id="donor-inbox-card" className="rounded-2xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(196,18,48,0.08)', border: '1px solid rgba(196,18,48,0.2)' }}>
          <Inbox className="w-4 h-4" style={{ color: 'var(--blood)' }} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-display font-bold" style={{ color: 'var(--ink)' }}>
            Contact Requests
          </h2>
          <p className="text-xs font-mono" style={{ color: 'var(--muted)' }}>
            {openItems.length} waiting for your help
          </p>
        </div>
        <button
          onClick={loadInbox}
          aria-label="Refresh requests"
          className="ml-auto p-2 rounded-lg transition hover:bg-surface-2"
          style={{ color: 'var(--muted)' }}
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {acceptedInfo && (
        <div className="mb-4 p-3 rounded-xl flex items-center justify-between gap-3" style={{ background: 'rgba(0,196,140,0.08)', border: '1px solid rgba(0,196,140,0.3)' }}>
          <div className="min-w-0">
            <p className="text-xs font-bold font-sans" style={{ color: 'var(--ink)' }}>
              Number shared — call the patient now
            </p>
            {acceptedInfo.sos && (
              <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--muted)' }}>
                {acceptedInfo.sos.patientName} · {acceptedInfo.sos.bloodGroup} · {acceptedInfo.sos.hospitalName}
              </p>
            )}
          </div>
          <a
            href={`tel:${acceptedInfo.requesterPhone}`}
            className="px-3 py-2 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 shrink-0 transition"
            style={{ background: 'var(--safe-ink)' }}
          >
            <PhoneCall className="w-3.5 h-3.5" />
            Call
          </a>
        </div>
      )}

      <div className="space-y-2.5">
        {openItems.map(item => (
          <div key={item.id} className="p-3 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-1.5 py-0.5 rounded text-xs font-mono font-bold text-white" style={{ background: 'var(--blood)' }}>{item.bloodGroup}</span>
                  <span className="text-xs font-bold font-sans truncate" style={{ color: 'var(--ink)' }}>{item.patientName}</span>
                </div>
                <p className="text-xs font-mono mt-1" style={{ color: 'var(--muted)' }}>
                  {item.hospitalName} · {item.city} · {item.unitsNeeded} unit{item.unitsNeeded > 1 ? 's' : ''}
                </p>
                <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--muted)' }}>
                  <Heart className="w-3 h-3 inline mr-0.5" style={{ color: 'var(--blood)' }} />
                  Requester:{' '}
                  <span className="font-bold" style={{ color: 'var(--ink)' }}>{item.requesterPhone}</span>
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => handleAccept(item.id)}
                disabled={busyId === item.id}
                className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1 transition disabled:opacity-50"
                style={{ background: 'var(--safe-ink)' }}
              >
                {busyId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Accept & Share My Number
              </button>
              <button
                onClick={() => handleDecline(item.id)}
                disabled={busyId === item.id}
                className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition disabled:opacity-50"
                style={{ background: 'rgba(196,18,48,0.06)', border: '1px solid rgba(196,18,48,0.25)', color: 'var(--blood)' }}
              >
                <XCircle className="w-3 h-3" />
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>

      {loaded && !loadError && openItems.length === 0 && !acceptedInfo && (
        <ListState
          kind="empty"
          title="No open requests right now"
          sub="When a patient in your city needs your blood group, their request appears here. Just opened the app? Tap refresh."
          actionLabel="Refresh"
          onAction={loadInbox}
          className="py-6"
        />
      )}

      {error && <p className="text-xs mt-2 font-sans" style={{ color: 'var(--danger-text)' }}>{error}</p>}
      {!loaded && (
        <div className="space-y-2.5" aria-hidden="true">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      )}
      {loaded && loadError && (
        <ListState
          kind="error"
          title="Couldn't load your requests."
          sub="Check your connection and try again."
          actionLabel="Try again"
          onAction={loadInbox}
          className="py-6"
        />
      )}
    </div>
  );
}
