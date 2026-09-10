import React, { useState } from "react";
import { Hospital } from "../types";
import { API_BASE } from "../lib/api";
import { AlertCircle, Heart, Users, Sparkles } from "lucide-react";
import { SUPPORTED_CITIES, DEFAULT_CITY } from "../lib/regions";

interface SOSRequestFormProps {
  hospitals: Hospital[];
  onSuccess: () => void;
  lang: 'en' | 'ur';
}

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
  const [lastRequest, setLastRequest] = useState<any>(null);

  const buildShareMessage = (req: any): string => {
    const name = req.patientName && !req.patientName.startsWith("Patient (") ? req.patientName : "a patient";
    return `⚠️ URGENT — ${req.bloodGroup} Blood Needed ⚠️\n` +
      `${name} urgently needs ${req.bloodGroup} blood (${req.unitsNeeded} unit${req.unitsNeeded > 1 ? "s" : ""}) at ${req.hospitalName}, ${req.city}.\n` +
      `📞 Contact: ${req.contactPhone}\n` +
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
    setLastRequest(null);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/emergencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientName, bloodGroup, unitsNeeded, hospitalId, contactPhone, reason, urgency, city })
      });

      if (response.ok) {
        const d = await response.json();
        setSuccessInfo({ matchingDonorsCount: d.request?.matchingDonorsCount ?? 0 });
        setLastRequest(d.request || null);
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

      <form onSubmit={handleSubmit} className="space-y-4 text-sm">
        {successInfo && (
          <div className="p-3.5 rounded-xl flex items-start gap-2.5" style={{ background: 'rgba(0,196,140,0.08)', border: '1px solid rgba(0,196,140,0.3)', color: 'var(--ink)' }}>
            <Heart className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--safe)' }} />
            <span className="text-xs">
              {lang === 'en'
                ? successInfo.matchingDonorsCount > 0
                  ? `Request sent. ${successInfo.matchingDonorsCount} compatible donors nearby have been notified.`
                  : `Request sent. We're still searching for nearby compatible donors — please also call the hospital directly.`
                : successInfo.matchingDonorsCount > 0
                  ? `درخواست بھیج دی گئی۔ قریب کے ${successInfo.matchingDonorsCount} موزوں عطیہ دہندگان کو مطلع کر دیا گیا ہے۔`
                  : `درخواست بھیج دی گئی۔ ہم قریبی عطیہ دہندگان تلاش کر رہے ہیں — براہ کرم ہسپتال سے براہ راست بھی رابطہ کریں۔`}
            </span>
          </div>
        )}

        {successInfo && lastRequest && (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(buildShareMessage(lastRequest))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-bold text-xs transition font-sans"
            style={successInfo.matchingDonorsCount === 0
              ? { background: 'var(--safe)', color: '#fff' }
              : { background: 'transparent', border: '1px solid var(--safe)', color: 'var(--safe)' }}
          >
            <Users className="w-3.5 h-3.5" />
            {lang === 'en'
              ? successInfo.matchingDonorsCount === 0
                ? "No matches yet on BloodRadar — share on WhatsApp to widen the search"
                : "Also share on WhatsApp to widen the search"
              : successInfo.matchingDonorsCount === 0
                ? "ابھی کوئی میچ نہیں ملا — واٹس ایپ پر شیئر کریں"
                : "واٹس ایپ پر بھی شیئر کریں"}
          </a>
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
