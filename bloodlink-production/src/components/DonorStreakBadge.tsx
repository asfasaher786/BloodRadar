import { useState } from "react";
import { Donor } from "../types";
import { API_BASE } from "../lib/api";
import { Award, Zap, Heart, Shield, RefreshCw } from "lucide-react";

interface DonorStreakBadgeProps {
  donor: Donor;
  onToggleAvailability: (available: boolean) => void;
  onDonorUpdated: (donor: Donor) => void;
}

export default function DonorStreakBadge({ donor, onToggleAvailability, onDonorUpdated }: DonorStreakBadgeProps) {
  const [loading, setLoading] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState("");
  const [logSuccess, setLogSuccess] = useState(false);

  // Identity comes from the login session (httpOnly cookies), never from the
  // client — the backend 401s if you are not the verified owner of this profile.
  const handleToggle = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/donors/toggle-availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isAvailable: !donor.isAvailable })
      });
      if (response.ok) {
        const data = await response.json();
        onToggleAvailability(data.donor.isAvailable);
      } else if (response.status === 401) {
        setLogError("Session expired — verify your number again.");
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
        credentials: "include"
      });
      const data = await response.json();
      if (response.ok) {
        onDonorUpdated(data.donor);
        setLogSuccess(true);
        setTimeout(() => setLogSuccess(false), 4000);
      } else if (response.status === 401) {
        setLogError("Please verify your phone number first to log donations.");
      } else {
        setLogError(data.error || "Couldn't log this donation.");
      }
    } catch {
      setLogError("Network error. Try again.");
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
          <span className="px-2 py-0.5 rounded text-xs font-mono tracking-widest font-bold" style={{ background: 'rgba(196,18,48,0.06)', border: '1px solid rgba(196,18,48,0.2)', color: 'var(--blood)' }}>
            Donor Profile
          </span>
          <h2 className="text-sm font-display font-bold mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
            {donor.name}
            {/* Decorative dot — the text status below carries the meaning
                (never colour alone). */}
            <span className="w-2 h-2 rounded-full" aria-hidden="true" style={{ background: 'var(--safe)' }}></span>
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            Registered {donor.bloodGroup} donor
          </p>
        </div>

        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-display font-bold text-sm select-none" style={{ background: 'rgba(196,18,48,0.08)', border: '1px solid rgba(196,18,48,0.2)', color: 'var(--blood)' }}>
          {donor.bloodGroup}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3.5 mt-5 border-t border-b py-3.5 relative z-10 text-center font-sans text-xs" style={{ borderColor: 'var(--border)' }}>
        <div>
          <div className="flex items-center justify-center gap-1 font-bold" style={{ color: 'var(--warn-ink)' }}>
            <Zap className="w-4 h-4" style={{ fill: 'var(--warn-ink)' }} />
            <span>{donor.stats.streakCount}</span>
          </div>
          <span className="block text-xs mt-1 font-mono" style={{ color: 'var(--muted)' }}>
            Streak Days
          </span>
        </div>

        <div>
          <div className="font-bold flex items-center justify-center gap-1" style={{ color: 'var(--blood)' }}>
            <Heart className="w-4 h-4" style={{ fill: 'var(--blood)' }} />
            <span>{donor.stats.donationsCount}</span>
          </div>
          <span className="block text-xs mt-1 font-mono" style={{ color: 'var(--muted)' }}>
            Bags Donated
          </span>
        </div>

        <div>
          <div className="font-bold flex items-center justify-center gap-1" style={{ color: 'var(--safe-ink)' }}>
            <Shield className="w-4 h-4" />
            <span>{donor.stats.livesSaved}</span>
          </div>
          <span className="block text-xs mt-1 font-mono" style={{ color: 'var(--muted)' }}>
            Lives Saved
          </span>
        </div>
      </div>

      <div className="mt-4 relative z-10">
        <span className="block text-xs font-mono uppercase font-bold tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
          Unlocked Medals:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {donor.badges.map((badge, idx) => (
            <span key={idx} className="px-2.5 py-1 rounded text-xs font-sans tracking-wide flex items-center gap-1" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
              <Award className="w-3 h-3" style={{ color: 'var(--warn-ink)' }} />
              {badge}
            </span>
          ))}
        </div>
      </div>

      {donor.nextEligibleDate && (
        <div className="mt-3 relative z-10 flex items-center gap-1.5 text-xs font-sans px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(0,196,140,0.06)', border: '1px solid rgba(0,196,140,0.2)', color: 'var(--safe-ink)' }}>
          <Shield className="w-3 h-3 shrink-0" />
          <span>
            Eligible to donate again from {donor.nextEligibleDate}
          </span>
        </div>
      )}

      <div className="mt-4 relative z-10">
        <button
          id="btn-log-donation"
          onClick={handleLogDonation}
          disabled={logging}
          className="w-full py-2 rounded-xl font-display font-bold text-xs tracking-wide transition font-sans flex items-center justify-center gap-1.5 text-white disabled:opacity-50"
          style={{ background: 'var(--blood)' }}
        >
          {logging ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Heart className="w-3.5 h-3.5" />}
          {logging ? 'Logging...' : 'I Just Donated Blood'}
        </button>
        {logError && <p className="text-xs mt-1.5 text-center font-sans" style={{ color: 'var(--danger-text)' }}>{logError}</p>}
        {logSuccess && (
          <p className="text-xs mt-1.5 text-center font-sans font-semibold" style={{ color: 'var(--safe-ink)' }}>
            Recorded — thank you for saving lives.
          </p>
        )}
      </div>

      <div className="mt-4 pt-4 border-t flex items-center justify-between text-xs relative z-10 font-sans" style={{ borderColor: 'var(--border)' }}>
        <span style={{ color: 'var(--muted)' }}>
          Emergency Active Status
        </span>
        <button
          id="btn-toggle-availability-streak"
          onClick={handleToggle}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all duration-300"
          style={donor.isAvailable
            ? { background: 'rgba(0,196,140,0.08)', border: '1px solid rgba(0,196,140,0.3)', color: 'var(--safe-ink)' }
            : { background: 'rgba(196,18,48,0.06)', border: '1px solid rgba(196,18,48,0.25)', color: 'var(--blood)' }}
        >
          {loading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin mx-auto" />
          ) : donor.isAvailable ? (
            '● AVAILABLE'
          ) : (
            '○ OFFLINE'
          )}
        </button>
      </div>
    </div>
  );
}
