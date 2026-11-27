import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Badge from "./ui/Badge";
import {
  Activity,
  AlertTriangle,
  Building2,
  Check,
  Download,
  KeyRound,
  Laptop,
  ScrollText,
  ShieldCheck,
  Trash2,
  X,
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
  // P3a-6: soft auto-flags from keyword scanning (fake/test-looking content).
  flaggedBySystem?: { at: string; reasons: string[] };
}

interface BlockedPhone {
  phone: string;
  at: string;
  actor?: string;
  reason?: string;
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

// P3a-8: the admin's own account security state. The TOTP secret never
// appears here — only whether it's on, and the devices that have signed in.
interface SecurityDevice {
  id: string;
  label: string;
  firstSeen: string;
  lastSeen: string;
}

interface SecurityState {
  totpEnabled: boolean;
  pendingEnrollment: boolean;
  recoveryCodesRemaining: number;
  devices: SecurityDevice[];
}

type Tab = "overview" | "reported" | "organizations" | "audit" | "security";

export default function AdminPanel({ onDataChanged }: { onDataChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [reported, setReported] = useState<ReportedSos[]>([]);
  const [blocked, setBlocked] = useState<BlockedPhone[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [security, setSecurity] = useState<SecurityState | null>(null);
  const [error, setError] = useState("");
  // P3a-8 enrollment wizard state: off → (enroll) → codes.
  const [totpSetup, setTotpSetup] = useState<{ qr: string; secret: string; codes: string[] } | null>(null);
  const [totpConfirm, setTotpConfirm] = useState("");
  const [totpDisableCode, setTotpDisableCode] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [m, r, b, o, a, s] = await Promise.all([
        fetch(`${API_BASE}/api/admin/metrics`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/reported`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/blocked`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/orgs`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/audit`, { credentials: "include" }),
        fetch(`${API_BASE}/api/admin/security`, { credentials: "include" }),
      ]);
      if (m.ok) setMetrics(await m.json());
      if (r.ok) setReported(await r.json());
      if (b.ok) setBlocked(await b.json());
      if (o.ok) setOrgs(await o.json());
      if (a.ok) setAudit(((await a.json()) as AuditEntry[]).slice(0, 25));
      if (s.ok) setSecurity(await s.json());
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

  // P3a-6: one tap blocks the requester's phone AND removes everything they
  // posted. Reversible from the blocked-numbers list below.
  const handleBlock = (id: string) =>
    act(() => fetch(`${API_BASE}/api/admin/reported/${id}/block`, { method: "POST", credentials: "include" }));

  const handleUnblock = (phone: string) =>
    act(() => fetch(`${API_BASE}/api/admin/blocked/${encodeURIComponent(phone)}/unblock`, { method: "POST", credentials: "include" }));

  const handleOrgDecision = (id: string, decision: "approve" | "reject") =>
    act(() => fetch(`${API_BASE}/api/admin/orgs/${id}/${decision}`, { method: "POST", credentials: "include" }));

  // P3a-8 two-step verification wizard + device management.
  const handleTotpEnroll = () =>
    act(async () => {
      const res = await fetch(`${API_BASE}/api/admin/security/totp/enroll`, { method: "POST", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setTotpSetup({ qr: data.qrDataUrl, secret: data.secret, codes: [] });
      }
      return res;
    });

  const handleTotpConfirm = () =>
    act(async () => {
      const res = await fetch(`${API_BASE}/api/admin/security/totp/enroll/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: totpConfirm }),
      });
      if (res.ok) {
        const data = await res.json();
        setTotpConfirm("");
        setTotpSetup((prev) => (prev ? { ...prev, codes: data.recoveryCodes || [] } : prev));
      }
      return res;
    });

  const handleTotpDisable = () =>
    act(async () => {
      const res = await fetch(`${API_BASE}/api/admin/security/totp/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: totpDisableCode }),
      });
      if (res.ok) {
        setTotpDisableCode("");
        setTotpSetup(null);
      }
      return res;
    });

  const handleForgetDevice = (id: string) =>
    act(() => fetch(`${API_BASE}/api/admin/security/devices/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }));

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setError("");
    } catch {
      setError("Couldn't copy — select the text and copy it manually.");
    }
  };

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
    { id: "security", label: "Security", icon: KeyRound },
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
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
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
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition ${tab === id ? 'bg-card text-blood shadow-1' : 'text-muted'}`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {label}
            {count !== undefined && count > 0 && (
              <span className="min-w-4 h-4 px-1 rounded-full flex items-center justify-center text-xs font-mono font-bold text-white" style={{ background: 'var(--blood)' }}>
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
            <div className="text-xs font-mono font-bold tracking-widest uppercase opacity-80">North Star · units delivered</div>
            <div className="font-display font-black text-3xl mt-1">{metrics.northStar.unitsDeliveredReal}</div>
            <div className="text-xs mt-1 opacity-90">
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
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Median time-to-first-contact (from real accepted donor responses): {formatMs(metrics.medianTimeToFirstContactMs)}.
          </p>
        </div>
      )}

      {/* REPORTED — moderation queue */}
      {tab === "reported" && (
        <div className="space-y-2.5">
          {reported.length === 0 && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--muted)' }}>No reported or auto-flagged requests — the queue is clear.</p>
          )}
          {reported.map(sos => (
            <div key={sos.id} className="p-3.5 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--warn)' }}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-display font-black shrink-0" style={{ background: 'var(--blood)' }}>
                  {sos.bloodGroup}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{sos.patientName}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>
                    {sos.hospitalName || "Hospital not specified"} · {sos.status} · requester {sos.contactPhone}
                  </div>
                </div>
                {sos.reports.length > 0 && (
                  <Badge tone="warn" icon={<AlertTriangle className="w-3 h-3" />}>{sos.reports.length} report{sos.reports.length === 1 ? "" : "s"}</Badge>
                )}
                {sos.flaggedBySystem && (
                  <Badge tone="blood" icon={<AlertTriangle className="w-3 h-3" />}>auto-flagged</Badge>
                )}
              </div>
              {sos.flaggedBySystem && (
                <p className="mb-2 text-xs" style={{ color: 'var(--warn-ink)' }}>
                  System scan: {sos.flaggedBySystem.reasons.join(" · ")} — content still posted publicly; review it here.
                </p>
              )}
              <ul className="mb-3 space-y-1">
                {sos.reports.map((r, i) => (
                  <li key={i} className="text-xs" style={{ color: 'var(--warn-ink)' }}>
                    “{r.reason}” <span className="opacity-60">— {new Date(r.at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Check className="w-3.5 h-3.5" />} onClick={() => handleDismiss(sos.id)}>
                  Looks legitimate — clear reports
                </Button>
                <Button size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => handleDeleteSos(sos.id)}>
                  Remove request
                </Button>
                <Button size="sm" variant="danger" icon={<ShieldCheck className="w-3.5 h-3.5" />} onClick={() => handleBlock(sos.id)}>
                  Block number
                </Button>
              </div>
            </div>
          ))}

          {/* P3a-6: blocked numbers with a one-tap reversal */}
          <div className="pt-2">
            <h3 className="text-xs font-display font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
              <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--blood)' }} aria-hidden="true" />
              Blocked numbers ({blocked.length})
            </h3>
            {blocked.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>No blocked numbers. Use “Block number” on a queue entry to stop a spammer from posting again.</p>
            )}
            {blocked.map(b => (
              <div key={b.phone} className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg border mb-1.5" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                <span className="font-mono text-xs font-bold flex-1" style={{ color: 'var(--ink)' }}>{b.phone}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>blocked {new Date(b.at).toLocaleDateString()}</span>
                <Button size="sm" variant="ghost" onClick={() => handleUnblock(b.phone)}>Unblock</Button>
              </div>
            ))}
          </div>
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
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
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
            <li key={e.id} className="text-xs p-2.5 rounded-lg flex items-start gap-2" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
              <span className="font-mono font-bold shrink-0" style={{ color: 'var(--ink)' }}>{e.action}</span>
              <span className="min-w-0 flex-1 truncate">{e.detail || ""}</span>
              <span className="font-mono shrink-0 opacity-70">{new Date(e.timestamp).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}

      {/* SECURITY — P3a-8: two-step verification + known devices */}
      {tab === "security" && security && (
        <div className="space-y-4">
          {/* Two-step verification status */}
          <div className="p-4 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4" style={{ color: security.totpEnabled ? 'var(--blood)' : 'var(--muted)' }} aria-hidden="true" />
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Two-step verification</span>
                {security.totpEnabled ? (
                  <Badge tone="blood">ON</Badge>
                ) : (
                  <Badge tone="neutral">OFF</Badge>
                )}
              </div>
              {!security.totpEnabled && !totpSetup && (
                <Button size="sm" icon={<ShieldCheck className="w-3.5 h-3.5" />} onClick={handleTotpEnroll}>
                  Set it up
                </Button>
              )}
            </div>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
              {security.totpEnabled
                ? `Even if someone gets your phone's OTP, they still can't reach the admin panel without your authenticator app. ${security.recoveryCodesRemaining} of 8 recovery codes left — keep them somewhere safe.`
                : "Your admin account is protected only by the SMS code right now. A second factor (Google Authenticator or any TOTP app) stops a SIM-swap from reaching this panel."}
            </p>

            {/* Enrollment wizard */}
            {totpSetup && !security.totpEnabled && (
              <div className="mt-3 space-y-3">
                {totpSetup.codes.length === 0 ? (
                  <>
                    <div className="flex flex-col sm:flex-row gap-4 items-start">
                      <img
                        src={totpSetup.qr}
                        alt="QR code to add BloodRadar to your authenticator app"
                        className="w-44 h-44 rounded-lg border bg-white p-1.5"
                        style={{ borderColor: 'var(--border)' }}
                      />
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>
                          Scan this with Google Authenticator (or any TOTP app), or type the secret in manually:
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs p-2 rounded-lg flex-1 truncate" style={{ background: 'var(--surface-2)', color: 'var(--ink)' }}>
                            {totpSetup.secret}
                          </code>
                          <Button size="sm" variant="secondary" onClick={() => copyText(totpSetup.secret)}>
                            Copy
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            id="totp-confirm-code"
                            label="Confirm with the app's 6-digit code"
                            placeholder="123456"
                            inputMode="numeric"
                            value={totpConfirm}
                            onChange={(e) => setTotpConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          />
                          <div className="pt-5">
                            <Button size="md" disabled={totpConfirm.length !== 6} onClick={handleTotpConfirm}>
                              Activate
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-3 rounded-xl border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                      Two-step verification is ON. Save these 8 recovery codes now — they're shown exactly once.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2">
                      {totpSetup.codes.map(c => (
                        <code key={c} className="font-mono text-xs p-1.5 rounded text-center" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
                          {c}
                        </code>
                      ))}
                    </div>
                    <Button size="sm" variant="secondary" className="mt-2" onClick={() => copyText(totpSetup.codes.join("\n"))}>
                      Copy all
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Disable (needs a live code — a stolen session alone can't do it) */}
            {security.totpEnabled && (
              <div className="mt-3 flex items-end gap-2 flex-wrap">
                <Input
                  id="totp-disable-code"
                  label="Current app code"
                  placeholder="123456"
                  inputMode="numeric"
                  value={totpDisableCode}
                  onChange={(e) => setTotpDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <Button size="md" variant="secondary" disabled={totpDisableCode.length !== 6} onClick={handleTotpDisable}>
                  Turn off two-step
                </Button>
              </div>
            )}
          </div>

          {/* Known devices */}
          <div className="p-4 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Laptop className="w-4 h-4" style={{ color: 'var(--muted)' }} aria-hidden="true" />
              <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Devices that signed in</span>
            </div>
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
              A sign-in from a device not on this list triggers an alert to your phone. Forget a device if you no longer use it.
            </p>
            {security.devices.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>No devices recorded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {security.devices.map(d => (
                  <li key={d.id} className="text-xs p-2.5 rounded-lg flex items-center gap-2" style={{ background: 'var(--surface-2)' }}>
                    <span className="font-mono font-bold shrink-0" style={{ color: 'var(--ink)' }}>{d.id.slice(0, 8)}…</span>
                    <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--muted)' }}>{d.label}</span>
                    <span className="font-mono shrink-0 opacity-70" style={{ color: 'var(--muted)' }}>
                      {new Date(d.lastSeen).toLocaleString()}
                    </span>
                    <button
                      className="shrink-0 p-1 rounded transition hover:opacity-70"
                      style={{ color: 'var(--blood)' }}
                      onClick={() => handleForgetDevice(d.id)}
                      aria-label={`Forget device ${d.id.slice(0, 8)}`}
                      title="Forget this device"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
