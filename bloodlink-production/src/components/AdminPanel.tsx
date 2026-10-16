import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import Button from "./ui/Button";
import Badge from "./ui/Badge";
import {
  Activity,
  AlertTriangle,
  Building2,
  Download,
  ScrollText,
  ShieldCheck,
  Trash2,
  X,
  Check,
} from "lucide-react";

// Admin dashboard (Phase 3). Only rendered for role "admin". Shows the
// North Star metric (units delivered — real vs sample, never fabricated),
// the moderation queue of reported SOS, organization applications to
// approve/reject, the audit trail, and an anonymized CSV export.
// Every number comes from the live database; every button does a real thing.

interface Metrics {
  northStar: {
    unitsDeliveredReal: number;
    unitsDeliveredIncludingSample: number;
    fulfilledReal: number;
    fulfilledIncludingSample: number;
  };
  activity: {
    pendingSos: number;
    totalDonors: number;
    donorsIncludingSample: number;
    pendingOrgApplications: number;
    approvedOrganizations: number;
  };
  medianTimeToFirstContactMs: number | null;
}

interface ReportedSos {
  id: string;
  patientName: string;
  bloodGroup: string;
  hospitalName?: string;
  contactPhone: string;
  status: string;
  createdAt: string;
  reports: { at: string; reason: string }[];
}

interface Org {
  id: string;
  name: string;
  type: "ngo" | "hospital";
  city: string;
  hospitalName?: string;
  contactPhone: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actor?: string;
  sosId?: string;
  detail?: string;
  timestamp: string;
}

type Tab = "overview" | "reported" | "organizations" | "audit";

export default function AdminPanel({ onDataChanged }: { onDataChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [reported, setReported] = useState<ReportedSos[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [m, r, o, a] = await Promise.all([
        fetch(`${API_BASE}/api/admin/metrics`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/reported`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/orgs`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/audit`, { credentials: "include" }),
      ]);
      if (m.ok) setMetrics(await m.json());
      if (r.ok) setReported(await r.json());
      if (o.ok) setOrgs(await o.json());
      if (a.ok) setAudit(((await a.json()) as AuditEntry[]).slice(0, 25));
    } catch {
      setError("Couldn't load the admin dashboard. Try again.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<Response>) => {
    try {
      const res = await fn();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Action failed.");
      }
      await load();
      onDataChanged();
    } catch {
      setError("Network error. Please try again.");
    }
  };

  const handleDeleteSos = (id: string) =>
    act(() => fetch(`${API_BASE}/api/emergencies/${id}`, { method: "DELETE", credentials: "include" }));

  const handleDismiss = (id: string) =>
    act(() => fetch(`${API_BASE}/api/admin/reported/${id}/dismiss`, { method: "POST", credentials: "include" }));

  const handleOrgDecision = (id: string, decision: "approve" | "reject") =>
    act(() => fetch(`${API_BASE}/api/admin/orgs/${id}/${decision}`, { method: "POST", credentials: "include" }));

  const handleExport = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/export.csv`, { credentials: "include" });
      if (!res.ok) {
        setError("Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bloodradar-sos-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed. Try again.");
    }
  };

  const TABS: { id: Tab; label: string; icon: typeof Activity; count?: number }[] = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "reported", label: "Reported", icon: AlertTriangle, count: reported.length },
    { id: "organizations", label: "Organizations", icon: Building2, count: orgs.filter(o => o.status === "pending").length },
    { id: "audit", label: "Audit log", icon: ScrollText },
  ];

  const formatMs = (ms: number | null) => {
    if (ms === null || ms === undefined) return "No real data yet — shows null honestly";
    if (ms < 60000) return `${Math.round(ms / 1000)} seconds`;
    return `${Math.round(ms / 60000)} minutes`;
  };

  return (
    <div id="admin-panel" className="rounded-2xl border p-5 shadow-sm" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display font-bold text-sm flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <ShieldCheck className="w-4 h-4" style={{ color: 'var(--blood)' }} aria-hidden="true" />
            Admin Dashboard
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
            Moderation, organization approvals, the North Star metric and honest exports — admin-only.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={<Download className="w-3.5 h-3.5" />} onClick={handleExport}>
          Export CSV
        </Button>
      </div>

      {error && <p className="text-xs mb-3" role="alert" style={{ color: 'var(--blood)' }}>{error}</p>}

      {/* Tabs */}
      <div role="tablist" aria-label="Admin sections" className="flex gap-1 p-1.5 rounded-xl border mb-4" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
        {TABS.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition ${tab === id ? 'bg-card text-blood shadow-1' : 'text-muted'}`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {label}
            {count !== undefined && count > 0 && (
              <span className="min-w-4 h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-mono font-bold text-white" style={{ background: 'var(--blood)' }}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* OVERVIEW — North Star */}
      {tab === "overview" && metrics && (
        <div className="space-y-3">
          <div className="p-4 rounded-xl" style={{ background: 'var(--blood)', color: 'white' }}>
            <div className="text-[10px] font-mono font-bold tracking-widest uppercase opacity-80">North Star · units delivered</div>
            <div className="font-display font-black text-3xl mt-1">{metrics.northStar.unitsDeliveredReal}</div>
            <div className="text-[11px] mt-1 opacity-90">
              units of blood delivered through fulfilled requests (real records only).
              {metrics.northStar.unitsDeliveredIncludingSample !== metrics.northStar.unitsDeliveredReal && (
                <> Including sample data: <span className="font-bold">{metrics.northStar.unitsDeliveredIncludingSample}</span>.</>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: "Fulfilled requests (real)", value: String(metrics.northStar.fulfilledReal) },
              { label: "Pending SOS", value: String(metrics.activity.pendingSos) },
              { label: "Donors (real / incl. sample)", value: `${metrics.activity.totalDonors} / ${metrics.activity.donorsIncludingSample}` },
              { label: "Approved organizations", value: String(metrics.activity.approvedOrganizations) },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="font-display font-bold text-lg" style={{ color: 'var(--ink)' }}>{value}</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>{label}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            Median time-to-first-contact (from real accepted donor responses): {formatMs(metrics.medianTimeToFirstContactMs)}.
          </p>
        </div>
      )}

      {/* REPORTED — moderation queue */}
      {tab === "reported" && (
        <div className="space-y-2.5">
          {reported.length === 0 && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--muted)' }}>No reported requests — the queue is clear.</p>
          )}
          {reported.map(sos => (
            <div key={sos.id} className="p-3.5 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--warn)' }}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-display font-black shrink-0" style={{ background: 'var(--blood)' }}>
                  {sos.bloodGroup}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{sos.patientName}</div>
                  <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                    {sos.hospitalName || "Hospital not specified"} · {sos.status} · requester {sos.contactPhone}
                  </div>
                </div>
                <Badge tone="warn" icon={<AlertTriangle className="w-3 h-3" />}>{sos.reports.length} report{sos.reports.length === 1 ? "" : "s"}</Badge>
              </div>
              <ul className="mb-3 space-y-1">
                {sos.reports.map((r, i) => (
                  <li key={i} className="text-[10px]" style={{ color: 'var(--warn-ink)' }}>
                    “{r.reason}” <span className="opacity-60">— {new Date(r.at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<Check className="w-3.5 h-3.5" />} onClick={() => handleDismiss(sos.id)}>
                  Looks legitimate — clear reports
                </Button>
                <Button size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => handleDeleteSos(sos.id)}>
                  Remove request
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ORGANIZATIONS — approvals */}
      {tab === "organizations" && (
        <div className="space-y-2.5">
          {orgs.length === 0 && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--muted)' }}>No organization applications yet.</p>
          )}
          {orgs.map(org => (
            <div key={org.id} className="p-3.5 rounded-xl border flex flex-wrap items-center gap-2" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{org.name}</div>
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  {org.type === "hospital" ? "Hospital blood bank" : "NGO"} · {org.city}{org.hospitalName ? ` · ${org.hospitalName}` : ""} · owner {org.contactPhone}
                </div>
              </div>
              {org.status === "pending" ? (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="success" icon={<Check className="w-3.5 h-3.5" />} onClick={() => handleOrgDecision(org.id, "approve")}>
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost" icon={<X className="w-3.5 h-3.5" />} onClick={() => handleOrgDecision(org.id, "reject")}>
                    Reject
                  </Button>
                </div>
              ) : (
                <Badge tone={org.status === "approved" ? "safe" : "blood"}>{org.status}</Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* AUDIT */}
      {tab === "audit" && (
        <ul className="space-y-1.5 max-h-96 overflow-y-auto">
          {audit.map(e => (
            <li key={e.id} className="text-[10px] p-2.5 rounded-lg flex items-start gap-2" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
              <span className="font-mono font-bold shrink-0" style={{ color: 'var(--ink)' }}>{e.action}</span>
              <span className="min-w-0 flex-1 truncate">{e.detail || ""}</span>
              <span className="font-mono shrink-0 opacity-70">{new Date(e.timestamp).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
