import { useState, useEffect, useRef } from "react";
import { Hospital, BloodCamp, Donor, EmergencyRequest, RealtimeNotification } from "./types";
import { API_BASE } from "./lib/api";
import logoImage from "./assets/logo.png";
import { motion, AnimatePresence } from "motion/react";
import {
  Heart, Droplets, Building2, Calendar, MapPin, Search,
  Bell, Award, Users, AlertTriangle, ShieldCheck, Phone, Sparkles,
  Activity, Zap, ChevronRight, X, Menu, TrendingUp, Clock, CheckCircle2
} from "lucide-react";

import MapComponent from "./components/MapComponent";
import AIChatbot from "./components/AIChatbot";
import SOSRequestForm from "./components/SOSRequestForm";
import DonorSearch from "./components/DonorSearch";
import StatsDashboard from "./components/StatsDashboard";
import DonorStreakBadge from "./components/DonorStreakBadge";
import RealMLPanel from "./components/RealMLPanel";

export default function App() {
  const [lang] = useState<'en'>('en'); // English-only for now — see README
  const [activeTab, setActiveTab] = useState<'hospitals' | 'camps' | 'analytics' | 'ml-playground'>('hospitals');
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [camps, setCamps] = useState<BloodCamp[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([]);
  const [currentUserDonor, setCurrentUserDonor] = useState<Donor | null>(null);
  const [selectedItem, setSelectedItem] = useState<Hospital | BloodCamp | null>(null);
  const [flashSOS, setFlashSOS] = useState(false);
  const [activeDonorTab, setActiveDonorTab] = useState<'search' | 'register'>('search');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dismissedAlert, setDismissedAlert] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    try {
      const [hospRes, campRes, donorRes, emergRes, notifRes] = await Promise.all([
        fetch(`${API_BASE}/api/hospitals`),
        fetch(`${API_BASE}/api/camps`),
        fetch(`${API_BASE}/api/donors`),
        fetch(`${API_BASE}/api/emergencies`),
        fetch(`${API_BASE}/api/notifications`),
      ]);
      if (hospRes.ok) setHospitals(await hospRes.json());
      if (campRes.ok) setCamps(await campRes.json());
      if (donorRes.ok) {
        const dList = await donorRes.json();
        setDonors(dList);
        const myPhone = localStorage.getItem("bloodradar_my_donor_phone");
        const me = myPhone ? dList.find((d: Donor) => d.phone === myPhone) : null;
        setCurrentUserDonor(me || null);
      }
      if (emergRes.ok) setEmergencies(await emergRes.json());
      if (notifRes.ok) setNotifications(await notifRes.json());
    } catch (e) {
      console.error("Data load failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSOSSuccess = () => { loadData(); document.getElementById("emergencies-board")?.scrollIntoView({ behavior: 'smooth' }); };
  const handleCampRegistration = async (campId: string) => {
    await fetch(`${API_BASE}/api/camps/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campId }) });
    loadData();
  };
  const handleFulfillSOS = async (sosId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/emergencies/${sosId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Fulfilled" })
      });
      if (!response.ok) {
        console.error("Failed to mark request as fulfilled:", await response.text());
        return;
      }
      loadData();
    } catch (err) {
      console.error("Network error marking request as fulfilled:", err);
    }
  };
  const handleToggleCurrentUserAvailability = (isAvailable: boolean) => {
    if (currentUserDonor) { setCurrentUserDonor({ ...currentUserDonor, isAvailable }); loadData(); }
  };

  const handleDonorProfileUpdated = (updatedDonor: Donor) => {
    setCurrentUserDonor(updatedDonor);
    loadData();
  };
  const handleAIEmergencyTrigger = () => {
    setFlashSOS(true);
    setTimeout(() => setFlashSOS(false), 6000);
    document.getElementById("sos-form")?.scrollIntoView({ behavior: 'smooth' });
  };
  const readAllNotifications = async () => {
    await fetch(`${API_BASE}/api/notifications/read-all`, { method: "POST" });
    setDismissedAlert(true);
    loadData();
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const pendingEmergencies = emergencies.filter(e => e.status === 'Pending');
  const activeAlert = notifications.find(n => n.type === 'emergency' && !n.read);

  const TABS = [
    { id: 'hospitals', label: lang === 'en' ? 'Hospitals' : 'ہسپتال', icon: Building2 },
    { id: 'camps', label: lang === 'en' ? 'Camps' : 'کیمپ', icon: Calendar },
    { id: 'analytics', label: lang === 'en' ? 'Analytics' : 'تجزیہ', icon: TrendingUp },
    { id: 'ml-playground', label: '🧪 Real ML Lab', icon: Sparkles },
  ] as const;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface)' }}>
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto overflow-hidden blood-pulse" style={{ background: '#1a1a1a' }}>
          <img src={logoImage} alt="BloodRadar logo" className="w-full h-full object-cover" />
        </div>
        <p className="font-display font-bold text-lg" style={{ color: 'var(--ink)' }}>BloodRadar</p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Connecting donors across Pakistan...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>

      {/* EMERGENCY TICKER */}
      <AnimatePresence>
        {unreadCount > 0 && !dismissedAlert && activeAlert && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative overflow-hidden z-50"
            style={{ background: 'var(--blood)' }}
          >
            <div className="flex items-center justify-between px-4 py-2 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                  <span className="font-mono text-[10px] font-bold text-white tracking-widest uppercase">LIVE SOS</span>
                </div>
                <div className="overflow-hidden flex-1">
                  <div className="text-white text-xs font-medium truncate">{activeAlert.message}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={readAllNotifications} className="text-white/80 hover:text-white text-xs font-semibold underline transition whitespace-nowrap">
                  {lang === 'en' ? 'Dismiss' : 'بند کریں'}
                </button>
                <button onClick={() => setDismissedAlert(true)} className="text-white/60 hover:text-white transition">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* NAV */}
      <header className="sticky top-0 z-40 border-b" style={{ background: 'rgba(245,240,235,0.92)', backdropFilter: 'blur(12px)', borderColor: 'var(--border)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center relative overflow-hidden" style={{ background: '#1a1a1a' }}>
              <img src={logoImage} alt="BloodRadar logo" className="w-full h-full object-cover" />
              {pendingEmergencies.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold font-mono" style={{ background: 'var(--blood-light)' }}>
                  {pendingEmergencies.length}
                </span>
              )}
            </div>
            <div>
              <div className="font-display font-extrabold text-base tracking-tight leading-none" style={{ color: 'var(--ink)' }}>
                Blood<span style={{ color: 'var(--blood)' }}>Link</span>
                <span className="ml-1 text-[10px] font-mono font-normal px-1.5 py-0.5 rounded" style={{ background: 'var(--blood)', color: 'white' }}>AI</span>
              </div>
              <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--muted)' }}>Pakistan Crisis Response</div>
            </div>
          </div>

          {/* Desktop Nav Actions */}
          <div className="hidden md:flex items-center gap-3">
            {unreadCount > 0 && (
              <button onClick={() => alertRef.current?.scrollIntoView({ behavior: 'smooth' })} className="relative p-2 rounded-lg transition" style={{ background: 'var(--surface-2)' }}>
                <Bell className="w-4 h-4" style={{ color: 'var(--muted)' }} />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: 'var(--blood)' }} />
              </button>
            )}
            {currentUserDonor && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: currentUserDonor.isAvailable ? 'var(--safe)' : 'var(--muted)' }} />
                <span className="font-medium" style={{ color: 'var(--ink)' }}>{currentUserDonor.name.split(' ')[0]}</span>
                <span className="font-mono font-bold px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'var(--blood)', color: 'white' }}>{currentUserDonor.bloodGroup}</span>
              </div>
            )}
          </div>

          {/* Mobile menu */}
          <button className="md:hidden p-2 rounded-lg" style={{ background: 'var(--surface-2)' }} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu dropdown */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="md:hidden border-t px-4 py-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* HERO */}
      <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-10 pb-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-5">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-3 py-1.5 rounded-full border mb-4"
              style={{ background: 'rgba(196,18,48,0.06)', borderColor: 'rgba(196,18,48,0.2)', color: 'var(--blood)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--blood)' }} />
              {lang === 'en' ? 'LIVE · Rawalpindi & Islamabad Operations' : 'لائیو · راولپنڈی اور اسلام آباد'}
            </span>
            <h1 className="font-display font-extrabold text-4xl md:text-5xl lg:text-6xl leading-[1.05] tracking-tight" style={{ color: 'var(--ink)' }}>
              {lang === 'en' ? <>Every Second<br /><span style={{ color: 'var(--blood)' }}>Saves a Life.</span></> : <>ہر لمحہ<br /><span style={{ color: 'var(--blood)' }}>زندگی بچاتا ہے۔</span></>}
            </h1>
            <p className="text-base md:text-lg mt-4 leading-relaxed max-w-xl" style={{ color: 'var(--muted)' }}>
              {lang === 'en'
                ? "Pakistan's most intelligent blood donation network. AI-powered matching, live SOS broadcasting, and real-time donor coordination across Twin Cities."
                : "پاکستان کا سب سے ذہین خون عطیہ نیٹ ورک۔ AI سے چلنے والی میچنگ اور ریئل ٹائم ڈونر رابطہ۔"}
            </p>
          </motion.div>

          {/* Stats pills */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex flex-wrap gap-3">
            {[
              { icon: Users, val: `${donors.length}+`, label: lang === 'en' ? 'Donors' : 'عطیہ دہندگان' },
              { icon: Building2, val: `${hospitals.length}`, label: lang === 'en' ? 'Hospitals' : 'ہسپتال' },
              { icon: Zap, val: `${pendingEmergencies.length}`, label: lang === 'en' ? 'Active SOS' : 'فعال SOS', urgent: pendingEmergencies.length > 0 },
            ].map(({ icon: Icon, val, label, urgent }) => (
              <div key={label} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm" style={{ background: 'var(--card)', borderColor: urgent ? 'rgba(196,18,48,0.3)' : 'var(--border)' }}>
                <Icon className="w-4 h-4" style={{ color: urgent ? 'var(--blood)' : 'var(--muted)' }} />
                <span className="font-display font-bold" style={{ color: urgent ? 'var(--blood)' : 'var(--ink)' }}>{val}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
              </div>
            ))}
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="flex flex-wrap gap-3 pt-1">
            <a href="#emergencies-board" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-display font-bold text-sm text-white transition hover:opacity-90" style={{ background: 'var(--blood)' }}>
              <Activity className="w-4 h-4" />
              {lang === 'en' ? 'View Live Emergencies' : 'ہنگامی فیڈ دیکھیں'}
            </a>
            <a href="#sos-form" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-display font-bold text-sm border transition hover:border-current" style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
              <AlertTriangle className="w-4 h-4" style={{ color: 'var(--blood)' }} />
              {lang === 'en' ? 'Request Blood (SOS)' : 'خون مانگیں (SOS)'}
            </a>
          </motion.div>
        </div>

        {/* Donor badge */}
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="lg:col-span-5">
          {currentUserDonor && (
            <DonorStreakBadge donor={currentUserDonor} onToggleAvailability={handleToggleCurrentUserAvailability} onDonorUpdated={handleDonorProfileUpdated} lang={lang} />
          )}
        </motion.div>
      </section>

      {/* MAIN CONTENT */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* LEFT — Map + Directory */}
        <div className="lg:col-span-8 space-y-6">
          <MapComponent hospitals={hospitals} camps={camps} selectedItem={selectedItem} onSelectItem={(item) => { setSelectedItem(item); }} lang={lang} />

          {/* Directory Tabs */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
            {/* Tab Nav */}
            <div className="flex gap-1 p-1.5 border-b" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setActiveTab(id as any)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition"
                  style={{
                    background: activeTab === id ? 'var(--card)' : 'transparent',
                    color: activeTab === id ? 'var(--blood)' : 'var(--muted)',
                    boxShadow: activeTab === id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            <div className="p-5 min-h-72">
              <AnimatePresence mode="wait">
                {activeTab === 'hospitals' && (
                  <motion.div key="hospitals" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {hospitals.map(h => (
                      <button key={h.id} onClick={() => setSelectedItem(h)} className="text-left p-4 rounded-xl border transition-all" style={{
                        background: selectedItem?.id === h.id ? 'rgba(196,18,48,0.04)' : 'var(--surface)',
                        borderColor: selectedItem?.id === h.id ? 'var(--blood)' : 'var(--border)',
                      }}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="font-display font-bold text-sm leading-tight" style={{ color: 'var(--ink)' }}>{h.name}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>{h.address}</div>
                          </div>
                          <span className="shrink-0 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ml-2" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>{h.city.slice(0, 3).toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] mb-3" style={{ color: 'var(--muted)' }}>
                          <Phone className="w-3 h-3" /> {h.phone}
                          <span className="ml-auto font-semibold" style={{ color: 'var(--safe)' }}>● {h.emergencyHours}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {Object.entries(h.bloodAvailability).slice(0, 4).map(([grp, stock]) => (
                            <div key={grp} className="rounded text-center py-1 text-[9px] font-mono border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                              <div className="font-bold" style={{ color: 'var(--ink)' }}>{grp}</div>
                              <div style={{ color: stock === 'In Stock' ? 'var(--safe)' : stock === 'Low' ? 'var(--warn)' : 'var(--blood)' }}>{stock === 'In Stock' ? '✓' : stock === 'Low' ? '!' : '✗'}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--blood)' }}>
                          <MapPin className="w-3 h-3" /> {lang === 'en' ? 'Show on map' : 'نقشے پر دیکھیں'} <ChevronRight className="w-3 h-3" />
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
                {activeTab === 'camps' && (
                  <motion.div key="camps" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {camps.map(c => (
                      <div key={c.id} className="p-4 rounded-xl border flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border" style={{ background: 'rgba(255,179,0,0.1)', borderColor: 'rgba(255,179,0,0.3)', color: 'var(--warn)' }}>CAMP</span>
                          <span className="text-[10px] ml-auto" style={{ color: 'var(--muted)' }}>{c.city}</span>
                        </div>
                        <div className="font-display font-bold text-sm mb-1" style={{ color: 'var(--ink)' }}>{c.title}</div>
                        <div className="text-[11px] mb-2" style={{ color: 'var(--muted)' }}>📍 {c.location}</div>
                        <div className="text-[11px] leading-relaxed mb-3 flex-1" style={{ color: 'var(--muted)' }}>{c.description}</div>
                        <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                          <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                            <div className="font-semibold">📅 {c.date}</div>
                            <div className="font-mono">{c.time}</div>
                          </div>
                          <button onClick={() => handleCampRegistration(c.id)}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition hover:opacity-90"
                            style={{ background: 'var(--warn)' }}>
                            {lang === 'en' ? `Register (${c.registeredCount})` : `اندراج (${c.registeredCount})`}
                          </button>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}
                {activeTab === 'analytics' && <motion.div key="analytics" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><StatsDashboard lang={lang} /></motion.div>}
                {activeTab === 'ml-playground' && <motion.div key="ml" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><RealMLPanel lang={lang} /></motion.div>}
              </AnimatePresence>
            </div>
          </div>

          {/* EMERGENCIES BOARD */}
          <div id="emergencies-board" className="rounded-2xl border" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--blood)', animation: 'blood-pulse 2s ease-in-out infinite' }} />
                <h3 className="font-display font-bold text-base" style={{ color: 'var(--ink)' }}>
                  {lang === 'en' ? 'Active Emergency SOS' : 'فعال ہنگامی SOS'}
                </h3>
              </div>
              <span className="font-mono text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>{pendingEmergencies.length} pending</span>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {emergencies.length === 0 && <p className="text-sm col-span-2 text-center py-8" style={{ color: 'var(--muted)' }}>No active emergencies right now.</p>}
              {emergencies.map(sos => (
                <div key={sos.id} className="p-4 rounded-xl border transition-all" style={{
                  background: sos.status === 'Fulfilled' ? 'var(--surface)' : 'rgba(196,18,48,0.03)',
                  borderColor: sos.status === 'Fulfilled' ? 'var(--border)' : 'rgba(196,18,48,0.25)',
                  opacity: sos.status === 'Fulfilled' ? 0.6 : 1,
                }}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className={`inline-block text-[9px] font-mono font-bold px-1.5 py-0.5 rounded mb-1.5 ${sos.urgency === 'Immediate (SOS)' ? 'text-white' : ''}`}
                        style={{ background: sos.urgency === 'Immediate (SOS)' ? 'var(--blood)' : 'rgba(255,179,0,0.15)', color: sos.urgency === 'Immediate (SOS)' ? 'white' : 'var(--warn)' }}>
                        {sos.urgency}
                      </span>
                      <div className="font-display font-bold text-sm" style={{ color: 'var(--ink)' }}>{sos.patientName}</div>
                    </div>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-display font-black shrink-0" style={{ background: 'var(--blood)' }}>{sos.bloodGroup}</div>
                  </div>
                  <p className="text-[11px] mb-2 leading-relaxed" style={{ color: 'var(--muted)' }}>{sos.reason}</p>
                  <div className="text-[10px] space-y-1 mb-3" style={{ color: 'var(--muted)' }}>
                    <div>🏥 {sos.hospitalName}</div>
                    <div>⏰ Required by <span className="font-semibold" style={{ color: 'var(--blood)' }}>{sos.requiredBy}</span></div>
                    <div>👥 <span className="font-semibold" style={{ color: 'var(--safe)' }}>{sos.matchingDonorsCount} compatible donors</span> nearby</div>
                  </div>
                  {sos.status === 'Pending' ? (
                    <div className="flex gap-2">
                      <a href={`tel:${sos.contactPhone}`} className="flex-1 py-1.5 rounded-lg border text-center text-xs font-semibold flex items-center justify-center gap-1 transition hover:border-current" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                        <Phone className="w-3 h-3" /> Call
                      </a>
                      <button onClick={() => handleFulfillSOS(sos.id)} className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1 transition hover:opacity-90" style={{ background: 'var(--safe)' }}>
                        <ShieldCheck className="w-3.5 h-3.5" /> Fulfill
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg" style={{ background: 'rgba(0,196,140,0.08)', color: 'var(--safe)' }}>
                      <CheckCircle2 className="w-4 h-4" /> {lang === 'en' ? 'Fulfilled · Lives Saved' : 'مکمل · زندگی بچائی گئی'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-4 space-y-6">
          {/* SOS Form */}
          <div id="sos-form" className={`transition-all duration-500 rounded-2xl ${flashSOS ? 'sos-ring' : ''}`}>
            <SOSRequestForm hospitals={hospitals} onSuccess={handleSOSSuccess} lang={lang} />
          </div>

          {/* Donor Search */}
          <div id="donor-search">
            <DonorSearch donors={donors} lang={lang} onReviewSubmitted={loadData} activeTab={activeDonorTab} setActiveTab={setActiveDonorTab} />
          </div>

          {/* Emergency Hotlines */}
          <div className="rounded-2xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
            <h4 className="font-display font-bold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
              <Phone className="w-4 h-4" style={{ color: 'var(--blood)' }} />
              {lang === 'en' ? '24/7 Emergency Hotlines' : 'ہنگامی رابطہ نمبرز'}
            </h4>
            {[
              { name: 'PIMS Trauma', number: '+92 51 9261170' },
              { name: 'Holy Family', number: '+92 51 9290321' },
              { name: 'Shifa International', number: '+92 51 8463000' },
              { name: 'Rescue 1122', number: '1122' },
            ].map(({ name, number }) => (
              <a key={name} href={`tel:${number}`} className="flex items-center justify-between py-2.5 border-b last:border-0 group" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{name}</span>
                <span className="font-mono text-xs font-bold group-hover:underline" style={{ color: 'var(--blood)' }}>{number}</span>
              </a>
            ))}
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="border-t py-8 text-center" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
        <div className="flex items-center justify-center gap-2 mb-2">
          <Droplets className="w-4 h-4 fill-current" style={{ color: 'var(--blood)' }} />
          <span className="font-display font-bold text-sm" style={{ color: 'var(--ink)' }}>BloodRadar</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>© 2026 BloodRadar Pakistan · Islamabad & Rawalpindi Crisis Response</p>
        <p className="text-[10px] mt-1 italic" style={{ color: 'var(--muted)', opacity: 0.7 }}>"A drop given in time is a lifetime returned."</p>
      </footer>

      {/* AI Chatbot */}
      <AIChatbot lang={lang} onEmergencyTriggered={handleAIEmergencyTrigger} />
    </div>
  );
}
