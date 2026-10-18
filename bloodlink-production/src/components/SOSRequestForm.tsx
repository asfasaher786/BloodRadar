import React, { useState, useEffect, useRef } from "react";
import { Hospital } from "../types";
import { API_BASE } from "../lib/api";
import {
  AlertCircle, Heart, Users, BellRing, CheckCircle2, PhoneCall,
  RefreshCw, XCircle, Eye, Zap, Minus, Plus, Siren, Phone, Check
} from "lucide-react";
import { SUPPORTED_CITIES, DEFAULT_CITY } from "../lib/regions";
import Card from "./ui/Card";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Button from "./ui/Button";
import Badge from "./ui/Badge";
import TopMatches from "./TopMatches";

interface SOSRequestFormProps {
  hospitals: Hospital[];
  onSuccess: () => void;
  lang: 'en' | 'ur';
}

interface MySos {
  id: string;
  code: string;
  myPhone: string;
  request: any;
}

type RevealStatus = 'waiting' | 'donor-accepted' | 'fulfilled' | 'cancelled';
interface RevealState {
  status: RevealStatus;
  donor?: { name: string; bloodGroup: string; phone: string; city: string } | null;
  acceptedAt?: string;
}

const SOS_STORAGE_KEY = "bloodradar_my_sos";
const BLOOD_GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as const;
const HOTLINES = [
  { name: "Rescue 1122", number: "1122" },
  { name: "PIMS Islamabad", number: "+92 51 9261170" },
  { name: "Holy Family Rwp", number: "+92 51 9290321" },
  { name: "Shifa International", number: "+92 51 8463000" },
];

export default function SOSRequestForm({ hospitals, onSuccess, lang }: SOSRequestFormProps) {
  const en = (e: string, u: string) => (lang === 'en' ? e : u);

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

  // Requester-side tracking of their live SOS (anonymous — proven by the
  // one-time code the server issued). Survives page refresh via localStorage.
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
    localStorage.removeItem(SOS_STORAGE_KEY);
    stopPolling();
  };

  const buildShareMessage = (req: any, myPhone: string): string => {
    const name = req.patientName && !req.patientName.startsWith("Patient (") ? req.patientName : "a patient";
    return `⚠️ URGENT — ${req.bloodGroup} Blood Needed ⚠️\n` +
      `${name} urgently needs ${req.bloodGroup} blood (${req.unitsNeeded} unit${req.unitsNeeded > 1 ? "s" : ""}) at ${req.hospitalName}, ${req.city}.\n` +
      `📞 Contact: ${myPhone}\n` +
      `Please share/donate if you can. Every minute counts. 🙏`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactPhone.trim()) {
      setError(en("Please provide a contact phone number — it's the only required field.", "براہ کرم رابطہ نمبر درج کریں۔"));
      return;
    }
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
          hospitalId: emergencyMode ? "" : hospitalId,
          contactPhone,
          reason: emergencyMode ? "" : reason,
          urgency: emergencyMode ? "Immediate (SOS)" : urgency,
          city,
        })
      });

      if (response.ok) {
        const d = await response.json();
        // Abuse controls (Phase 3): the backend answers 200 + duplicate:true
        // when this phone already has an open request for the same blood
        // group — a double-tap must not broadcast the same SOS twice. Show
        // the open request instead; reuse the locally stored requester code
        // (it belongs to this phone + need).
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
          setPanelMsg(en(
            "We found your open request for this need — nothing was double-posted.",
            "اس ضرورت کے لیے آپ کی کھلی درخواست مل گئی — کچھ دوبارہ پوسٹ نہیں ہوا۔"
          ));
          setContactPhone("");
          setSubmitPhase('idle');
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
        setContactPhone("");
        setReason("");
        setUnitsNeeded(1);
        // Micro-interaction: spinner → check → live panel takes over.
        setSubmitPhase('success');
        setTimeout(() => setSubmitPhase('idle'), 900);
        onSuccess();
      } else {
        const d = await response.json();
        setError(d.error || "Failed to submit request.");
        setSubmitPhase('idle');
      }
    } catch {
      setError("Server connection failed. Please try again.");
      setSubmitPhase('idle');
    }
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
        setPanelMsg(data.error || en("Couldn't notify donors.", "عطیہ دہندگان کو مطلع نہیں کیا جا سکا۔"));
      }
    } catch {
      setPanelMsg(en("Network error. Try again.", "نیٹ ورک میں خرابی۔ دوبارہ کوشش کریں۔"));
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
        // Keep mySos mounted so the confirmation message is visible; only
        // the persisted secret is cleared (the SOS is closed server-side).
        localStorage.removeItem(SOS_STORAGE_KEY);
        stopPolling();
        onSuccess();
      } else {
        const data = await response.json();
        setPanelMsg(data.error || en("Couldn't update the request.", "درخواست اپڈیٹ نہیں ہو سکی۔"));
      }
    } catch {
      setPanelMsg(en("Network error. Try again.", "نیٹ ورک میں خرابی۔ دوبارہ کوشش کریں۔"));
    } finally {
      setClosing(false);
    }
  };

  const shareUrl = mySos ? `https://wa.me/?text=${encodeURIComponent(buildShareMessage(mySos.request, mySos.myPhone))}` : "#";
  const noMatches = matchingCount !== null && matchingCount === 0;

  return (
    <Card
      id="sos-request-form-card"
      className="sos-card"
      icon={
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-blood blood-pulse">
          <Siren className="w-5 h-5 text-white" />
        </span>
      }
      title={
        <span className="flex items-center gap-2">
          {en("Request Blood — SOS", "فوری ہنگامی بلڈ کی درخواست")}
          {mySos && reveal.status === 'waiting' && <Badge tone="blood" mono><span className="w-1.5 h-1.5 rounded-full bg-blood animate-pulse" /> LIVE</Badge>}
        </span>
      }
      subtitle={en("Only a phone number is required. Everything else can be skipped.", "صرف رابطہ نمبر ضروری ہے، باقی سب اختیاری ہے۔")}
    >
      {/* Emergency mode toggle — strips the form to the essentials. */}
      <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface border border-border mb-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Zap className="w-4 h-4 text-warn-ink shrink-0" aria-hidden="true" />
          <div>
            <p className="text-xs font-bold text-ink">{en("Emergency mode", "ایمرجنسی موڈ")}</p>
            <p className="text-[10px] text-muted">
              {en("Essentials only — broadcast in under 30 seconds", "صرف ضروری خانے — تیس سیکنڈ میں درخواست")}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={emergencyMode}
          aria-label={en("Toggle emergency mode", "ایمرجنسی موڈ آن/آف")}
          onClick={() => setEmergencyMode(m => !m)}
          className={`relative w-14 h-8 rounded-full shrink-0 transition-colors duration-150 ${emergencyMode ? "bg-blood" : "bg-border"}`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-1 transition-transform duration-150 ${emergencyMode ? "translate-x-7" : "translate-x-1"}`}
          />
        </button>
      </div>

      {/* ── Live requester panel — the confirmation screen ─────────────── */}
      {mySos && reveal.status !== 'cancelled' && (
        <div
          role="status"
          aria-live="polite"
          className="mb-5 p-4 rounded-xl relative bg-blood-soft border border-blood/25 scale-in"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-blood">
              {reveal.status === 'fulfilled' || reveal.status === 'donor-accepted'
                ? <CheckCircle2 className="w-5 h-5 text-white" />
                : <BellRing className="w-5 h-5 text-white animate-pulse" />}
            </div>
            <div className="flex-1 min-w-0">
              {reveal.status === 'fulfilled' ? (
                <div>
                  <p className="text-xs font-bold text-ink">{en("Marked fulfilled — thank you.", "مکمل نشان زد — شکریہ۔")}</p>
                  <p className="text-[10px] text-muted mt-1">
                    {en("Your request is closed and the board is up to date.", "آپ کی درخواست بند کر دی گئی ہے۔")}
                  </p>
                  <div className="mt-2">
                    <Button size="sm" variant="secondary" onClick={clearMySos}>{en("Done", "مکمل")}</Button>
                  </div>
                </div>
              ) : reveal.status === 'donor-accepted' ? (
                <div>
                  <p className="text-xs font-bold text-ink">{en("A donor accepted your request!", "ایک عطیہ دہندہ نے آپ کی درخواست قبول کر لی!")}</p>
                  {reveal.donor && (
                    <div className="mt-2 space-y-2">
                      <div className="p-3 rounded-lg flex items-center justify-between gap-3 bg-safe-soft border border-safe/40">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-ink">
                            {reveal.donor.name} <span className="text-blood-ink">({reveal.donor.bloodGroup})</span>
                          </p>
                          <p className="text-[10px] font-mono mt-0.5 text-muted truncate">
                            {reveal.donor.city}
                            {reveal.acceptedAt ? ` · ${new Date(reveal.acceptedAt).toLocaleString()}` : ''}
                          </p>
                        </div>
                        <a
                          href={`tel:${reveal.donor.phone}`}
                          className="h-11 px-4 rounded-lg text-xs font-bold text-white bg-safe-ink hover:opacity-90 flex items-center gap-1.5 shrink-0 transition-colors duration-150"
                        >
                          <PhoneCall className="w-4 h-4" />
                          {en("Call Now", "کال کریں")}
                        </a>
                      </div>
                      <p className="text-[10px] text-muted">
                        {en("Don't forget to mark the request fulfilled once the blood arrives — it keeps the board honest.", "خون ملتے ہی درخواست مکمل نشان زد کرنا نہ بھولیں۔")}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs font-bold text-ink">{en("Your SOS is live", "آپ کی درخواست لائیو ہے")}</p>
                  <p className="text-[10px] text-muted mt-1">
                    {noMatches
                      ? en("No compatible donors in the registry right now. Share on WhatsApp to reach further, and call a hospital directly — details below.", "ابھی رجسٹری میں موزوں عطیہ دہندہ نہیں۔ واٹس ایپ پر شیئر کریں یا ہسپتال سے براہ راست رابطہ کریں۔")
                      : matchingCount !== null
                        ? en(`${matchingCount} compatible donor${matchingCount === 1 ? "" : "s"} matched — notify them now.`, `${matchingCount} موزوں عطیہ دہندگان ملے۔`)
                        : en("Checking for compatible donors…", "عطیہ دہندگان تلاش کیے جا رہے ہیں…")}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Actions — waiting state */}
          {reveal.status === 'waiting' && (
            <div className="mt-3 space-y-2">
              {notifiedCount !== null && (
                <p className="text-[10px] flex items-center gap-1 text-muted">
                  <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {notifiedCount > 0
                    ? en(`${notifiedCount} compatible donors notified`, `${notifiedCount} عطیہ دہندگان کو مطلع کیا گیا`)
                    : en("No available donors were notified right now — we keep retrying with new signups", "ابھی کوئی موزوں عطیہ دہندہ دستیاب نہیں")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={handleNotifyDonors} loading={notifying} icon={<BellRing className="w-4 h-4" />}>
                  {en("Notify Matching Donors", "عطیہ دہندگان کو مطلع کریں")}
                </Button>
                <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="secondary" icon={<Users className="w-4 h-4" />}>WhatsApp</Button>
                </a>
                <Button size="sm" variant="ghost" onClick={() => handleCloseSos("Fulfilled")} loading={closing} icon={<Check className="w-4 h-4" />}>
                  {en("Mark as Fulfilled", "مکمل ہو گئی")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleCloseSos("Cancelled")} loading={closing} icon={<XCircle className="w-4 h-4" />}>
                  {en("Cancel SOS", "منسوخ کریں")}
                </Button>
              </div>
              <p className="text-[10px] text-muted">
                {en("We check every 15 seconds and show the donor's number here the moment someone accepts.", "ہم ہر 15 سیکنڈ بعد چیک کرتے ہیں — نمبر قبول ہوتے ہی یہاں دکھائی دے گا۔")}
              </p>
              {/* Transparent ranking: who's nearby, and exactly why. */}
              <TopMatches sosId={mySos.id} lang={lang} />
              {/* Honest fallback when the registry has nobody compatible. */}
              {noMatches && (
                <div className="p-3 rounded-lg bg-warn-soft border border-warn/40" role="note">
                  <p className="text-[10px] font-bold text-warn-ink flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 shrink-0" />
                    {en("Also call the hospital directly:", "ہسپتال سے براہ راست بھی رابطہ کریں:")}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {HOTLINES.map(h => (
                      <a key={h.name} href={`tel:${h.number}`} className="text-[10px] font-semibold text-blood-ink underline underline-offset-2">
                        {h.name} · {h.number}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions — donor accepted */}
          {reveal.status === 'donor-accepted' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="secondary" icon={<Users className="w-4 h-4" />}>WhatsApp</Button>
              </a>
              <Button size="sm" variant="success" onClick={() => handleCloseSos("Fulfilled")} loading={closing} icon={<Check className="w-4 h-4" />}>
                {en("Mark as Fulfilled", "مکمل ہو گئی")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleCloseSos("Cancelled")} loading={closing} icon={<XCircle className="w-4 h-4" />}>
                {en("Cancel SOS", "منسوخ کریں")}
              </Button>
            </div>
          )}
          {panelMsg && <p className="text-[10px] mt-2 text-blood-ink">{panelMsg}</p>}
        </div>
      )}

      {/* Cancelled → offer a fresh start */}
      {mySos && reveal.status === 'cancelled' && (
        <div role="status" className="mb-5 p-4 rounded-xl bg-surface border border-border flex items-center gap-2.5">
          <XCircle className="w-4 h-4 text-muted shrink-0" />
          <p className="text-xs text-muted flex-1">{en("Request cancelled. You can raise a new SOS below.", "درخواست منسوخ کر دی گئی۔ نیچے نئی درخواست دیں۔")}</p>
          <Button size="sm" variant="ghost" onClick={clearMySos}>{en("New request", "نئی درخواست")}</Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-sm" noValidate={false}>
        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-xs bg-blood-soft border border-blood/25 text-blood-ink" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 1. Phone first — the only required field. */}
        <Input
          id="input-sos-phone"
          type="tel"
          label={en("Contact mobile number", "رابطہ نمبر")}
          placeholder="e.g. 0300 1234567"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          autoFocus
          autoComplete="tel"
          inputMode="tel"
          hint={en("Your number stays private — donors only see it after they accept your request.", "آپ کا نمبر نجی رہتا ہے۔")}
        />

        {/* 2. Blood group — large tappable chips, not a dropdown. */}
        <fieldset>
          <legend className="block font-semibold mb-1.5 text-xs text-ink">
            {en("Blood group needed", "خون کا گروپ")}
          </legend>
          <div className="grid grid-cols-4 gap-2" role="group" aria-label={en("Blood group", "خون کا گروپ")}>
            {BLOOD_GROUPS.map(g => (
              <button
                key={g}
                type="button"
                id={`chip-blood-${g}`}
                aria-pressed={bloodGroup === g}
                onClick={() => setBloodGroup(g)}
                className={`h-14 rounded-xl border-2 font-display font-extrabold text-base transition-all duration-150 flex flex-col items-center justify-center gap-0.5
                  ${bloodGroup === g
                    ? "bg-blood border-blood text-white shadow-1 scale-[1.02]"
                    : "bg-surface border-border text-ink hover:border-blood/50"}`}
              >
                {g}
                {g === "O-" && (
                  <span className={`text-[8px] font-sans font-semibold ${bloodGroup === g ? "text-white/90" : "text-muted"}`}>
                    {en("Universal", "یونیورسل")}
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>

        {/* 3. Units + city */}
        <div className="grid grid-cols-2 gap-4">
          <fieldset>
            <legend className="block font-semibold mb-1.5 text-xs text-ink">{en("Units", "بیگز")}</legend>
            <div className="flex items-center gap-1 h-14 rounded-xl border border-border bg-surface px-1.5">
              <button
                type="button"
                id="btn-sos-units-minus"
                aria-label={en("Fewer units", "کم بیگز")}
                onClick={() => setUnitsNeeded(u => Math.max(1, u - 1))}
                className="w-11 h-11 rounded-lg flex items-center justify-center text-ink hover:bg-surface-2 transition-colors duration-150"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span id="sos-units-value" className="flex-1 text-center font-display font-bold text-lg text-ink" aria-live="polite">{unitsNeeded}</span>
              <button
                type="button"
                id="btn-sos-units-plus"
                aria-label={en("More units", "زیادہ بیگز")}
                onClick={() => setUnitsNeeded(u => Math.min(10, u + 1))}
                className="w-11 h-11 rounded-lg flex items-center justify-center text-ink hover:bg-surface-2 transition-colors duration-150"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-2">
            <label className="block font-semibold mb-1.5 text-xs text-ink">{en("City", "شہر")}</label>
            <div className="flex flex-col gap-1.5">
              {SUPPORTED_CITIES.map(c => (
                <button
                  key={c}
                  type="button"
                  id={`chip-city-${c.toLowerCase()}`}
                  aria-pressed={city === c}
                  onClick={() => setCity(c)}
                  className={`h-[26px] rounded-lg border text-xs font-bold transition-colors duration-150
                    ${city === c ? "bg-ink text-white border-ink" : "bg-surface text-muted border-border hover:border-ink/40"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 4. Optional details — hidden in emergency mode. */}
        {!emergencyMode && (
          <div className="space-y-4 fade-in">
            <Input
              id="input-sos-patient-name"
              label={en("Patient name", "مریض کا نام")}
              optional
              placeholder="e.g. Muhammad Zubair"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />

            <div className="grid grid-cols-2 gap-4">
              <Select
                id="select-sos-urgency"
                label={en("Urgency", "شدت")}
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as any)}
              >
                <option value="Immediate (SOS)">Immediate (SOS)</option>
                <option value="Urgent">Urgent</option>
                <option value="Routine">Routine</option>
              </Select>

              <Select
                id="select-sos-hospital"
                label={en("Target hospital", "ہسپتال کا انتخاب")}
                optional
                value={hospitalId}
                onChange={(e) => setHospitalId(e.target.value)}
              >
                <option value="">{en("Nearest hospital", "قریب ترین ہسپتال")}</option>
                {hospitals.filter(h => h.city === city).map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="input-sos-reason" className="block font-semibold mb-1.5 text-xs text-ink">
                {en("Reason / diagnosis details", "علاج / تشخیص کی تفصیل")}
                <span className="ml-1 font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="input-sos-reason"
                rows={2}
                placeholder={en("e.g. Major surgery scheduled tomorrow morning", "مثلاً کل صبح بڑا آپریشن ہے")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-card border border-border-strong text-sm text-ink placeholder:text-muted/70 resize-none transition-colors duration-150 focus:ring-2 focus:ring-blood/15 focus:border-blood outline-none"
              />
            </div>
          </div>
        )}

        <Button
          id="btn-submit-sos-request"
          type="submit"
          size="lg"
          fullWidth
          loading={submitPhase === 'loading'}
          icon={submitPhase === 'success' ? <Check className="w-5 h-5" /> : <Heart className="w-5 h-5" />}
          className="tracking-wide"
        >
          {submitPhase === 'success'
            ? en("SOS Broadcast", "SOS بھیج دی گئی")
            : en("Broadcast SOS Alert", "ایس او ایس الرٹ نشر کریں")}
        </Button>
        {emergencyMode && (
          <p className="text-center text-[10px] text-muted">
            {en("Emergency mode: only essentials are sent. Matched donors are notified instantly.", "ایمرجنسی موڈ: صرف ضروری معلومات بھیجی جاتی ہیں۔")}
          </p>
        )}
      </form>
    </Card>
  );
}
