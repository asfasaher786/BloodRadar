import { useState, useEffect, useRef, Suspense, lazy } from "react";
import { Hospital, BloodCamp, Donor, EmergencyRequest, RealtimeNotification } from "./types";
import { API_BASE } from "./lib/api";
import brandIcon from "./assets/brand-icon.png";
import { motion, useReducedMotion } from "motion/react";
import {
  Heart, Droplets, Building2, Calendar, MapPin,
  Bell, Users, AlertTriangle, Phone, Sparkles, WifiOff,
  Activity, Zap, ChevronRight, X, Menu, TrendingUp, CheckCircle2, Lock, Info
} from "lucide-react";

import SOSRequestForm from "./components/SOSRequestForm";
import DonorSearch from "./components/DonorSearch";
import AdminPanel from "./components/AdminPanel";
import DonorStreakBadge from "./components/DonorStreakBadge";
import DonorInbox from "./components/DonorInbox";
import DonorAlerts from "./components/DonorAlerts";
import OrgPortal from "./components/OrgPortal";
import Badge from "./components/ui/Badge";
import PageSkeleton from "./components/PageSkeleton";
import AnimatedNumber from "./components/ui/AnimatedNumber";
import Skeleton, { SkeletonStats } from "./components/ui/Skeleton";
import SosReportButton from "./components/SosReportButton";

// Code-split the heaviest widgets (Leaflet map bundle, charts, ML panel,
// chatbot) so the first paint ships a small shell — each lazy chunk only
// downloads when the user actually reaches that part of the page.
const MapComponent = lazy(() => import("./components/MapComponent"));
const AIChatbot = lazy(() => import("./components/AIChatbot"));
const StatsDashboard = lazy(() => import("./components/StatsDashboard"));
const RealMLPanel = lazy(() => import("./components/RealMLPanel"));

// Suspense fallback that mirrors the real map card's chrome (header bar +
// 420px map area) so the layout doesn't jump when the Leaflet chunk arrives.
function MapCardSkeleton() {
  return (
    <div className="bg-[var(--card)] rounded-2xl border border-[var(--border)] overflow-hidden relative shadow-sm" role="status" aria-label="Loading live blood map">
      <div className="p-4 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-[var(--blood)] rounded-full animate-ping" />
          <Skeleton className="h-4 w-28 rounded" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>
      <Skeleton className="w-full rounded-none" style={{ height: "420px" }} />
    </div>
  );
}

// TZ-safe formatting for ISO review dates from the seed data ("2026-09-11").
const REVIEW_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatReviewedDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = REVIEW_MONTHS[Number(m) - 1] || m;
  return `${Number(d)} ${month} ${y}`;
}

export default function App() {
  const reduceMotion = useReducedMotion();
  const [lang] = useState<'en'>('en'); // English-only for now — see README
  const [activeTab, setActiveTab] = useState<'hospitals' | 'camps' | 'analytics' | 'ml-playground'>('hospitals');
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [camps, setCamps] = useState<BloodCamp[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([]);
  const [currentUserDonor, setCurrentUserDonor] = useState<Donor | null>(null);
  const [meRole, setMeRole] = useState<string>("donor");
  const [selectedItem, setSelectedItem] = useState<Hospital | BloodCamp | null>(null);
  const [flashSOS, setFlashSOS] = useState(false);
  const [activeDonorTab, setActiveDonorTab] = useState<'search' | 'register'>('search');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dismissedAlert, setDismissedAlert] = useState(false);
  const [highlightedSosIds, setHighlightedSosIds] = useState<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const alertRef = useRef<HTMLDivElement>(null);
  // Snapshot of id→status from the last successful load, so a live update
  // (SSE → loadData) can flash only the cards that actually changed.
  const prevSosRef = useRef<Map<string, string> | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const loadData = async () => {
    try {
      const [hospRes, campRes, donorRes, emergRes, notifRes, meRes] = await Promise.all([
        fetch(`${API_BASE}/api/hospitals`),
        fetch(`${API_BASE}/api/camps`),
        fetch(`${API_BASE}/api/donors`),
        fetch(`${API_BASE}/api/emergencies`),
        fetch(`${API_BASE}/api/notifications`),
        // The logged-in donor's own profile comes from the server session
        // (httpOnly cookie), never from guessing against the public masked list.
        fetch(`${API_BASE}/api/auth/me`, { credentials: "include" }),
      ]);
      if (hospRes.ok) setHospitals(await hospRes.json());
      if (campRes.ok) setCamps(await campRes.json());
      if (donorRes.ok) setDonors(await donorRes.json());
      if (emergRes.ok) {
        const list: EmergencyRequest[] = await emergRes.json();
        // Flash only newly-arrived or status-changed SOS cards — never the
        // whole board on first paint.
        const prev = prevSosRef.current;
        if (prev) {
          const changed = new Set<string>();
          list.forEach(sos => {
            const prevStatus = prev.get(sos.id);
            if (prevStatus === undefined || prevStatus !== sos.status) changed.add(sos.id);
          });
          if (changed.size > 0) {
            setHighlightedSosIds(changed);
            if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
            highlightTimerRef.current = window.setTimeout(() => setHighlightedSosIds(new Set()), 1600);
          }
        }
        prevSosRef.current = new Map(list.map(s => [s.id, s.status]));
        setEmergencies(list);
      }
      if (notifRes.ok) setNotifications(await notifRes.json());
      if (meRes.ok) {
        const data = await meRes.json();
        // Role must be set even when the user has no donor profile —
        // admins and org staff are not donors, but the app still needs
        // to know who they are (e.g. to show the Admin Dashboard).
        setMeRole(data.user?.role || "donor");
        setCurrentUserDonor(data.user?.donor || null);
      }
    } catch (e) {
      console.error("Data load failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Live updates: the board and donor inbox refresh the moment an SOS is
  // created, its status changes, or a donor accepts a contact request.
  // Events are PII-free by contract (ids/status only) — details via loadData.
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events`);
    const refresh = () => loadData();
    es.addEventListener("emergency-created", refresh);
    es.addEventListener("emergency-status-changed", refresh);
    es.addEventListener("contact-request-accepted", refresh);
    es.addEventListener("contact-request-declined", refresh);
    return () => es.close();
  }, []);

  // Offline detection: when the network drops, show the "call directly"
  // banner so someone mid-emergency is never left staring at a stale page.
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const handleSOSSuccess = () => { loadData(); document.getElementById("emergencies-board")?.scrollIntoView({ behavior: 'smooth' }); };
  const handleCampRegistration = async (campId: string) => {
    await fetch(`${API_BASE}/api/camps/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campId }) });
    loadData();
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
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading BloodRadar — donors, hospitals and live emergencies…</span>
      <PageSkeleton />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>

      {/* Skip link — WCAG 2.4.1 bypass block for keyboard/screen-reader users */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-ink focus:text-white focus:font-semibold focus:text-sm focus:shadow-3">
        {lang === 'en' ? 'Skip to content' : 'مواد پر جائیں'}
      </a>

      {/* OFFLINE BANNER — honest, actionable: never leave an emergency user
          staring at a stale page. Numbers are the same hotlines as the card below. */}
      {!isOnline && (
        <div
          role="status"
          className="relative z-50 border-b-2 px-4 py-3"
          style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)', color: 'var(--warn-ink)' }}
        >
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <WifiOff className="w-4 h-4 shrink-0" style={{ color: 'var(--warn-ink)' }} aria-hidden="true" />
              <p className="text-xs sm:text-sm font-semibold">
                You're offline — the map and live updates won't refresh. In an emergency, call the hospital directly:
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {[
                { name: 'PIMS', number: '+92 51 9261170' },
                { name: 'Holy Family', number: '+92 51 9290321' },
                { name: 'Shifa', number: '+92 51 8463000' },
                { name: 'Rescue 1122', number: '1122' },
              ].map(({ name, number }) => (
                <a
                  key={name}
                  href={`tel:${number}`}
                  className="font-mono text-xs sm:text-sm font-bold underline underline-offset-2 hover:opacity-75 transition"
                  style={{ color: 'var(--warn-ink)' }}
                >
                  {name} {number}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* EMERGENCY TICKER — entrance-only (exit gating stalls in throttled
          tabs; dismissing must be instant) */}
      {unreadCount > 0 && !dismissedAlert && activeAlert && (
        <section aria-label={lang === 'en' ? 'Live emergency SOS alert' : 'لائیو ہنگامی ایس او ایس الرٹ'}>
        <motion.div
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          role="alert"
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
                <button onClick={readAllNotifications} className="text-white hover:text-white/90 text-xs font-semibold underline transition whitespace-nowrap">
                  {lang === 'en' ? 'Dismiss' : 'بند کریں'}
                </button>
                <button onClick={() => setDismissedAlert(true)} aria-label={lang === 'en' ? 'Hide SOS alert' : 'بند کریں'} className="text-white/80 hover:text-white transition">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        </section>
      )}

      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo — crimson brand icon (drop + radar sweep) */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center relative overflow-hidden shrink-0">
              <img src={brandIcon} alt="BloodRadar logo" className="w-full h-full object-cover" />
              {pendingEmergencies.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold font-mono" style={{ background: 'var(--blood-light)' }}>
                  {pendingEmergencies.length}
                </span>
              )}
            </div>
            <div>
              <div className="font-display font-extrabold text-base tracking-tight leading-none" style={{ color: 'var(--ink)' }}>
                Blood<span style={{ color: 'var(--blood)' }}>Radar</span>
              </div>
              <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--muted)' }}>Islamabad &amp; Rawalpindi</div>
            </div>
          </div>

          {/* Desktop Nav Actions */}
          <div className="hidden md:flex items-center gap-3">
            {unreadCount > 0 && (
              <button onClick={() => alertRef.current?.scrollIntoView({ behavior: 'smooth' })} aria-label={lang === 'en' ? `Notifications — ${unreadCount} unread` : `اطلاعات — ${unreadCount} نئی`} className="relative p-2 rounded-lg transition" style={{ background: 'var(--surface-2)' }}>
                <Bell className="w-4 h-4" style={{ color: 'var(--muted)' }} aria-hidden="true" />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: 'var(--blood)' }} aria-hidden="true" />
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
          <button
            className="md:hidden p-2 rounded-lg"
            style={{ background: 'var(--surface-2)' }}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
          </button>
        </div>

        {/* Mobile menu dropdown — entrance-only, no exit gating (exit
            animations stall in throttled/hidden tabs; close must be instant). */}
        {mobileMenuOpen && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="md:hidden border-t px-4 py-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {[
              { href: '#emergencies-board', icon: Activity, label: lang === 'en' ? 'Live Emergencies' : 'لائیو ہنگامی' },
              { href: '#sos-form', icon: AlertTriangle, label: lang === 'en' ? 'Request Blood (SOS)' : 'خون مانگیں (SOS)' },
              { href: '#donor-search', icon: Users, label: lang === 'en' ? 'Find Donors' : 'عطیہ دہندگان تلاش کریں' },
              { href: '#org-portal', icon: Building2, label: 'For Organizations' },
            ].map(({ href, icon: Icon, label }) => (
              <a key={href} href={href} onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition hover:bg-surface-2"
                style={{ color: 'var(--ink)' }}>
                <Icon className="w-4 h-4" style={{ color: 'var(--blood)' }} aria-hidden="true" />
                {label}
              </a>
            ))}
          </motion.div>
        )}
      </header>

      {/* HERO */}
      <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-10 pb-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-5">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-3 py-1.5 rounded-full border mb-4 bg-blood-soft border-blood/20 text-blood-ink">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-blood" />
              {lang === 'en' ? 'LIVE · Rawalpindi & Islamabad Operations' : 'لائیو · راولپنڈی اور اسلام آباد'}
            </span>
            <h1 className="font-display font-extrabold text-4xl md:text-5xl lg:text-6xl leading-[1.05] tracking-tight" style={{ color: 'var(--ink)' }}>
              {lang === 'en' ? <>Every Second<br /><span style={{ color: 'var(--blood)' }}>Saves a Life.</span></> : <>ہر لمحہ<br /><span style={{ color: 'var(--blood)' }}>زندگی بچاتا ہے۔</span></>}
            </h1>
            <p className="text-base md:text-lg mt-4 leading-relaxed max-w-xl" style={{ color: 'var(--muted)' }}>
              {lang === 'en'
                ? "Find compatible blood donors faster in Islamabad & Rawalpindi. An early-stage community project: real donors, verified by phone, connected privately to people who need blood right now."
                : "اسلام آباد اور راولپنڈی میں خون کے عطیہ دہندگان تک تیزی سے رسائی۔ ابتدائی مرحلے کا کمیونٹی منصوبہ۔"}
            </p>
          </motion.div>

          {/* Stats pills */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex flex-wrap gap-3">
            {[
              { icon: Users, val: donors.length, suffix: '+', label: lang === 'en' ? 'Donors' : 'عطیہ دہندگان' },
              { icon: Building2, val: hospitals.length, suffix: '', label: lang === 'en' ? 'Hospitals' : 'ہسپتال' },
              { icon: Zap, val: pendingEmergencies.length, suffix: '', label: lang === 'en' ? 'Active SOS' : 'فعال SOS', urgent: pendingEmergencies.length > 0 },
            ].map(({ icon: Icon, val, suffix, label, urgent }) => (
              <div key={label} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm bg-card ${urgent ? 'border-blood/30' : 'border-border'}`}>
                <Icon className={`w-4 h-4 ${urgent ? 'text-blood' : 'text-muted'}`} />
                <span className={`font-display font-bold ${urgent ? 'text-blood' : 'text-ink'}`}>
                  <AnimatedNumber value={val} suffix={suffix} />
                </span>
                <span className="text-xs text-muted">{label}</span>
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

        {/* Donor badge + inbox */}
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="lg:col-span-5 space-y-6">
          {currentUserDonor && (
            <DonorStreakBadge donor={currentUserDonor} onToggleAvailability={handleToggleCurrentUserAvailability} onDonorUpdated={handleDonorProfileUpdated} lang={lang} />
          )}
          {currentUserDonor && meRole === 'donor' && (
            <DonorInbox lang={lang} onChanged={loadData} />
          )}
          {currentUserDonor && (
            <DonorAlerts onChanged={loadData} />
          )}
        </motion.div>
      </section>

      {/* MAIN CONTENT */}
      <main id="main-content" className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* LEFT — Map + Directory */}
        <div className="lg:col-span-8 space-y-6">
          <Suspense fallback={<MapCardSkeleton />}>
            <MapComponent hospitals={hospitals} camps={camps} selectedItem={selectedItem} onSelectItem={(item) => { setSelectedItem(item); }} lang={lang} />
          </Suspense>

          {/* Directory Tabs */}
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
            {/* Tab Nav */}
            <div
              role="tablist"
              aria-label={lang === 'en' ? 'Directory sections' : 'ڈائریکٹری سیکشنز'}
              onKeyDown={(e) => {
                const idx = TABS.findIndex(t => t.id === activeTab);
                let next = -1;
                if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
                else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
                else if (e.key === 'Home') next = 0;
                else if (e.key === 'End') next = TABS.length - 1;
                if (next >= 0) {
                  e.preventDefault();
                  setActiveTab(TABS[next].id);
                  document.getElementById(`tab-${TABS[next].id}`)?.focus();
                }
              }}
              className="flex gap-1 p-1.5 border-b" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}>
              {TABS.map(({ id, label, icon: Icon }) => (
                <button key={id} id={`tab-${id}`} role="tab" aria-selected={activeTab === id} aria-label={label} onClick={() => setActiveTab(id as any)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition ${activeTab === id ? 'bg-card text-blood shadow-1' : 'text-muted'}`}>
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            <div role="tabpanel" className="p-5 min-h-72">
              {/* Deliberately no AnimatePresence/mode="wait" here: exit-animation
                  gating stalls tab switches in throttled/hidden tabs (rAF paused)
                  and for reduced-motion users. Entrance-only motion keeps the
                  switch instant while P2.8 reworks motion properly. */}
              {activeTab === 'hospitals' && (
                  <motion.div key="hospitals" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    {hospitals.some(h => h.isSample) && (
                      <div role="note" className="mb-4 p-3.5 rounded-xl flex items-start gap-2.5 bg-warn-soft border border-warn/30">
                        <Info className="w-4 h-4 shrink-0 mt-0.5 text-warn-ink" />
                        <p className="text-xs leading-relaxed text-warn-ink">
                          <span className="font-bold">Sample data — not live inventory. </span>
                          {lang === 'en'
                            ? 'Stock levels below were compiled from public information and are not connected to hospital systems. Always call the hospital to confirm before travelling.'
                            : 'نیچے دیا گیا اسٹاک نمونے کا ڈیٹا ہے — لائیو نہیں۔ سفر سے پہلے ہسپتال کو کال کر کے تصدیق کریں۔'}
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {hospitals.map(h => (
                      <button key={h.id} onClick={() => setSelectedItem(h)} className={`text-left p-4 rounded-xl border transition-all ${selectedItem?.id === h.id ? 'bg-blood-soft border-blood' : 'bg-surface border-border'}`}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="font-display font-bold text-sm leading-tight" style={{ color: 'var(--ink)' }}>{h.name}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>{h.address}</div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            {h.isSample && <Badge tone="warn" mono>Sample</Badge>}
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border border-border text-muted">{h.city.slice(0, 3).toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] mb-3" style={{ color: 'var(--muted)' }}>
                          <Phone className="w-3 h-3" /> {h.phone}
                          <span className="ml-auto font-semibold" style={{ color: 'var(--safe-ink)' }}>● {h.emergencyHours}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {Object.entries(h.bloodAvailability).slice(0, 4).map(([grp, stock]) => (
                            <div key={grp} className="rounded text-center py-1 text-[9px] font-mono border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                              <div className="font-bold" style={{ color: 'var(--ink)' }}>{grp}</div>
                              <div style={{ color: stock === 'In Stock' ? 'var(--safe)' : stock === 'Low' ? 'var(--warn)' : 'var(--blood)' }}>{stock === 'In Stock' ? '✓' : stock === 'Low' ? '!' : '✗'}</div>
                            </div>
                          ))}
                        </div>
                        {h.stockLastUpdated && (
                          <div className="mt-2 text-[9px] font-mono text-muted">
                            {lang === 'en' ? `Stock last reviewed ${formatReviewedDate(h.stockLastUpdated)}` : `اسٹاک آخری بار ${formatReviewedDate(h.stockLastUpdated)} کو دیکھا گیا`}
                          </div>
                        )}
                        <div className="mt-3 flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--blood)' }}>
                          <MapPin className="w-3 h-3" /> {lang === 'en' ? 'Show on map' : 'نقشے پر دیکھیں'} <ChevronRight className="w-3 h-3" />
                        </div>
                      </button>
                    ))}
                    </div>
                  </motion.div>
                )}
                {activeTab === 'camps' && (
                  <motion.div key="camps" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    {camps.some(c => c.isSample) && (
                      <div role="note" className="mb-4 p-3.5 rounded-xl flex items-start gap-2.5 bg-warn-soft border border-warn/30">
                        <Info className="w-4 h-4 shrink-0 mt-0.5 text-warn-ink" />
                        <p className="text-xs leading-relaxed text-warn-ink">
                          <span className="font-bold">Sample data. </span>
                          {lang === 'en'
                            ? 'Camp listings below are sample entries for demonstration. Check with the organizer before travelling.'
                            : 'نیچے دیے گئے کیمپ نمونے کے اندراجات ہیں۔ سفر سے پہلے منتظم سے تصدیق کریں۔'}
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {camps.map(c => (
                      <div key={c.id} className="p-4 rounded-xl border flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border bg-warn-soft border-warn/30 text-warn-ink">CAMP</span>
                          {c.isSample && <Badge tone="warn" mono>Sample</Badge>}
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
                            style={{ background: 'var(--blood)' }}>
                            {lang === 'en' ? `Register (${c.registeredCount})` : `اندراج (${c.registeredCount})`}
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                  </motion.div>
                )}
                {activeTab === 'analytics' && <motion.div key="analytics" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Suspense fallback={<div className="p-5" role="status" aria-label="Loading analytics"><SkeletonStats /></div>}><StatsDashboard lang={lang} /></Suspense></motion.div>}
                {activeTab === 'ml-playground' && <motion.div key="ml" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Suspense fallback={<div className="p-5" role="status" aria-label="Loading ML lab"><SkeletonStats /></div>}><RealMLPanel lang={lang} /></Suspense></motion.div>}
            </div>
          </div>

          {/* EMERGENCIES BOARD */}
          <div id="emergencies-board" className="rounded-2xl border" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--blood)', animation: 'blood-pulse 2s ease-in-out infinite' }} />
                <h2 className="font-display font-bold text-base" style={{ color: 'var(--ink)' }}>
                  {lang === 'en' ? 'Active Emergency SOS' : 'فعال ہنگامی SOS'}
                </h2>
              </div>
              <span className="font-mono text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}><AnimatedNumber value={pendingEmergencies.length} /> pending</span>
            </div>
            {/* Screen-reader summary of the board state — announced when the
                count changes via SSE, without the animated counter noise. */}
            <p aria-live="polite" className="sr-only">
              {pendingEmergencies.length === 0
                ? (lang === 'en' ? 'No active emergencies.' : 'کوئی فعال ہنگامی صورتحال نہیں۔')
                : (lang === 'en' ? `${pendingEmergencies.length} active emergencies pending.` : `${pendingEmergencies.length} فعال ہنگامی درخواستیں زیر التوا ہیں۔`)}
            </p>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {emergencies.length === 0 && <p className="text-sm col-span-2 text-center py-8" style={{ color: 'var(--muted)' }}>No active emergencies right now.</p>}
              {emergencies.map(sos => (
                <div key={sos.id} className={`p-4 rounded-xl border transition-all ${highlightedSosIds.has(sos.id) ? 'live-highlight' : ''} ${sos.status === 'Fulfilled' ? 'bg-surface border-border opacity-60' : 'bg-blood-soft/50 border-blood/25'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className={`inline-block text-[9px] font-mono font-bold px-1.5 py-0.5 rounded mb-1.5 ${sos.urgency === 'Immediate (SOS)' ? 'bg-blood text-white' : 'bg-warn-soft text-warn-ink'}`}>
                        {sos.urgency}
                      </span>
                      <div className="font-display font-bold text-sm" style={{ color: 'var(--ink)' }}>{sos.patientName}</div>
                    </div>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-display font-black shrink-0" style={{ background: 'var(--blood)' }}>{sos.bloodGroup}</div>
                  </div>
                  <p className="text-[11px] mb-2 leading-relaxed" style={{ color: 'var(--muted)' }}>{sos.reason}</p>
                  <div className="text-[10px] space-y-1 mb-3" style={{ color: 'var(--muted)' }}>
                    <div>🏥 {sos.hospitalName}</div>
                    {sos.postedBy === 'organization' && sos.orgName && (
                      <div>🏛️ Posted by <span className="font-semibold" style={{ color: 'var(--ink)' }}>{sos.orgName}</span> · verified organization</div>
                    )}
                    <div>⏰ Required by <span className="font-semibold" style={{ color: 'var(--blood)' }}>{sos.requiredBy}</span></div>
                    <div>👥 <span className="font-semibold" style={{ color: 'var(--safe-ink)' }}>{sos.matchingDonorsCount} compatible donors</span> nearby</div>
                  </div>
                  {sos.status === 'Pending' ? (
                    <div className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs bg-blood-soft border border-blood/15 text-muted">
                      <Lock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--blood)' }} />
                      <span>
                        {lang === 'en'
                          ? `Contact ${sos.contactPhone} — the full number is revealed privately when a donor accepts the request.`
                          : `رابطہ ${sos.contactPhone} — مکمل نمبر صرف رضاکار کے قبول کرنے پر ظاہر ہوتا ہے۔`}
                      </span>
                    </div>
                  ) : sos.status === 'Cancelled' ? (
                    <div className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                      <X className="w-4 h-4" /> {lang === 'en' ? 'Cancelled by requester' : 'درخواست گزار نے منسوخ کر دیا'}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg bg-safe-soft text-safe-ink">
                      <CheckCircle2 className="w-4 h-4" /> {lang === 'en' ? 'Fulfilled · Lives Saved' : 'مکمل · زندگی بچائی گئی'}
                    </div>
                  )}
                  <SosReportButton sosId={sos.id} lang={lang} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-4 space-y-6">
          {/* SOS Form */}
          <div id="sos-form" className={`transition-all duration-200 rounded-2xl ${flashSOS ? 'sos-ring' : ''}`}>
            <SOSRequestForm hospitals={hospitals} onSuccess={handleSOSSuccess} lang={lang} />
          </div>

          {/* Donor Search */}
          <div id="donor-search">
            <DonorSearch donors={donors} lang={lang} onReviewSubmitted={loadData} activeTab={activeDonorTab} setActiveTab={setActiveDonorTab} />
          </div>

          {/* Admin Dashboard — only rendered for the admin role so ordinary
              visitors never see (or fetch) moderation tools. */}
          {meRole === 'admin' && <AdminPanel onDataChanged={loadData} />}

          {/* Organization Portal */}
          <OrgPortal lang={lang} hospitals={hospitals} onDataChanged={loadData} />

          {/* Emergency Hotlines */}
          <div className="rounded-2xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
            <h2 className="font-display font-bold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
              <Phone className="w-4 h-4" style={{ color: 'var(--blood)' }} />
              {lang === 'en' ? '24/7 Emergency Hotlines' : 'ہنگامی رابطہ نمبرز'}
            </h2>
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
        <p className="text-xs" style={{ color: 'var(--muted)' }}>© 2026 BloodRadar · Islamabad &amp; Rawalpindi, Pakistan — an early-stage community project</p>
        <p className="text-[10px] mt-1 italic" style={{ color: 'var(--muted)', opacity: 0.7 }}>"A drop given in time is a lifetime returned."</p>
      </footer>

      {/* AI Chatbot */}
      <Suspense fallback={null}>
        <AIChatbot lang={lang} onEmergencyTriggered={handleAIEmergencyTrigger} />
      </Suspense>
    </div>
  );
}
