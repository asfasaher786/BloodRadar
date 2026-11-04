import React, { useState, useEffect, useRef } from "react";
import { Hospital } from "../types";
import { API_BASE } from "../lib/api";
import {
  AlertCircle, Heart, Users, BellRing, CheckCircle2, PhoneCall,
  XCircle, Eye, Zap, Minus, Plus, Siren, Phone, Check,
  ChevronDown, Search, MessageCircle, HelpCircle, Building2, ShieldCheck,
  Clock
} from "lucide-react";
import { SUPPORTED_CITIES, DEFAULT_CITY } from "../lib/regions";
import Card from "./ui/Card";
import Button from "./ui/Button";
import Select from "./ui/Select";
import Badge from "./ui/Badge";
import Input from "./ui/Input";
import TopMatches from "./TopMatches";

interface SOSRequestFormProps {
  hospitals: Hospital[];
  onSuccess: () => void;
}

interface MySos {
  id: string;
  code: string;
  myPhone: string;
  request: any;
}

type RevealStatus = 'waiting' | 'donor-accepted' | 'fulfilled' | 'cancelled' | 'expired';
interface RevealState {
  status: RevealStatus;
  donor?: { name: string; bloodGroup: string; phone: string; city: string } | null;
  acceptedAt?: string;
}

const SOS_STORAGE_KEY = "bloodradar_my_sos";
// P0-1: the requester's phone proof — a 15-minute server-issued token that
// travels with the SOS POST. Cached per phone so a re-submit (or a second
// request for another patient) doesn't ask for a new code.
const PROOF_STORAGE_KEY = "bloodradar_requester_proof";
const PROOF_TTL_MS = 15 * 60 * 1000;

interface CachedProof {
  phone: string;
  token: string;
  expiresAt: number;
}

function readCachedProof(): CachedProof | null {
  try {
    const raw = localStorage.getItem(PROOF_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.phone !== "string" || typeof p.token !== "string" || typeof p.expiresAt !== "number") return null;
    return p as CachedProof;
  } catch { return null; }
}

function cacheProof(proof: CachedProof): void {
  try { localStorage.setItem(PROOF_STORAGE_KEY, JSON.stringify(proof)); } catch { /* storage full/blocked — proof lives only this session */ }
}

function clearCachedProof(): void {
  try { localStorage.removeItem(PROOF_STORAGE_KEY); } catch { /* ignore */ }
}

/** Valid proof for this exact phone string, with a 30s safety margin. */
function validProofTokenFor(phone: string): string | null {
  const p = readCachedProof();
  if (!p || p.phone !== phone) return null;
  if (Date.now() > p.expiresAt - 30_000) {
    clearCachedProof();
    return null;
  }
  return p.token;
}

const BLOOD_GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as const;
const HOTLINES = [
  { name: "Rescue 1122", number: "1122" },
  { name: "PIMS Islamabad", number: "+92 51 9261170" },
  { name: "Holy Family Rwp", number: "+92 51 9290321" },
  { name: "Shifa International", number: "+92 51 8463000" },
];

/** Strip non-digits; keep an optional leading 92 country code. */
function phoneDigits(p: string): string {
  return p.replace(/[^\d]/g, "");
}

export default function SOSRequestForm({ hospitals, onSuccess }: SOSRequestFormProps) {
  const [emergencyMode, setEmergencyMode] = useState(true);
  const [patientName, setPatientName] = useState("");
  const [bloodGroup, setBloodGroup] = useState<string>("O-");
  const [unitsNeeded, setUnitsNeeded] = useState(1);
  const [hospitalId, setHospitalId] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [reason, setReason] = useState("");
  const [urgency, setUrgency] = useState<'Immediate (SOS)' | 'Urgent' | 'Routine'>("Immediate (SOS)");
  const [city, setCity] = useState<string>(DEFAULT_CITY);
  const [submitPhase, setSubmitPhase] = useState<'idle' | 'loading' | 'success'>('idle');
  const [error, setError] = useState("");

  // P0-1 inline phone-verification stage. When the requester has no fresh
  // proof for their number, the form swaps to a "enter the code we texted"
  // step; verifying auto-submits the request that was waiting.
  const [verifyStage, setVerifyStage] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [devOtpHint, setDevOtpHint] = useState("");
  // Phone we already sent a code to this session. Re-entering the stage for
  // the SAME number keeps the existing code (and its hint) instead of
  // re-sending — the per-phone 60s cooldown would otherwise block resends.
  const [sentForPhone, setSentForPhone] = useState("");

  // Hospital combobox state.
  const [hospitalQuery, setHospitalQuery] = useState("");
  const [hospitalOpen, setHospitalOpen] = useState(false);
  const hospitalListRef = useRef<HTMLDivElement>(null);

  // Field-level validation (validate on blur, re-checked on submit).
  const [phoneError, setPhoneError] = useState("");
  const [groupError, setGroupError] = useState("");
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const groupChipsRef = useRef<HTMLFieldSetElement>(null);

  // Requester-side tracking of their live SOS. The requester identity is
  // their phone (proven by the P0-1 OTP proof) plus the one-time code the
  // server issued for this request. Survives page refresh via localStorage.
  const [mySos, setMySos] = useState<MySos | null>(null);
  const [reveal, setReveal] = useState<RevealState>({ status: 'waiting' });
  const [matchingCount, setMatchingCount] = useState<number | null>(null);
  const [notifiedCount, setNotifiedCount] = useState<number | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [closing, setClosing] = useState(false);
  const [panelMsg, setPanelMsg] = useState("");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore any SOS raised earlier in this browser (e.g. after refresh).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SOS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.code) setMySos(parsed);
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Poll the reveal endpoint while an SOS is active. It only returns the
  // donor's number to the holder of the one-time requester code.
  useEffect(() => {
    if (!mySos) return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/emergencies/${mySos.id}/reveal?code=${encodeURIComponent(mySos.code)}`);
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        if (data.status === "fulfilled") {
          setReveal({ status: 'donor-accepted', donor: data.donor || null, acceptedAt: data.acceptedAt });
          stopPolling();
        } else if (data.status === "expired") {
          // P0-5: the SOS silently closed after 48h. Keep polling — if it's
          // re-opened (here or on another device) the panel self-heals.
          setReveal((prev) => (prev.status === 'expired' ? prev : { status: 'expired' }));
        } else if (data.status === "waiting") {
          setReveal((prev) => (prev.status === 'expired' ? { status: 'waiting' } : prev));
        }
      } catch { /* transient network error — next poll retries */ }
    };
    check();
    pollTimer.current = setInterval(check, 15000);
    return () => { cancelled = true; stopPolling(); };
  }, [mySos?.id, mySos?.code]);

  // Instant reveal: when any donor accepts, the SSE event carries only the
  // sosId — if it's OUR sos, poll the reveal endpoint immediately.
  useEffect(() => {
    if (!mySos) return;
    const es = new EventSource(`${API_BASE}/api/events`);
    const onEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data && data.sosId === mySos.id) checkRevealNow();
      } catch { /* ignore malformed events */ }
    };
    es.addEventListener("contact-request-accepted", onEvent as EventListener);
    return () => es.close();
  }, [mySos?.id]);

  const checkRevealNow = async () => {
    if (!mySos) return;
    try {
      const response = await fetch(`${API_BASE}/api/emergencies/${mySos.id}/reveal?code=${encodeURIComponent(mySos.code)}`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.status === "fulfilled") {
        setReveal({ status: 'donor-accepted', donor: data.donor || null, acceptedAt: data.acceptedAt });
        stopPolling();
      } else if (data.status === "expired") {
        setReveal((prev) => (prev.status === 'expired' ? prev : { status: 'expired' }));
      }
    } catch { /* transient — interval will retry */ }
  };

  const stopPolling = () => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  };

  const clearMySos = () => {
    setMySos(null);
    setNotifiedCount(null);
    setPanelMsg("");
    setSubmitPhase('idle');
    localStorage.removeItem(SOS_STORAGE_KEY);
    stopPolling();
  };

  const buildShareMessage = (req: any, myPhone: string): string => {
    const name = req.patientName && !req.patientName.startsWith("Patient (") ? req.patientName : "a patient";
    return `URGENT — ${req.bloodGroup} Blood Needed\n` +
      `${name} urgently needs ${req.bloodGroup} blood (${req.unitsNeeded} unit${req.unitsNeeded > 1 ? "s" : ""}) at ${req.hospitalName}, ${req.city}.\n` +
      `Contact: ${myPhone}\n` +
      `Please share or donate if you can. Every minute counts.`;
  };

  const validatePhone = (value: string): string => {
    const digits = phoneDigits(value);
    if (!value.trim()) return "Please add your mobile number — we need it to connect donors to you.";
    if (digits.length < 7) return "That number looks too short. Add the full mobile number.";
    if (digits.length > 15) return "That number looks too long. Double-check it.";
    return "";
  };

  // P0-1: the actual SOS POST. Always carries the proof token that binds
  // this request to the verified contact phone.
  const postSos = async (proofToken: string) => {
    setError("");
    setSubmitPhase('loading');

    try {
      const response = await fetch(`${API_BASE}/api/emergencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: emergencyMode ? "" : patientName,
          bloodGroup,
          unitsNeeded,
          hospitalId,
          contactPhone,
          reason: emergencyMode ? "" : reason,
          urgency: emergencyMode ? "Immediate (SOS)" : urgency,
          city,
          proofToken,
        })
      });

      if (response.ok) {
        const d = await response.json();
        // Abuse controls (Phase 3): the backend answers 200 + duplicate:true
        // when this phone already has an open request for the same blood
        // group — a double-tap must not broadcast the same SOS twice.
        if (d.duplicate) {
          let restored: MySos | null = null;
          try {
            const raw = localStorage.getItem(SOS_STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && parsed.id) restored = parsed as MySos;
            }
          } catch { /* ignore corrupt storage */ }
          setMySos(restored && restored.code && restored.id === d.request?.id ? restored : { id: d.request?.id, code: "", myPhone: contactPhone, request: d.request || null });
          setReveal({ status: 'waiting' });
          setMatchingCount(d.request?.matchingDonorsCount ?? 0);
          setNotifiedCount(null);
          setPanelMsg("We found your open request for this need — nothing was double-posted.");
          setSubmitPhase('success');
          return;
        }
        const sos: MySos = { id: d.request?.id, code: d.requesterCode, myPhone: contactPhone, request: d.request || null };
        setMySos(sos);
        setReveal({ status: 'waiting' });
        setMatchingCount(d.request?.matchingDonorsCount ?? 0);
        setNotifiedCount(null);
        setPanelMsg("");
        localStorage.setItem(SOS_STORAGE_KEY, JSON.stringify(sos));
        setPatientName("");
        setReason("");
        setUnitsNeeded(1);
        setSubmitPhase('success');
        onSuccess();
      } else {
        const d = await response.json().catch(() => ({}));
        // P0-1: the server rejected our proof (expired / cleared server-side).
        // Drop the stale cache entry and re-verify instead of stranding the
        // requester on an error they can't fix.
        if (response.status === 401 && d.code === "PROOF_REQUIRED") {
          clearCachedProof();
          setSubmitPhase('idle');
          // Force a fresh code for this number (the old one is long dead).
          setSentForPhone("");
          enterVerifyStage();
          return;
        }
        setError(d.error || "Failed to submit request.");
        setSubmitPhase('idle');
      }
    } catch {
      setError("Couldn't send. Check your connection and retry.");
      setSubmitPhase('idle');
    }
  };

  // Sends the verification code to the contact phone (requester door — same
  // OTP store as login, so one cooldown per phone across both).
  const sendSosOtp = async () => {
    setVerifyBusy(true);
    setVerifyError("");
    setDevOtpHint("");
    try {
      const res = await fetch(`${API_BASE}/api/requester/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: contactPhone }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDevOtpHint(data.devOtp || "");
      } else {
        setVerifyError(data.error || "Couldn't send the code. Check the number and try again.");
      }
    } catch {
      setVerifyError("Network error. Try again.");
    } finally {
      setVerifyBusy(false);
    }
  };

  // Enters the verify stage. Auto-sends the code only the first time for a
  // given number — re-entering keeps the code already on its way (the 60s
  // per-phone cooldown would reject an immediate resend).
  const enterVerifyStage = () => {
    setVerifyError("");
    setVerifyCode("");
    setVerifyStage(true);
    if (sentForPhone !== contactPhone) {
      setDevOtpHint("");
      setSentForPhone(contactPhone);
      sendSosOtp();
    }
  };

  // Verifies the code, caches the 15-minute proof, and submits the SOS that
  // was waiting — one tap, nothing re-typed.
  const handleVerify = async () => {
    if (verifyCode.trim().length !== 6) return;
    setVerifyBusy(true);
    setVerifyError("");
    try {
      const res = await fetch(`${API_BASE}/api/requester/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: contactPhone, code: verifyCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.proofToken) {
        cacheProof({
          phone: contactPhone,
          token: data.proofToken,
          expiresAt: Date.now() + (data.expiresInSeconds ? data.expiresInSeconds * 1000 : PROOF_TTL_MS),
        });
        setVerifyStage(false);
        await postSos(data.proofToken);
      } else {
        setVerifyError(data.error || "Incorrect code. Try again.");
      }
    } catch {
      setVerifyError("Network error. Try again.");
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate all required fields; focus the first error.
    const pErr = validatePhone(contactPhone);
    const gErr = bloodGroup === "" ? "Please pick the blood group from your lab report — or ask the ward. O- and O+ are the most common." : "";
    setPhoneError(pErr);
    setGroupError(gErr);
    if (pErr) { phoneRef.current?.focus(); return; }
    if (gErr) { groupChipsRef.current?.focus(); return; }

    // P0-1: without a fresh proof for this number, swap to the inline
    // verification step and auto-send the code. The SOS posts right after
    // the code checks out.
    const token = validProofTokenFor(contactPhone);
    if (!token) {
      enterVerifyStage();
      return;
    }

    await postSos(token);
  };

  // Requester asks the platform to notify matching donors. Donors get inbox
  // items; the first accept wins and both sides receive each other's number.
  const handleNotifyDonors = async () => {
    if (!mySos) return;
    setNotifying(true);
    setPanelMsg("");
    try {
      const response = await fetch(`${API_BASE}/api/emergencies/${mySos.id}/contact-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requesterCode: mySos.code })
      });
      const data = await response.json();
      if (response.ok) {
        setNotifiedCount(data.notifiedDonors ?? 0);
        setPanelMsg(data.message || "");
      } else {
        setPanelMsg(data.error || "Couldn't notify donors.");
      }
    } catch {
      setPanelMsg("Network error. Try again.");
    } finally {
      setNotifying(false);
    }
  };

  // The requester closes the loop: cancel, or mark fulfilled once blood
  // arrived. Both actions are audited server-side via the requester code.
  const handleCloseSos = async (status: "Cancelled" | "Fulfilled") => {
    if (!mySos) return;
    setClosing(true);
    setPanelMsg("");
    try {
      const response = await fetch(`${API_BASE}/api/emergencies/${mySos.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, requesterCode: mySos.code })
      });
      if (response.ok) {
        setReveal(status === "Fulfilled" ? { status: 'fulfilled' } : { status: 'cancelled' });
        if (status === "Cancelled") setSubmitPhase('idle');
        // Keep mySos mounted so the confirmation message is visible; only
        // the persisted secret is cleared (the SOS is closed server-side).
        localStorage.removeItem(SOS_STORAGE_KEY);
        stopPolling();
        onSuccess();
      } else {
        const data = await response.json();
        setPanelMsg(data.error || "Couldn't update the request.");
      }
    } catch {
      setPanelMsg("Network error. Try again.");
    } finally {
      setClosing(false);
    }
  };

  // P0-5: an SOS closes itself after 48 hours without an update. The
  // requester re-confirms it's still needed and gets a fresh window —
  // proof of ownership stays the one-time requester code.
  const handleExtendSos = async () => {
    if (!mySos) return;
    setClosing(true);
    setPanelMsg("");
    try {
      const response = await fetch(`${API_BASE}/api/emergencies/${mySos.id}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requesterCode: mySos.code })
      });
      if (response.ok) {
        setReveal({ status: 'waiting' });
        setPanelMsg("");
        // Re-persist so a refresh right after re-opening keeps the live view.
        localStorage.setItem(SOS_STORAGE_KEY, JSON.stringify(mySos));
      } else {
        const data = await response.json().catch(() => ({}));
        setPanelMsg(data.error || "Couldn't re-open the request.");
      }
    } catch {
      setPanelMsg("Network error. Try again.");
    } finally {
      setClosing(false);
    }
  };
  const shareUrl = mySos ? `https://wa.me/?text=${encodeURIComponent(buildShareMessage(mySos.request, mySos.myPhone))}` : "#";
  const noMatches = matchingCount !== null && matchingCount === 0;
  const selectedHospital = hospitals.find(h => h.id === hospitalId) || null;
  const hospitalPhone = selectedHospital?.phone || "";
  const cityHospitals = hospitals.filter(h => h.city === city);
  const filteredHospitals = cityHospitals.filter(h =>
    h.name.toLowerCase().includes(hospitalQuery.toLowerCase())
  );

  // One-tap SMS fallback when the server is unreachable — the same message
  // the WhatsApp share would carry, so nothing typed is lost.
  const smsFallbackUrl = `sms:?&body=${encodeURIComponent(
    `URGENT — ${bloodGroup || "?"} blood needed, ${unitsNeeded} unit(s), ${city}. Contact: ${contactPhone}. Sent via BloodRadar.`
  )}`;

  return (
    <Card
      id="sos-request-form-card"
      className="sos-card"
      icon={
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-blood">
          <Siren className="w-5 h-5 text-white" />
        </span>
      }
      title={
        <span className="flex items-center gap-2">
          Request Blood — SOS
          {mySos && reveal.status === 'waiting' && <Badge tone="blood" mono><span className="w-1.5 h-1.5 rounded-full bg-blood animate-pulse" /> LIVE</Badge>}
        </span>
      }
      subtitle="One quick code to your phone keeps requests real. We alert compatible donors nearby."
    >
      {/* Success state — a full screen, not a toast. */}
      {submitPhase === 'success' && mySos && reveal.status !== 'cancelled' && reveal.status !== 'expired' && (
        <div role="status" aria-live="polite" className="text-center py-6 fade-in">
          <div className="relative mx-auto w-20 h-20 mb-5">
            <span className="absolute inset-0 rounded-full border-2 border-blood/30 success-ripple pointer-events-none" aria-hidden="true" />
            <span className="absolute inset-0 rounded-full flex items-center justify-center" style={{ background: 'var(--blood-tint)' }}>
              <svg viewBox="0 0 24 24" className="w-9 h-9" aria-hidden="true">
                <path
                  className="check-draw"
                  d="M4 12.5l5 5L20 6.5"
                  fill="none"
                  stroke="var(--blood)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
          <p className="font-display font-extrabold text-2xl" style={{ color: 'var(--ink)' }}>Request sent</p>
          <p className="text-sm mt-2 max-w-sm mx-auto" style={{ color: 'var(--muted)' }}>
            {noMatches
              ? "No compatible donors in the registry right now. Share on WhatsApp to reach further, and call a hospital directly — details below."
              : matchingCount !== null
                ? `${matchingCount} compatible donors matched nearby — notify them now.`
                : "Checking for compatible donors…"}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="inline-flex">
              <Button variant="secondary" size="md" icon={<MessageCircle className="w-4 h-4" />}>Share on WhatsApp</Button>
            </a>
            {hospitalPhone ? (
              <a href={`tel:${hospitalPhone}`} className="inline-flex">
                <Button variant="secondary" size="md" icon={<PhoneCall className="w-4 h-4" />}>Call the hospital</Button>
              </a>
            ) : (
              <span className="inline-flex">
                <Button variant="secondary" size="md" icon={<Phone className="w-4 h-4" />} onClick={() => document.getElementById("sos-hotlines")?.scrollIntoView({ behavior: "smooth" })}>
                  Call a hospital
                </Button>
              </span>
            )}
            <span className="inline-flex">
              <Button variant="ghost" size="md" icon={<Eye className="w-4 h-4" />} onClick={() => document.getElementById("sos-live-panel")?.scrollIntoView({ behavior: "smooth" })}>
                Track this request
              </Button>
            </span>
          </div>
        </div>
      )}

      {/* ── Live requester panel — notify donors, watch status, close loop ── */}
      {mySos && reveal.status !== 'cancelled' && reveal.status !== 'expired' && (
        <div
          id="sos-live-panel"
          role="status"
          aria-live="polite"
          className="mb-5 p-4 rounded-xl relative border scale-in"
          style={{ background: 'var(--blood-tint)', borderColor: 'rgb(196 18 48 / 0.25)' }}
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--blood)' }}>
              {reveal.status === 'fulfilled' || reveal.status === 'donor-accepted'
                ? <CheckCircle2 className="w-5 h-5 text-white" />
                : <BellRing className="w-5 h-5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              {reveal.status === 'fulfilled' ? (
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Marked fulfilled — thank you.</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Your request is closed and the board is up to date.</p>
                  <div className="mt-2">
                    <Button size="sm" variant="secondary" onClick={clearMySos}>Done</Button>
                  </div>
                </div>
              ) : reveal.status === 'donor-accepted' ? (
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>A donor accepted your request!</p>
                  {reveal.donor && (
                    <div className="mt-2 space-y-2">
                      <div className="p-3 rounded-lg flex items-center justify-between gap-3 border" style={{ background: 'var(--safe-tint)', borderColor: 'rgb(0 196 140 / 0.4)' }}>
                        <div className="min-w-0">
                          <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                            {reveal.donor.name} <span style={{ color: 'var(--blood-dark)' }}>({reveal.donor.bloodGroup})</span>
                          </p>
                          <p className="text-xs font-mono mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
                            {reveal.donor.city}
                            {reveal.acceptedAt ? ` · ${new Date(reveal.acceptedAt).toLocaleString()}` : ''}
                          </p>
                        </div>
                        <a
                          href={`tel:${reveal.donor.phone}`}
                          className="h-11 px-4 rounded-xl text-sm font-bold text-white flex items-center gap-1.5 shrink-0 transition-colors duration-150 hover:opacity-90"
                          style={{ background: 'var(--safe-text)' }}
                        >
                          <PhoneCall className="w-4 h-4" />
                          Call Now
                        </a>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        Don't forget to mark the request fulfilled once the blood arrives — it keeps the board honest.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Your SOS is live</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    {noMatches
                      ? "No compatible donors in the registry right now. Share on WhatsApp to reach further, and call a hospital directly — details below."
                      : matchingCount !== null
                        ? `${matchingCount} donors matched — notify them now.`
                        : "Checking for compatible donors…"}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Actions — waiting state */}
          {reveal.status === 'waiting' && (
            <div className="mt-3 space-y-2">
              {notifiedCount !== null && (
                <p className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                  <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {notifiedCount > 0
                    ? `${notifiedCount} compatible donors notified`
                    : "No available donors were notified right now — we keep retrying with new signups"}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={handleNotifyDonors} loading={notifying} icon={<BellRing className="w-4 h-4" />}>
                  Notify Matching Donors
                </Button>
                <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="secondary" icon={<Users className="w-4 h-4" />}>WhatsApp</Button>
                </a>
                <Button size="sm" variant="ghost" onClick={() => handleCloseSos("Fulfilled")} loading={closing} icon={<Check className="w-4 h-4" />}>
                  Mark as Fulfilled
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleCloseSos("Cancelled")} loading={closing} icon={<XCircle className="w-4 h-4" />}>
                  Cancel SOS
                </Button>
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                We check every 15 seconds and show the donor's number here the moment someone accepts.
              </p>
              {/* Transparent ranking: who's nearby, and exactly why. */}
              <TopMatches sosId={mySos.id} />
              {/* Honest fallback when the registry has nobody compatible. */}
              <div id="sos-hotlines" className="p-3 rounded-lg border" style={{ background: 'var(--warn-tint)', borderColor: 'rgb(255 179 0 / 0.4)' }} role="note">
                <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--warn-text)' }}>
                  <Phone className="w-3.5 h-3.5 shrink-0" />
                  Also call the hospital directly:
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {HOTLINES.map(h => (
                    <a key={h.name} href={`tel:${h.number}`} className="text-xs font-semibold underline underline-offset-2" style={{ color: 'var(--blood-dark)' }}>
                      {h.name} · {h.number}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Actions — donor accepted */}
          {reveal.status === 'donor-accepted' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="secondary" icon={<Users className="w-4 h-4" />}>WhatsApp</Button>
              </a>
              <Button size="sm" variant="success" onClick={() => handleCloseSos("Fulfilled")} loading={closing} icon={<Check className="w-4 h-4" />}>
                Mark as Fulfilled
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleCloseSos("Cancelled")} loading={closing} icon={<XCircle className="w-4 h-4" />}>
                Cancel SOS
              </Button>
            </div>
          )}
          {panelMsg && <p className="text-xs mt-2" style={{ color: 'var(--blood-dark)' }}>{panelMsg}</p>}
        </div>
      )}

      {/* Cancelled → offer a fresh start */}
      {mySos && reveal.status === 'cancelled' && (
        <div role="status" className="mb-5 p-4 rounded-xl border flex items-center gap-2.5" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <XCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} />
          <p className="text-sm flex-1" style={{ color: 'var(--muted)' }}>Request cancelled. You can raise a new SOS below.</p>
          <Button size="sm" variant="ghost" onClick={clearMySos}>New request</Button>
        </div>
      )}

      {/* P0-5: expired → re-confirm the need, or start fresh */}
      {mySos && reveal.status === 'expired' && (
        <div role="status" aria-live="polite" className="mb-5 p-4 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} />
            <p className="text-sm flex-1" style={{ color: 'var(--muted)' }}>
              This request closed after 48 hours without an update.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={handleExtendSos} loading={closing} icon={<BellRing className="w-4 h-4" />}>
              Still need blood? Re-open request
            </Button>
            <Button size="sm" variant="ghost" onClick={clearMySos}>Start a new request</Button>
          </div>
          {panelMsg && <p className="text-xs mt-2" style={{ color: 'var(--blood-dark)' }}>{panelMsg}</p>}
        </div>
      )}

      {submitPhase !== 'success' && (
      verifyStage ? (
        /* ── P0-1 phone verification step — replaces the form until the
           code checks out, then the waiting request auto-submits. ── */
        <div id="sos-verify-stage" role="status" aria-live="polite" className="space-y-4 text-sm">
          <div className="p-3 rounded-xl border flex items-start gap-2.5" style={{ background: 'var(--blood-tint)', borderColor: 'rgb(196 18 48 / 0.25)' }}>
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--blood-dark)' }} aria-hidden="true" />
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink)' }}>
              One quick check before we broadcast: we texted a 6-digit code to{" "}
              <strong>{contactPhone}</strong>. It proves the request is real —
              donors can't trust a board anyone can spam.
            </p>
          </div>
          <Input
            id="input-sos-otp"
            label="Verification code"
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            icon={<ShieldCheck className="w-4 h-4" />}
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => { if (e.key === "Enter" && verifyCode.trim().length === 6) handleVerify(); }}
            disabled={verifyBusy}
            hint={devOtpHint ? `Test mode — your code is ${devOtpHint}` : "Enter the 6-digit code we texted you."}
          />
          {verifyError && (
            <p role="alert" className="text-xs font-medium" style={{ color: 'var(--danger-text)' }}>{verifyError}</p>
          )}
          <div className="space-y-2">
            <Button
              size="lg"
              fullWidth
              loading={verifyBusy}
              disabled={verifyCode.trim().length !== 6}
              icon={<ShieldCheck className="w-4 h-4" />}
              onClick={handleVerify}
              className="tracking-wide"
            >
              Verify &amp; send request
            </Button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="md"
                fullWidth
                onClick={() => { setVerifyStage(false); setVerifyError(""); }}
              >
                Change number
              </Button>
              <Button variant="ghost" size="md" fullWidth loading={verifyBusy} onClick={sendSosOtp}>
                Resend code
              </Button>
            </div>
          </div>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-4 text-sm">
        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm border" role="alert" style={{ background: 'var(--blood-tint)', borderColor: 'rgb(196 18 48 / 0.25)', color: 'var(--danger-text)' }}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <a href={smsFallbackUrl} className="font-semibold underline underline-offset-2 whitespace-nowrap">
              Send by SMS instead
            </a>
          </div>
        )}

        {/* Emergency mode — strips the form to the essentials. */}
        <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <Zap className="w-4 h-4 shrink-0" style={{ color: 'var(--warn-text)' }} aria-hidden="true" />
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Emergency mode</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Essentials only — one quick phone check, then it's live</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={emergencyMode}
            aria-label="Toggle emergency mode"
            onClick={() => setEmergencyMode(m => !m)}
            className={`relative w-14 h-8 rounded-full shrink-0 transition-colors duration-150 ${emergencyMode ? "bg-blood" : "bg-border"}`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-1 transition-transform duration-150 ${emergencyMode ? "translate-x-7" : "translate-x-1"}`}
            />
          </button>
        </div>

        {/* 1. Blood group — large tappable chips, 48px. */}
        <fieldset ref={groupChipsRef} tabIndex={-1}>
          <legend className="block font-semibold mb-1.5 text-sm" style={{ color: 'var(--ink)' }}>
            Blood group needed <span aria-hidden="true" style={{ color: 'var(--blood)' }}>*</span>
          </legend>
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Blood group">
            {BLOOD_GROUPS.map(g => (
              <button
                key={g}
                type="button"
                id={`chip-blood-${g}`}
                aria-pressed={bloodGroup === g}
                onClick={() => { setBloodGroup(g); setGroupError(""); }}
                className={`h-12 rounded-xl border-2 font-display font-extrabold text-base transition-all duration-150 flex items-center justify-center gap-1
                  ${bloodGroup === g
                    ? "bg-blood border-blood text-white shadow-1"
                    : "bg-card border-border text-ink hover:border-blood/50"}`}
              >
                {g}
                {bloodGroup === g && <Check className="w-4 h-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            id="chip-blood-not-sure"
            aria-pressed={bloodGroup === ""}
            onClick={() => { setBloodGroup(""); setGroupError(""); }}
            className={`mt-1.5 w-full h-10 rounded-xl border-2 border-dashed text-sm font-semibold flex items-center justify-center gap-2 transition-colors duration-150
              ${bloodGroup === "" ? "bg-blood-tint border-blood text-blood-dark" : "bg-card border-border text-muted hover:border-blood/40"}`}
          >
            <HelpCircle className="w-4 h-4" aria-hidden="true" />
            Not sure
          </button>
          {groupError && (
            <p id="sos-group-error" role="alert" className="mt-1.5 text-xs flex items-center gap-1.5" style={{ color: 'var(--danger-text)' }}>
              <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {groupError}
            </p>
          )}
        </fieldset>

        {/* 2. Phone — prefilled +92, the only truly required field. */}
        <div>
          <label htmlFor="input-sos-phone" className="block font-semibold mb-1.5 text-sm" style={{ color: 'var(--ink)' }}>
            Your mobile number <span aria-hidden="true" style={{ color: 'var(--blood)' }}>*</span>
          </label>
          <div className={`flex items-stretch h-11 rounded-xl border bg-card overflow-hidden transition-colors duration-150 focus-within:ring-2 focus-within:ring-blood/15 ${phoneError ? "border-blood" : "border-border-strong focus-within:border-blood"}`}>
            <span className="flex items-center px-3 font-mono text-sm font-bold border-r" style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>+92</span>
            <input
              ref={phoneRef}
              id="input-sos-phone"
              type="tel"
              placeholder="300 1234567"
              value={contactPhone}
              onChange={(e) => { setContactPhone(e.target.value); if (phoneError) setPhoneError(""); }}
              onBlur={() => setPhoneError(validatePhone(contactPhone))}
              autoComplete="tel"
              inputMode="tel"
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? "sos-phone-error" : "sos-phone-hint"}
              className="flex-1 min-w-0 px-3 bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </div>
          {phoneError ? (
            <p id="sos-phone-error" role="alert" className="mt-1.5 text-xs flex items-center gap-1.5" style={{ color: 'var(--danger-text)' }}>
              <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {phoneError}
            </p>
          ) : (
            <p id="sos-phone-hint" className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
              Private until a donor accepts — we text you a one-time code to verify it's really you.
            </p>
          )}
        </div>

        {/* 3. Hospital — searchable, "Not sure" allowed. */}
        <fieldset>
          <legend className="block font-semibold mb-1.5 text-sm" style={{ color: 'var(--ink)' }}>
            Hospital <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
          </legend>
          <div className="flex gap-2 mb-2">
            {SUPPORTED_CITIES.map(c => (
              <button
                key={c}
                type="button"
                id={`chip-city-${c.toLowerCase()}`}
                aria-pressed={city === c}
                onClick={() => setCity(c)}
                className={`h-9 px-4 rounded-lg border text-sm font-bold transition-colors duration-150
                  ${city === c ? "bg-blood text-white border-blood" : "bg-card text-muted border-border hover:border-ink/40"}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="relative" ref={hospitalListRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--muted)' }} aria-hidden="true" />
            <input
              id="input-sos-hospital-search"
              role="combobox"
              aria-expanded={hospitalOpen}
              aria-controls="listbox-sos-hospital"
              aria-autocomplete="list"
              autoComplete="off"
              type="text"
              placeholder={selectedHospital ? selectedHospital.name : "Search hospitals… or skip"}
              value={selectedHospital && !hospitalOpen ? selectedHospital.name : hospitalQuery}
              onChange={(e) => { setHospitalQuery(e.target.value); setHospitalOpen(true); }}
              onFocus={() => setHospitalOpen(true)}
              onKeyDown={(e) => { if (e.key === "Escape") setHospitalOpen(false); }}
              className="w-full h-11 pl-9 pr-3 rounded-xl bg-card border text-sm outline-none transition-colors duration-150 focus:ring-2 focus:ring-blood/15 focus:border-blood border-border-strong placeholder:text-muted"
            />
            {hospitalOpen && (
              <ul
                id="listbox-sos-hospital"
                role="listbox"
                aria-label="Hospitals"
                className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-xl border bg-card shadow-3"
                style={{ borderColor: 'var(--border)' }}
              >
                <li
                  role="option"
                  id="option-hospital-not-sure"
                  aria-selected={hospitalId === ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setHospitalId(""); setHospitalQuery(""); setHospitalOpen(false); }}
                  className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold cursor-pointer hover:bg-surface-2 transition-colors"
                  style={{ color: 'var(--ink)' }}
                >
                  <HelpCircle className="w-4 h-4" style={{ color: 'var(--muted)' }} aria-hidden="true" />
                  Not sure — skip this step
                </li>
                {filteredHospitals.map(h => (
                  <li
                    key={h.id}
                    role="option"
                    id={`option-hospital-${h.id}`}
                    aria-selected={hospitalId === h.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setHospitalId(h.id); setHospitalQuery(h.name); setHospitalOpen(false); }}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm cursor-pointer hover:bg-surface-2 transition-colors"
                    style={{ color: 'var(--ink)' }}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-4 h-4 shrink-0" style={{ color: 'var(--blood)' }} aria-hidden="true" />
                      <span className="truncate">{h.name}</span>
                    </span>
                    {hospitalId === h.id && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--blood)' }} aria-hidden="true" />}
                  </li>
                ))}
                {filteredHospitals.length === 0 && (
                  <li className="px-3 py-2.5 text-sm" style={{ color: 'var(--muted)' }}>No hospitals match — you can skip this step.</li>
                )}
              </ul>
            )}
          </div>
          <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>Optional — donors can match on blood group and city alone.</p>
        </fieldset>

        {/* Units — always visible, compact. */}
        <fieldset>
          <legend className="block font-semibold mb-1.5 text-sm" style={{ color: 'var(--ink)' }}>Units</legend>
          <div className="flex items-center gap-1 h-12 rounded-xl border bg-card px-1.5" style={{ borderColor: 'var(--border)' }}>
            <button
              type="button"
              id="btn-sos-units-minus"
              aria-label="Fewer units"
              onClick={() => setUnitsNeeded(u => Math.max(1, u - 1))}
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-surface-2 transition-colors duration-150"
              style={{ color: 'var(--ink)' }}
            >
              <Minus className="w-4 h-4" />
            </button>
            <span id="sos-units-value" className="flex-1 text-center font-display font-bold text-lg" style={{ color: 'var(--ink)' }} aria-live="polite">{unitsNeeded}</span>
            <button
              type="button"
              id="btn-sos-units-plus"
              aria-label="More units"
              onClick={() => setUnitsNeeded(u => Math.min(10, u + 1))}
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-surface-2 transition-colors duration-150"
              style={{ color: 'var(--ink)' }}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </fieldset>

        {/* More details — collapsed by default in emergency mode. */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            id="btn-toggle-more-details"
            aria-expanded={!emergencyMode || showMoreDetails}
            onClick={() => setShowMoreDetails(s => !s)}
            className="w-full flex items-center justify-between px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2"
            style={{ background: 'var(--surface-2)' }}
          >
            <span className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
              More details <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${!emergencyMode || showMoreDetails ? "rotate-180" : ""}`} style={{ color: 'var(--muted)' }} aria-hidden="true" />
          </button>
          {(!emergencyMode || showMoreDetails) && (
            <div className="p-4 space-y-4 border-t fade-in" style={{ borderColor: 'var(--border)' }}>
              <div>
                <label htmlFor="input-sos-patient-name" className="block font-semibold mb-1.5 text-sm" style={{ color: 'var(--ink)' }}>
                  Patient name <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
                </label>
                <input
                  id="input-sos-patient-name"
                  type="text"
                  placeholder="e.g. Muhammad Zubair"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="w-full h-12 px-3.5 rounded-xl bg-card border border-border-strong text-sm outline-none transition-colors duration-150 focus:ring-2 focus:ring-blood/15 focus:border-blood placeholder:text-muted"
                />
              </div>
              <Select
                id="select-sos-urgency"
                label="Urgency"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as any)}
              >
                <option value="Immediate (SOS)">Immediate (SOS)</option>
                <option value="Urgent">Urgent</option>
                <option value="Routine">Routine</option>
              </Select>
              <div>
                <label htmlFor="input-sos-reason" className="block font-semibold mb-1.5 text-sm" style={{ color: 'var(--ink)' }}>
                  Reason / diagnosis details <span className="font-normal" style={{ color: 'var(--muted)' }}>(optional)</span>
                </label>
                <textarea
                  id="input-sos-reason"
                  rows={2}
                  placeholder="e.g. Major surgery scheduled tomorrow morning"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card border border-border-strong text-sm resize-none outline-none transition-colors duration-150 focus:ring-2 focus:ring-blood/15 focus:border-blood placeholder:text-muted"
                />
              </div>
            </div>
          )}
        </div>

        <Button
          id="btn-submit-sos-request"
          type="submit"
          size="lg"
          fullWidth
          loading={submitPhase === 'loading'}
          icon={<Heart className="w-5 h-5" />}
          className="tracking-wide"
        >
          {submitPhase === 'loading' ? "Sending…" : "Send request"}
        </Button>
      </form>
      )
      )}
    </Card>
  );
}
