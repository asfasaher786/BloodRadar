import React, { useState, useEffect, useRef } from "react";
import { Hospital } from "../types";
import { API_BASE } from "../lib/api";
import { AlertCircle, Heart, Users, Sparkles, BellRing, CheckCircle2, PhoneCall, RefreshCw, XCircle, Eye } from "lucide-react";
import { SUPPORTED_CITIES, DEFAULT_CITY } from "../lib/regions";

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

interface RevealState {
  status: 'waiting' | 'fulfilled' | 'cancelled';
  donor?: { name: string; bloodGroup: string; phone: string; city: string } | null;
  acceptedAt?: string;
}

const SOS_STORAGE_KEY = "bloodradar_my_sos";

export default function SOSRequestForm({ hospitals, onSuccess, lang }: SOSRequestFormProps) {
  const [patientName, setPatientName] = useState("");
  const [bloodGroup, setBloodGroup] = useState("O-");
  const [unitsNeeded, setUnitsNeeded] = useState(1);
  const [hospitalId, setHospitalId] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [reason, setReason] = useState("");
  const [urgency, setUrgency] = useState<'Immediate (SOS)' | 'Urgent' | 'Routine'>("Immediate (SOS)");
  const [city, setCity] = useState<string>(DEFAULT_CITY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successInfo, setSuccessInfo] = useState<{ matchingDonorsCount: number } | null>(null);

  // Requester-side tracking of their live SOS (anonymous — proven by the
  // one-time code the server issued). Survives page refresh via localStorage.
  const [mySos, setMySos] = useState<MySos | null>(null);
  const [reveal, setReveal] = useState<RevealState>({ status: 'waiting' });
  const [notifiedCount, setNotifiedCount] = useState<number | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [panelMsg, setPanelMsg] = useState("");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore any SOS raised earlier in this browser (e.g. after refresh).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SOS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.code) {
          setMySos(parsed);
        }
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
          setReveal({ status: 'fulfilled', donor: data.donor || null, acceptedAt: data.acceptedAt });
          stopPolling();
        } else if (data.status === "waiting") {
          setReveal(prev => prev.status === 'waiting' ? prev : { status: 'waiting' });
        }
      } catch { /* transient network error — next poll retries */ }
    };
    check();
    pollTimer.current = setInterval(check, 15000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [mySos?.id, mySos?.code]);

  // Instant reveal: when any donor accepts, the SSE event carries only the
  // sosId — if it's OUR sos, poll the reveal endpoint immediately.
  useEffect(() => {
    if (!mySos) return;
    const es = new EventSource(`${API_BASE}/api/events`);
    const onEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data && data.sosId === mySos.id) {
          checkRevealNow();
        }
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
        setReveal({ status: 'fulfilled', donor: data.donor || null, acceptedAt: data.acceptedAt });
        stopPolling();
      }
    } catch { /* transient — interval will retry */ }
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
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
    if (!contactPhone) {
      setError(lang === 'en' ? "Please provide a contact phone number." : "براہ کرم رابطہ نمبر درج کریں۔");
      return;
    }
    setError("");
    setSuccessInfo(null);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/emergencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientName, bloodGroup, unitsNeeded, hospitalId, contactPhone, reason, urgency, city })
      });

      if (response.ok) {
        const d = await response.json();
        const myPhone = contactPhone;
        const sos: MySos = { id: d.request?.id, code: d.requesterCode, myPhone, request: d.request || null };
        setSuccessInfo({ matchingDonorsCount: d.request?.matchingDonorsCount ?? 0 });
        setMySos(sos);
        setReveal({ status: 'waiting' });
        setNotifiedCount(null);
        setPanelMsg("");
        localStorage.setItem(SOS_STORAGE_KEY, JSON.stringify(sos));
        setPatientName("");
        setContactPhone("");
        setReason("");
        setUnitsNeeded(1);
        onSuccess();
      } else {
        const d = await response.json();
        setError(d.error || "Failed to submit request.");
      }
    } catch (e) {
      setError("Server connection failed. Please try again.");
    } finally {
      setLoading(false);
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
        setPanelMsg(data.error || (lang === 'en' ? "Couldn't notify donors." : "عطیہ دہندگان کو مطلع نہیں کیا جا سکا۔"));
      }
    } catch {
      setPanelMsg(lang === 'en' ? "Network error. Try again." : "نیٹ ورک میں خرابی۔ دوبارہ کوشش کریں۔");
    } finally {
      setNotifying(false);
    }
  };

  const handleCancelSos = async () => {
    if (!mySos) return;
    try {
      const response = await fetch(`${API_BASE}/api/emergencies/${mySos.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Cancelled", requesterCode: mySos.code })
      });
      if (response.ok) {
        setReveal({ status: 'cancelled' });
        setMySos(null);
        localStorage.removeItem(SOS_STORAGE_KEY);
        stopPolling();
        onSuccess();
      } else {
        const data = await response.json();
        setPanelMsg(data.error || (lang === 'en' ? "Couldn't cancel." : "منسوخ نہیں ہو سکا۔"));
      }
    } catch {
      setPanelMsg(lang === 'en' ? "Network error. Try again." : "نیٹ ورک میں خرابی۔ دوبارہ کوشش کریں۔");
    }
  };

  const inputStyle = "w-full px-3.5 py-2.5 rounded-xl bg-transparent border transition font-sans text-sm outline-none";
  const inputBorder = { borderColor: 'var(--border)', color: 'var(--ink)' };

  return (
    <div id="sos-request-form-card" className="rounded-2xl border p-5 md:p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 blood-pulse" style={{ background: 'var(--blood)' }}>
          <AlertCircle className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-base md:text-lg font-display font-bold" style={{ color: 'var(--ink)' }}>
            {lang === 'en' ? 'Launch SOS Emergency Request' : 'فوری ہنگامی بلڈ کی درخواست'}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {lang === 'en' ? 'Broadcasts instantly to compatible donors nearby' : 'قریبی موزوں عطیہ دہندگان کو فوری مطلع کریں'}
          </p>
        </div>
      </div>

      {/* Live requester panel — shown while their SOS is active */}
      {mySos && reveal.status !== 'cancelled' && (
        <div className="mb-5 p-4 rounded-xl relative" style={{ background: 'rgba(196,18,48,0.04)', border: '1px solid rgba(196,18,48,0.25)' }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--blood)' }}>
              {reveal.status === 'fulfilled' ? <CheckCircle2 className="w-4.5 h-4.5 text-white" /> : <BellRing className="w-4.5 h-4.5 text-white animate-pulse" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold font-sans" style={{ color: 'var(--ink)' }}>
                {reveal.status === 'fulfilled'
                  ? (lang === 'en' ? 'A donor accepted your request!' : 'ایک عطیہ دہندہ نے آپ کی درخواست قبول کر لی!')
                  : (lang === 'en' ? 'Your SOS is live — waiting for a donor to accept' : 'آپ کی درخواست لائیو ہے — عطیہ دہندہ کے قبول کرنے کا انتظار ہے')}
              </p>

              {reveal.status === 'fulfilled' && reveal.donor && (
                <div className="mt-2 space-y-2">
                  <div className="p-3 rounded-lg flex items-center justify-between gap-3" style={{ background: 'rgba(0,196,140,0.08)', border: '1px solid rgba(0,196,140,0.3)' }}>
                    <div>
                      <p className="text-xs font-bold font-sans" style={{ color: 'var(--ink)' }}>
                        {reveal.donor.name} <span style={{ color: 'var(--blood)' }}>({reveal.donor.bloodGroup})</span>
                      </p>
                      <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--muted)' }}>
                        {reveal.donor.city}
                        {reveal.acceptedAt ? ` · ${new Date(reveal.acceptedAt).toLocaleString()}` : ''}
                      </p>
                    </div>
                    <a
                      href={`tel:${reveal.donor.phone}`}
                      className="px-3 py-2 rounded-lg text-[11px] font-bold text-white flex items-center gap-1.5 shrink-0 transition"
                      style={{ background: 'var(--safe)' }}
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      {lang === 'en' ? 'Call Now' : 'کال کریں'}
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(buildShareMessage(mySos.request, mySos.myPhone))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition"
                      style={{ border: '1px solid var(--safe)', color: 'var(--safe)' }}
                    >
                      <Users className="w-3.5 h-3.5" />
                      WhatsApp
                    </a>
                    <button
                      onClick={handleCancelSos}
                      className="px-3 py-2 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition"
                      style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {lang === 'en' ? 'Cancel SOS' : 'منسوخ کریں'}
                    </button>
                  </div>
                </div>
              )}

              {reveal.status === 'waiting' && (
                <div className="mt-2 space-y-2">
                  {notifiedCount !== null && (
                    <p className="text-[10px] font-sans" style={{ color: 'var(--muted)' }}>
                      <Eye className="w-3 h-3 inline mr-1" />
                      {notifiedCount > 0
                        ? (lang === 'en' ? `${notifiedCount} compatible donors notified` : `${notifiedCount} عطیہ دہندگان کو مطلع کیا گیا`)
                        : (lang === 'en' ? 'No compatible donors available right now — we keep retrying with new signups' : 'ابھی کوئی موزوں عطیہ دہندہ دستیاب نہیں')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleNotifyDonors}
                      disabled={notifying}
                      className="px-3 py-2 rounded-lg text-[11px] font-bold text-white flex items-center gap-1.5 transition disabled:opacity-50"
                      style={{ background: 'var(--blood)' }}
                    >
                      {notifying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
                      {lang === 'en' ? 'Notify Matching Donors' : 'عطیہ دہندگان کو مطلع کریں'}
                    </button>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(buildShareMessage(mySos.request, mySos.myPhone))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition"
                      style={{ border: '1px solid var(--safe)', color: 'var(--safe)' }}
                    >
                      <Users className="w-3.5 h-3.5" />
                      WhatsApp
                    </a>
                    <button
                      onClick={handleCancelSos}
                      className="px-3 py-2 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition"
                      style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {lang === 'en' ? 'Cancel SOS' : 'منسوخ کریں'}
                    </button>
                  </div>
                  <p className="text-[10px] font-sans" style={{ color: 'var(--muted)' }}>
                    {lang === 'en'
                      ? 'We check every 15 seconds and show the donor\'s number here the moment someone accepts.'
                      : 'ہم ہر 15 سیکنڈ بعد چیک کرتے ہیں — عطیہ دہندہ کا نمبر قبول ہوتے ہی یہاں دکھائی دے گا۔'}
                  </p>
                </div>
              )}
            </div>
          </div>
          {panelMsg && <p className="text-[10px] mt-2 font-sans" style={{ color: 'var(--blood-dark)' }}>{panelMsg}</p>}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-sm">
        {successInfo && !mySos && (
          <div className="p-3.5 rounded-xl flex items-start gap-2.5" style={{ background: 'rgba(0,196,140,0.08)', border: '1px solid rgba(0,196,140,0.3)', color: 'var(--ink)' }}>
            <Heart className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--safe)' }} />
            <span className="text-xs">
              {lang === 'en' ? 'Request sent.' : 'درخواست بھیج دی گئی۔'}
            </span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-xs" style={{ background: 'rgba(196,18,48,0.06)', border: '1px solid rgba(196,18,48,0.25)', color: 'var(--blood-dark)' }}>
            <AlertCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--blood)' }} />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block font-semibold mb-1.5 text-xs" style={{ color: 'var(--ink)' }}>
              {lang === 'en' ? 'Patient Name (optional)' : 'مریض کا نام (اختیاری)'}
            </label>
            <input
              id="input-sos-patient-name"
              type="text"
              placeholder="e.g. Muhammad Zubair"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              className={inputStyle}
              style={{ ...inputBorder, background: 'var(--surface)' }}
            />
          </div>

          <div>
            <label className="block font-semibold mb-1.5 text-xs" style={{ color: 'var(--ink)' }}>
              {lang === 'en' ? 'Contact Mobile No. *' : 'رابطہ نمبر *'}
            </label>
            <input
              id="input-sos-phone"
              type="tel"
              required
              placeholder="e.g. +92 333 9998822"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className={inputStyle}
              style={{ ...inputBorder, background: 'var(--surface)' }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block font-semibold mb-1.5 text-xs" style={{ color: 'var(--ink)' }}>
              {lang === 'en' ? 'Blood Group' : 'خون کا گروپ'}
            </label>
            <select
              id="select-sos-blood-group"
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
              className={inputStyle}
              style={{ ...inputBorder, background: 'var(--surface)' }}
            >
              {["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"].map(g => (
                <option key={g} value={g}>{g}{g === 'O-' ? ' (Universal)' : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1.5 text-xs" style={{ color: 'var(--ink)' }}>
              {lang === 'en' ? 'Units Count' : 'بیگز'}
            </label>
            <input
              id="input-sos-units"
              type="number"
              min="1"
              max="10"
              value={unitsNeeded}
              onChange={(e) => setUnitsNeeded(Number(e.target.value))}
              className={inputStyle}
              style={{ ...inputBorder, background: 'var(--surface)' }}
            />
          </div>

          <div>
            <label className="block font-semibold mb-1.5 text-xs" style={{ color: 'var(--ink)' }}>
              {lang === 'en' ? 'City' : 'شہر'}
            </label>
            <select
              id="select-sos-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputStyle}
              style={{ ...inputBorder, background: 'var(--surface)' }}
            >
              {SUPPORTED_CITIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1.5 text-xs" style={{ color: 'var(--ink)' }}>
              {lang === 'en' ? 'Urgency' : 'شدت'}
            </label>
            <select
              id="select-sos-urgency"
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as any)}
              className={inputStyle}
              style={{ ...inputBorder, background: 'var(--surface)' }}
            >
              <option value="Immediate (SOS)">Immediate (SOS)</option>
              <option value="Urgent">Urgent</option>
              <option value="Routine">Routine</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block font-semibold mb-1.5 text-xs" style={{ color: 'var(--ink)' }}>
            {lang === 'en' ? 'Target Hospital (optional)' : 'ہسپتال کا انتخاب (اختیاری)'}
          </label>
          <select
            id="select-sos-hospital"
            value={hospitalId}
            onChange={(e) => setHospitalId(e.target.value)}
            className={inputStyle}
            style={{ ...inputBorder, background: 'var(--surface)' }}
          >
            <option value="">{lang === 'en' ? "-- We'll pick the nearest hospital --" : "-- قریب ترین ہسپتال منتخب کیا جائے گا --"}</option>
            {hospitals.filter(h => h.city === city).map(h => (
              <option key={h.id} value={h.id}>{h.name} ({h.city})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block font-semibold mb-1.5 text-xs" style={{ color: 'var(--ink)' }}>
            {lang === 'en' ? 'Reason / Diagnosis details' : 'علاج / تشخیص کی تفصیل'}
          </label>
          <textarea
            id="input-sos-reason"
            rows={2}
            placeholder="e.g. Major surgery scheduled tomorrow morning. Needs platelets urgently"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputStyle + " resize-none"}
            style={{ ...inputBorder, background: 'var(--surface)' }}
          />
        </div>

        <button
          id="btn-submit-sos-request"
          type="submit"
          disabled={loading}
          className="w-full py-3.5 rounded-xl font-display font-bold text-center tracking-wide text-white transition duration-300 active:scale-[0.98] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 text-sm"
          style={{ background: 'var(--blood)' }}
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>{lang === 'en' ? 'BROADCAST SOS ALERT' : 'ایس او ایس الرٹ نشر کریں'}</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
