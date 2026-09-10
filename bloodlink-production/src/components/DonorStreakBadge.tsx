import { useState } from "react";
import { Donor } from "../types";
import { API_BASE } from "../lib/api";
import { Award, Zap, Heart, Shield, RefreshCw } from "lucide-react";

interface DonorStreakBadgeProps {
  donor: Donor;
  onToggleAvailability: (available: boolean) => void;
  onDonorUpdated: (donor: Donor) => void;
  lang: 'en' | 'ur';
}

export default function DonorStreakBadge({ donor, onToggleAvailability, onDonorUpdated, lang }: DonorStreakBadgeProps) {
  const [loading, setLoading] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState("");
  const [logSuccess, setLogSuccess] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/donors/toggle-availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: donor.phone, isAvailable: !donor.isAvailable })
      });
      if (response.ok) {
        const data = await response.json();
        onToggleAvailability(data.donor.isAvailable);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogDonation = async () => {
    setLogging(true);
    setLogError("");
    setLogSuccess(false);
    try {
      const response = await fetch(`${API_BASE}/api/donors/log-donation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: donor.phone })
      });
      const data = await response.json();
      if (response.ok) {
        onDonorUpdated(data.donor);
        setLogSuccess(true);
        setTimeout(() => setLogSuccess(false), 4000);
      } else {
        setLogError(data.error || (lang === 'en' ? "Couldn't log this donation." : "عطیہ درج نہیں ہو سکا۔"));
      }
    } catch {
      setLogError(lang === 'en' ? "Network error. Try again." : "نیٹ ورک میں خرابی۔");
    } finally {
      setLogging(false);
    }
  };

  return (
    <div id="donor-streak-gamification-card" className="rounded-2xl border p-5 relative overflow-hidden" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="absolute -right-8 -top-8 w-24 h-24 rounded-full blur-xl" style={{ background: 'rgba(196,18,48,0.05)' }}></div>
      <div className="absolute -left-8 -bottom-8 w-24 h-24 rounded-full blur-xl" style={{ background: 'rgba(0,196,140,0.05)' }}></div>

      <div className="flex items-start justify-between gap-3 relative z-10">
        <div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono tracking-widest font-bold" style={{ background: 'rgba(196,18,48,0.06)', border: '1px solid rgba(196,18,48,0.2)', color: 'var(--blood)' }}>
            {lang === 'en' ? 'Savior Account Profile' : 'رضاکار پروفائل'}
          </span>
          <h4 className="text-sm font-display font-bold mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
            {donor.name}
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--safe)' }}></span>
          </h4>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
            {lang === 'en' ? `Registered ${donor.bloodGroup} Emergency Hero` : 'مستقل ہیرو'}
          </p>
        </div>

        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-display font-bold text-sm select-none" style={{ background: 'rgba(196,18,48,0.08)', border: '1px solid rgba(196,18,48,0.2)', color: 'var(--blood)' }}>
          {donor.bloodGroup}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3.5 mt-5 border-t border-b py-3.5 relative z-10 text-center font-sans text-xs" style={{ borderColor: 'var(--border)' }}>
        <div>
          <div className="flex items-center justify-center gap-1 font-bold" style={{ color: 'var(--warn)' }}>
            <Zap className="w-4 h-4" style={{ fill: 'var(--warn)' }} />
            <span>{donor.stats.streakCount}</span>
          </div>
          <span className="block text-[10px] mt-1 font-mono" style={{ color: 'var(--muted)' }}>
            {lang === 'en' ? 'Streak Days' : 'تسلسل دن'}
          </span>
        </div>

        <div>
          <div className="font-bold flex items-center justify-center gap-1" style={{ color: 'var(--blood)' }}>
            <Heart className="w-4 h-4" style={{ fill: 'var(--blood)' }} />
            <span>{donor.stats.donationsCount}</span>
          </div>
          <span className="block text-[10px] mt-1 font-mono" style={{ color: 'var(--muted)' }}>
            {lang === 'en' ? 'Bags Donated' : 'عطیات بیگز'}
          </span>
        </div>

        <div>
          <div className="font-bold flex items-center justify-center gap-1" style={{ color: 'var(--safe)' }}>
            <Shield className="w-4 h-4" />
            <span>{donor.stats.livesSaved}</span>
          </div>
          <span className="block text-[10px] mt-1 font-mono" style={{ color: 'var(--muted)' }}>
            {lang === 'en' ? 'Lives Saved' : 'بچائی گئی جانیں'}
          </span>
        </div>
      </div>

      <div className="mt-4 relative z-10">
        <span className="block text-[10px] font-mono uppercase font-bold tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
          {lang === 'en' ? 'Unlocked Savior Medals:' : 'حاصل کردہ اعزازات:'}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {donor.badges.map((badge, idx) => (
            <span key={idx} className="px-2.5 py-1 rounded text-[9px] font-sans tracking-wide flex items-center gap-1" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
              <Award className="w-3 h-3" style={{ color: 'var(--warn)' }} />
              {badge}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 relative z-10">
        <button
          id="btn-log-donation"
          onClick={handleLogDonation}
          disabled={logging}
          className="w-full py-2 rounded-xl font-display font-bold text-[11px] tracking-wide transition font-sans flex items-center justify-center gap-1.5 text-white disabled:opacity-50"
          style={{ background: 'var(--blood)' }}
        >
          {logging ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Heart className="w-3.5 h-3.5" />}
          {logging
            ? (lang === 'en' ? 'Logging...' : 'درج ہو رہا ہے...')
            : (lang === 'en' ? 'I Just Donated Blood' : 'میں نے ابھی خون عطیہ کیا')}
        </button>
        {logError && <p className="text-[10px] mt-1.5 text-center font-sans" style={{ color: 'var(--blood)' }}>⚠️ {logError}</p>}
        {logSuccess && (
          <p className="text-[10px] mt-1.5 text-center font-sans font-semibold" style={{ color: 'var(--safe)' }}>
            {lang === 'en' ? '✅ Recorded — thank you for saving lives.' : '✅ درج ہو گیا — جان بچانے کا شکریہ۔'}
          </p>
        )}
      </div>

      <div className="mt-4 pt-4 border-t flex items-center justify-between text-xs relative z-10 font-sans" style={{ borderColor: 'var(--border)' }}>
        <span style={{ color: 'var(--muted)' }}>
          {lang === 'en' ? 'Emergency Active Status' : 'ہنگامی دستیابی کا سٹیٹس'}
        </span>
        <button
          id="btn-toggle-availability-streak"
          onClick={handleToggle}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all duration-300"
          style={donor.isAvailable
            ? { background: 'rgba(0,196,140,0.08)', border: '1px solid rgba(0,196,140,0.3)', color: 'var(--safe)' }
            : { background: 'rgba(196,18,48,0.06)', border: '1px solid rgba(196,18,48,0.25)', color: 'var(--blood)' }}
        >
          {loading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin mx-auto" />
          ) : donor.isAvailable ? (
            lang === 'en' ? '● AVAILABLE' : '● دستیاب'
          ) : (
            lang === 'en' ? '○ OFFLINE' : '○ غیر دستیاب'
          )}
        </button>
      </div>
    </div>
  );
}
