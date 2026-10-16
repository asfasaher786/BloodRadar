import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import type { Hospital } from "../types";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Badge from "./ui/Badge";
import {
  Building2,
  CheckCircle2,
  Clock,
  HeartHandshake,
  RefreshCw,
  ShieldCheck,
  XCircle,
  Phone,
} from "lucide-react";

// Organization portal (Phase 3, lightweight). A verified phone applies as an
// NGO or hospital organization; an admin approves it. Approved orgs post SOS
// on behalf of patients, close their own requests, and (hospitals only)
// update their blood bank's stock. Every state is a real state — no fake
// buttons, no invented data. English-only, like the rest of the app.

const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];
const STOCK_LEVELS = ["In Stock", "Low", "Critical", "Out of Stock"];
const URGENCIES = ["Immediate (SOS)", "Urgent", "Routine"];

interface OrgRecord {
  id: string;
  name: string;
  type: "ngo" | "hospital";
  city: string;
  hospitalId?: string;
  hospitalName?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface OrgSos {
  id: string;
  patientName: string;
  bloodGroup: string;
  unitsNeeded: number;
  hospitalName: string;
  status: "Pending" | "Fulfilled" | "Cancelled";
  requiredBy?: string;
  createdAt: string;
}

interface Props {
  lang: "en";
  hospitals: Hospital[];
  /** Called after any data-changing action so the public board/hospital list refresh. */
  onDataChanged: () => void;
}

export default function OrgPortal({ lang, hospitals, onDataChanged }: Props) {
  // Session + org state.
  const [me, setMe] = useState<{ phone: string; role: string } | null | "loading">("loading");
  const [org, setOrg] = useState<OrgRecord | null>(null);
  const [orgError, setOrgError] = useState("");

  // Login (OTP).
  const [loginPhone, setLoginPhone] = useState("");
  const [otpStage, setOtpStage] = useState<"idle" | "sent">("idle");
  const [otpCode, setOtpCode] = useState("");
  const [devOtpHint, setDevOtpHint] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Application form.
  const [appName, setAppName] = useState("");
  const [appType, setAppType] = useState<"ngo" | "hospital">("ngo");
  const [appCity, setAppCity] = useState("Islamabad");
  const [appHospitalId, setAppHospitalId] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");

  // Post-on-behalf form.
  const [sosPatient, setSosPatient] = useState("");
  const [sosGroup, setSosGroup] = useState("O+");
  const [sosUnits, setSosUnits] = useState(1);
  const [sosHospitalId, setSosHospitalId] = useState("");
  const [sosPhone, setSosPhone] = useState("");
  const [sosReason, setSosReason] = useState("");
  const [sosUrgency, setSosUrgency] = useState("Immediate (SOS)");
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Own requests.
  const [ownRequests, setOwnRequests] = useState<OrgSos[]>([]);
  const [closingId, setClosingId] = useState<string | null>(null);

  // Stock (hospital orgs).
  const [stock, setStock] = useState<Record<string, string>>({});
  const [stockSaving, setStockSaving] = useState(false);
  const [stockMsg, setStockMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadSession = useCallback(async () => {
    setOrgError("");
    try {
      const meRes = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
      if (meRes.ok) {
        const data = await meRes.json();
        const initialRole = data.user?.role || "donor";
        setMe({ phone: data.user?.phone || "", role: initialRole });
      } else {
        setMe(null);
        setOrg(null);
        return;
      }
      const orgRes = await fetch(`${API_BASE}/api/orgs/me`, { credentials: "include" });
      if (orgRes.ok) {
        const data = await orgRes.json();
        setOrg(data.org || null);
        // Approval may have happened while this session was open: the JWT
        // still says "donor", but an approved org record grants the role.
        // Refresh the session so portal actions actually work.
        if (data.org?.status === "approved" && data.org.contactPhone) {
          const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: "POST",
            credentials: "include",
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            setMe({ phone: refreshData.user?.phone || "", role: refreshData.user?.role || "donor" });
          }
        }
      }
    } catch {
      setMe(null);
      setOrg(null);
    }
  }, []);

  const loadOwnRequests = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/orgs/requests`, { credentials: "include" });
      if (res.ok) {
        setOwnRequests((await res.json()) as OrgSos[]);
      }
    } catch {
      // Silent: the portal stays usable; the list just won't refresh.
    }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Load own requests once the org is approved.
  useEffect(() => {
    const role = me && me !== "loading" ? me.role : null;
    if (org?.status === "approved" && (role === "ngo" || role === "hospital_staff")) {
      loadOwnRequests();
    } else {
      setOwnRequests([]);
    }
  }, [org, me, loadOwnRequests]);

  // Pre-fill the hospital select and stock map when a hospital org is approved.
  useEffect(() => {
    if (org?.status === "approved" && org.type === "hospital" && org.hospitalId) {
      const hospital = hospitals.find(h => h.id === org.hospitalId);
      if (hospital) {
        setStock({ ...hospital.bloodAvailability });
        if (!sosHospitalId) setSosHospitalId(hospital.id);
      }
    }
  }, [org, hospitals, sosHospitalId]);

  const handleSendOtp = async () => {
    setLoginBusy(true);
    setLoginError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loginPhone }),
      });
      const data = await res.json();
      if (res.ok) {
        setOtpStage("sent");
        setDevOtpHint(data.devOtp || "");
      } else {
        setLoginError(data.error || "Couldn't send the verification code. Try again.");
      }
    } catch {
      setLoginError("Network error. Please try again.");
    } finally {
      setLoginBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.trim().length !== 6) return;
    setLoginBusy(true);
    setLoginError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: loginPhone, code: otpCode.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setOtpStage("idle");
        setOtpCode("");
        setDevOtpHint("");
        await loadSession();
        // The parent app tracks the session role (e.g. to show the Admin
        // Dashboard). Tell it to re-fetch /api/auth/me with the new cookies.
        onDataChanged();
      } else {
        setLoginError(data.error || "Incorrect code. Try again.");
      }
    } catch {
      setLoginError("Network error. Try again.");
    } finally {
      setLoginBusy(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setApplyError("");
    try {
      const res = await fetch(`${API_BASE}/api/orgs/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: appName,
          type: appType,
          city: appCity,
          hospitalId: appType === "hospital" ? appHospitalId : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setOrg(data.org);
      } else if (res.status === 409 && data.org) {
        // One org per phone: surface the existing application honestly.
        setOrg(data.org);
      } else {
        setApplyError(data.error || "Couldn't submit the application.");
      }
    } catch {
      setApplyError("Network error. Please try again.");
    } finally {
      setApplying(false);
    }
  };

  const handlePostSos = async () => {
    setPosting(true);
    setPostMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/emergencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          patientName: sosPatient,
          bloodGroup: sosGroup,
          unitsNeeded: sosUnits,
          hospitalId: sosHospitalId || undefined,
          contactPhone: sosPhone,
          reason: sosReason,
          urgency: sosUrgency,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPostMsg({ ok: true, text: `Request posted under ${org?.name} — donors are being matched.` });
        setSosPatient("");
        setSosReason("");
        setSosPhone("");
        loadOwnRequests();
        onDataChanged();
      } else {
        setPostMsg({ ok: false, text: data.error || "Couldn't post the request." });
      }
    } catch {
      setPostMsg({ ok: false, text: "Network error. Please try again." });
    } finally {
      setPosting(false);
    }
  };

  const handleCloseRequest = async (id: string, status: "Fulfilled" | "Cancelled") => {
    setClosingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/emergencies/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        loadOwnRequests();
        onDataChanged();
      }
    } catch {
      // Silent: the button stays actionable; the next refresh shows the truth.
    } finally {
      setClosingId(null);
    }
  };

  const handleSaveStock = async () => {
    if (!org?.hospitalId) return;
    setStockSaving(true);
    setStockMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/hospitals/${org.hospitalId}/stock`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ availability: stock }),
      });
      const data = await res.json();
      if (res.ok) {
        setStockMsg({ ok: true, text: `Stock saved — last reviewed today. The public directory now shows your update.` });
        onDataChanged();
      } else {
        setStockMsg({ ok: false, text: data.error || "Couldn't save the stock update." });
      }
    } catch {
      setStockMsg({ ok: false, text: "Network error. Please try again." });
    } finally {
      setStockSaving(false);
    }
  };

  const header = (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div>
        <h2 className="font-display font-bold text-sm flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <Building2 className="w-4 h-4" style={{ color: 'var(--blood)' }} aria-hidden="true" />
          Organization Portal
        </h2>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
          For NGOs and hospital blood banks. Every organization is verified by a BloodRadar admin before it can act.
        </p>
      </div>
      {org?.status === "approved" && <Badge tone="safe" icon={<ShieldCheck className="w-3 h-3" />}>Verified</Badge>}
      {org?.status === "pending" && <Badge tone="warn" icon={<Clock className="w-3 h-3" />}>In review</Badge>}
      {org?.status === "rejected" && <Badge tone="blood" icon={<XCircle className="w-3 h-3" />}>Declined</Badge>}
    </div>
  );

  return (
    <div id="org-portal" className="rounded-2xl border p-5 shadow-sm" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      {header}

      {/* NOT LOGGED IN — phone OTP login (the verified phone IS the org account). */}
      {me === null && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            Organization accounts are tied to a verified phone number. Log in first — your phone is verified with a one-time code.
          </p>
          {otpStage === "idle" ? (
            <>
              <Input
                label="Phone number"
                placeholder="+92 3xx xxxxxxx"
                value={loginPhone}
                onChange={(e) => setLoginPhone(e.target.value)}
                icon={<Phone className="w-4 h-4" />}
              />
              <Button size="sm" onClick={handleSendOtp} loading={loginBusy} disabled={loginPhone.trim().length < 7} fullWidth>
                Send verification code
              </Button>
            </>
          ) : (
            <>
              <Input
                label="Verification code"
                hint="6 digits, sent to your phone"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
              />
              {devOtpHint && (
                <p className="text-[10px] font-mono" role="note" style={{ color: 'var(--warn-ink)' }}>
                  Test mode — your code is {devOtpHint}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleVerifyOtp} loading={loginBusy} disabled={otpCode.trim().length !== 6} fullWidth>
                  Verify &amp; continue
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setOtpStage("idle"); setDevOtpHint(""); }}>Back</Button>
              </div>
            </>
          )}
          {loginError && <p className="text-xs" role="alert" style={{ color: 'var(--blood)' }}>{loginError}</p>}
        </div>
      )}

      {/* LOGGED IN, NO ORG — application form. */}
      {me !== null && me !== "loading" && !org && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            Apply to post requests on behalf of patients{appType === "hospital" ? " and manage your blood bank's stock" : ""}.
            An admin reviews every application before it goes live.
          </p>
          <Input
            label="Organization name"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="e.g. Red Crescent Unit Islamabad"
          />
          <Select label="Organization type" value={appType} onChange={(e) => setAppType(e.target.value as "ngo" | "hospital")}>
            <option value="ngo">NGO / welfare organization</option>
            <option value="hospital">Hospital blood bank</option>
          </Select>
          <Select label="City" value={appCity} onChange={(e) => setAppCity(e.target.value)}>
            <option value="Islamabad">Islamabad</option>
            <option value="Rawalpindi">Rawalpindi</option>
          </Select>
          {appType === "hospital" && (
            <Select
              label="Your hospital"
              hint="This link is what authorizes your stock updates"
              value={appHospitalId}
              onChange={(e) => setAppHospitalId(e.target.value)}
            >
              <option value="">Select from the directory…</option>
              {hospitals.map(h => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </Select>
          )}
          <Button
            size="sm"
            onClick={handleApply}
            loading={applying}
            disabled={appName.trim().length < 2 || (appType === "hospital" && !appHospitalId)}
            fullWidth
          >
            Submit application
          </Button>
          {applyError && <p className="text-xs" role="alert" style={{ color: 'var(--blood)' }}>{applyError}</p>}
        </div>
      )}

      {/* PENDING / REJECTED STATUS. */}
      {org && org.status === "pending" && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-xl bg-warn-soft border border-warn/40" role="status">
            <p className="text-xs leading-relaxed text-warn-ink">
              <span className="font-bold">{org.name}</span> is awaiting admin approval.
              A BloodRadar admin verifies every organization before it can post requests or update stock — this keeps the
              board trustworthy. Check back later.
            </p>
          </div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={loadSession}>
            Check status again
          </Button>
        </div>
      )}

      {org && org.status === "rejected" && (
        <div className="p-3.5 rounded-xl bg-blood-soft border border-blood/30" role="status">
          <p className="text-xs leading-relaxed text-blood-ink">
            The application for <span className="font-bold">{org.name}</span> was declined. One organization per phone
            number — to discuss, please contact the BloodRadar team directly.
          </p>
        </div>
      )}

      {/* APPROVED — portal actions. */}
      {org && org.status === "approved" && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--safe-ink)' }}>
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              {org.name} is verified{org.hospitalName ? ` · ${org.hospitalName}` : ""} · {org.city}
            </span>
          </div>

          {/* Stock panel — hospital orgs only (master prompt: verified blood banks only). */}
          {org.type === "hospital" && org.hospitalId && (
            <div className="p-4 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <h3 className="font-display font-bold text-xs mb-1" style={{ color: 'var(--ink)' }}>
                Blood-bank stock — {org.hospitalName}
              </h3>
              <p className="text-[10px] mb-3" style={{ color: 'var(--muted)' }}>
                Every save stamps today's date on the public directory. Update only what changed.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {BLOOD_GROUPS.map(g => (
                  <div key={g} className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs w-8 shrink-0" style={{ color: 'var(--ink)' }}>{g}</span>
                    <select
                      aria-label={`${g} stock level`}
                      value={stock[g] || "In Stock"}
                      onChange={(e) => setStock(prev => ({ ...prev, [g]: e.target.value }))}
                      className="flex-1 h-8 px-2 rounded-lg bg-card border border-border text-[11px] text-ink cursor-pointer"
                    >
                      {STOCK_LEVELS.map(level => (
                        <option key={level} value={level}>{level}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <Button size="sm" className="mt-3" onClick={handleSaveStock} loading={stockSaving} fullWidth>
                Save stock update
              </Button>
              {stockMsg && (
                <p className={`text-[11px] mt-2 ${stockMsg.ok ? 'text-safe-ink' : 'text-blood'}`} role={stockMsg.ok ? "status" : "alert"}>
                  {stockMsg.text}
                </p>
              )}
            </div>
          )}

          {/* Post on behalf of a patient. */}
          <div className="p-4 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <h3 className="font-display font-bold text-xs mb-1 flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
              <HeartHandshake className="w-3.5 h-3.5" style={{ color: 'var(--blood)' }} aria-hidden="true" />
              Post a request on behalf of a patient
            </h3>
            <p className="text-[10px] mb-3" style={{ color: 'var(--muted)' }}>
              The request appears on the public board labelled with {org.name} so donors know a verified organization vouches for it.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Input label="Patient name" value={sosPatient} onChange={(e) => setSosPatient(e.target.value)} placeholder="Patient's name" />
              <Select label="Blood group" value={sosGroup} onChange={(e) => setSosGroup(e.target.value)}>
                {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
              </Select>
              <Select label="Units needed" value={String(sosUnits)} onChange={(e) => setSosUnits(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}
              </Select>
              <Select label="Hospital" value={sosHospitalId} onChange={(e) => setSosHospitalId(e.target.value)}>
                {org.type === "hospital" && org.hospitalId
                  ? <option value={org.hospitalId}>{org.hospitalName}</option>
                  : (
                    <>
                      <option value="">Select hospital…</option>
                      {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </>
                  )}
              </Select>
              <Input label="Contact phone for donors" value={sosPhone} onChange={(e) => setSosPhone(e.target.value)} placeholder="+92 3xx xxxxxxx" icon={<Phone className="w-4 h-4" />} />
              <Select label="Urgency" value={sosUrgency} onChange={(e) => setSosUrgency(e.target.value)}>
                {URGENCIES.map(u => <option key={u} value={u}>{u}</option>)}
              </Select>
              <div className="sm:col-span-2">
                <Input label="Reason" optional value={sosReason} onChange={(e) => setSosReason(e.target.value)} placeholder="e.g. Surgery scheduled, accident trauma…" />
              </div>
            </div>
            <Button
              size="sm"
              className="mt-3"
              onClick={handlePostSos}
              loading={posting}
              disabled={sosPatient.trim().length < 2 || sosPhone.trim().length < 7 || !sosHospitalId}
              fullWidth
            >
              Post request
            </Button>
            {postMsg && (
              <p className={`text-[11px] mt-2 ${postMsg.ok ? 'text-safe-ink' : 'text-blood'}`} role={postMsg.ok ? "status" : "alert"}>
                {postMsg.text}
              </p>
            )}
          </div>

          {/* Own requests. */}
          <div>
            <h3 className="font-display font-bold text-xs mb-2" style={{ color: 'var(--ink)' }}>
              {org.name}'s requests ({ownRequests.length})
            </h3>
            {ownRequests.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                No requests posted yet. Requests you post appear here — close them once the blood arrives.
              </p>
            ) : (
              <ul className="space-y-2">
                {ownRequests.map(sos => (
                  <li key={sos.id} className="p-3 rounded-xl border flex flex-wrap items-center gap-2" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-display font-black shrink-0" style={{ background: 'var(--blood)' }}>
                      {sos.bloodGroup}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>{sos.patientName}</div>
                      <div className="text-[10px]" style={{ color: 'var(--muted)' }}>{sos.hospitalName}</div>
                    </div>
                    {sos.status === "Pending" ? (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="success" loading={closingId === sos.id} onClick={() => handleCloseRequest(sos.id, "Fulfilled")}>
                          Mark Fulfilled
                        </Button>
                        <Button size="sm" variant="ghost" loading={closingId === sos.id} onClick={() => handleCloseRequest(sos.id, "Cancelled")}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Badge tone={sos.status === "Fulfilled" ? "safe" : "neutral"}>{sos.status}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {orgError && <p className="text-xs mt-3" role="alert" style={{ color: 'var(--blood)' }}>{orgError}</p>}
    </div>
  );
}
