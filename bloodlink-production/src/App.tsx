import { useState, useEffect, useRef, Suspense, lazy } from "react";
import { Hospital, BloodCamp, Donor, EmergencyRequest, RealtimeNotification } from "./types";
import { API_BASE } from "./lib/api";
import brandIcon from "./assets/brand-icon.png";
import { motion, useReducedMotion } from "motion/react";
import {
  Heart, Droplets, Building2, Calendar, MapPin,
  Bell, Users, Phone, WifiOff,
  X, Menu, TrendingUp, Sparkles, CheckCircle2, Lock, Info,
  Clock, Siren, ChevronRight
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
import ListState from "./components/ui/ListState";
import SosReportButton from "./components/SosReportButton";
import HowItWorks from "./components/HowItWorks";
import { BecomeDonorBand, TrustBand } from "./components/HomeBands";

// Code-split the heaviest widgets (Leaflet map bundle, charts, ML panel,
// chatbot) so the first paint ships a small shell — each lazy chunk only
// downloads when the user actually reaches that part of the page.
const MapComponent = lazy(() => import("./components/MapComponent"));
const AIChatbot = lazy(() => import("./components/AIChatbot"));
const StatsDashboard = lazy(() => import("./components/StatsDashboard"));
const RealMLPanel = lazy(() => import("./components/RealMLPanel"));

// Suspense fallback that mirrors the real map card's chrome (header bar +
// responsive map area) so the layout doesn't jump when the Leaflet chunk
// arrives.
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
      <Skeleton className="w-full aspect-[4/5] sm:aspect-[16/10] rounded-none" />
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

// Relative "time ago" for the live-requests strip — computed from the real
// createdAt timestamp on each SOS, never a fake "just posted" label.
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor(Math.max(0, Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Header navigation. "Donate" switches the donor module to its register tab
// before scrolling — every nav item lands somewhere real.
const NAV_LINKS = [
  { label: "Find donors", target: "donor-search", donorTab: "search" as const },
  { label: "Live map", target: "map", donorTab: null },
  { label: "Blood banks", target: "blood-banks", donorTab: null },
  { label: "Donate", target: "donor-search", donorTab: "register" as const },
  { label: "Help", target: "help", donorTab: null },
];

export default function App() {
  const reduceMotion = useReducedMotion();
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
  const [notifOpen, setNotifOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dismissedAlert, setDismissedAlert] = useState(false);
  const [highlightedSosIds, setHighlightedSosIds] = useState<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  // Secondary /insights view (analytics + ML lab) — a hash-routed page so the
  // main emergency flow stays clean. Deep links work on first load too.
  const [view, setView] = useState<'home' | 'insights'>(() =>
    typeof window !== "undefined" && window.location.hash === "#insights" ? "insights" : "home"
  );
  // Mobile sticky bottom bar appears once the hero scrolls out of view.
  const [bottomBarVisible, setBottomBarVisible] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const notifPanelRef = useRef<HTMLDivElement>(null);
  // Snapshot of id→status from the last successful load, so a live update
  // (SSE → loadData) can flash only the cards that actually changed.
  const prevSosRef = useRef<Map<string, string> | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const loadData = async () => {
    setLoadFailed(false);
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
      setLoadFailed(true);
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

  // Hash routing: #insights opens the secondary analytics view; any other
  // hash returns to home. Native hash navigation handles the scrolling.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === "#insights") {
        setView("insights");
        window.scrollTo(0, 0);
      } else {
        setView("home");
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // After switching back to home (e.g. clicking a nav link while in the
  // insights view), the target section only exists post-render — scroll to
  // it once React has committed.
  useEffect(() => {
    if (view !== "home") return;
    const hash = window.location.hash;
    if (hash && hash !== "#top" && hash !== "#insights") {
      const el = document.getElementById(hash.slice(1));
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  }, [view]);

  // Mobile sticky bottom bar: IntersectionObserver on the hero. The hero only
  // exists after data loads, so the observer re-attaches when that flips.
  useEffect(() => {
    if (loading) return;
    const hero = document.getElementById("top");
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => setBottomBarVisible(!entries[0].isIntersecting),
      { rootMargin: "0px 0px -75% 0px" }
    );
    obs.observe(hero);
    return () => obs.disconnect();
  }, [loading]);

  // The AI assistant FAB lifts above the bar via a body class (see index.css).
  useEffect(() => {
    document.body.classList.toggle("bottom-bar-visible", bottomBarVisible);
    return () => document.body.classList.remove("bottom-bar-visible");
  }, [bottomBarVisible]);

  const scrollToId = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  // Notifications panel: close on outside press or Escape, like any popover.
  useEffect(() => {
    if (!notifOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (notifPanelRef.current?.contains(t) || bellRef.current?.contains(t)) return;
      setNotifOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [notifOpen]);

  const handleSOSSuccess = () => { loadData(); scrollToId("emergencies-board"); };
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
    // The SOS form only exists on the home view — leave the insights page
    // first so the ring-and-scroll actually lands somewhere visible.
    if (window.location.hash === "#insights") window.location.hash = "#sos-form";
    else scrollToId("sos-form");
  };
  const readAllNotifications = async () => {
    await fetch(`${API_BASE}/api/notifications/read-all`, { method: "POST" });
    setDismissedAlert(true);
    loadData();
  };
  // Nav handler: links use native hash navigation (real URLs, back-button
  // friendly). This only switches the donor module tab when the destination
  // is "Find donors" (search) or "Donate" (register), and re-scrolls if the
  // hash didn't actually change (repeat click on the same section).
  const goToNav = (donorTab: 'search' | 'register' | null, target: string) => {
    if (donorTab) setActiveDonorTab(donorTab);
    if (window.location.hash === `#${target}`) scrollToId(target);
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const sortedNotifications = [...notifications].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const pendingEmergencies = emergencies.filter(e => e.status === 'Pending');
  const activeAlert = notifications.find(n => n.type === 'emergency' && !n.read);

  const TABS = [
    { id: 'hospitals', label: 'Hospitals', icon: Building2 },
    { id: 'camps', label: 'Camps', icon: Calendar },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
    { id: 'ml-playground', label: 'Real ML Lab', icon: Sparkles },
  ] as const;

  // Mobile menu — emergency first. The first four labels are pinned by the
  // click-matrix E2E contract (exact names), the rest complete the nav.
  const MOBILE_ITEMS = [
    { label: 'Request Blood (SOS)', icon: Siren, target: 'sos-form', donorTab: null },
    { label: 'Live Emergencies', icon: Clock, target: 'emergencies-board', donorTab: null },
    { label: 'Find Donors', icon: Users, target: 'donor-search', donorTab: 'search' as const },
    { label: 'For Organizations', icon: Building2, target: 'org-portal', donorTab: null },
    { label: 'Live Map', icon: MapPin, target: 'map', donorTab: null },
    { label: 'Blood Banks', icon: Droplets, target: 'blood-banks', donorTab: null },
    { label: 'Donate', icon: Heart, target: 'donor-search', donorTab: 'register' as const },
    { label: 'Help', icon: Phone, target: 'help', donorTab: null },
  ];

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
        Skip to content
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
        <section aria-label="Live emergency SOS alert">
        <motion.div
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          role="alert"
          ref={alertRef}
          className="relative overflow-hidden z-50"
          style={{ background: 'var(--blood)' }}
        >
            <div className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 py-2 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                  <span className="font-mono text-xs font-bold text-white tracking-widest uppercase">LIVE SOS</span>
                </div>
                <div className="overflow-hidden flex-1">
                  <div className="text-white text-xs font-medium truncate">{activeAlert.message}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={readAllNotifications} className="text-white hover:text-white/90 text-xs font-semibold underline transition whitespace-nowrap">
                  Dismiss
                </button>
                <button onClick={() => setDismissedAlert(true)} aria-label="Hide SOS alert" className="text-white/80 hover:text-white transition">
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
          {/* Logo — BloodRadar shield emblem */}
          <a href="#top" className="flex items-center gap-3 min-w-0" aria-label="BloodRadar — back to top">
            <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0">
              <img src={brandIcon} alt="BloodRadar logo" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <div className="font-display font-extrabold text-base tracking-tight leading-none" style={{ color: 'var(--ink)' }}>
                Blood<span style={{ color: 'var(--blood)' }}>Radar</span>
              </div>
              <div className="text-xs font-mono mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Islamabad &amp; Rawalpindi</div>
            </div>
          </a>

          {/* Desktop nav links — native hash navigation (no preventDefault). */}
          <nav aria-label="Main navigation" className="hidden lg:flex flex-1 justify-center items-center gap-0.5 px-2 min-w-0">
            {NAV_LINKS.map(({ label, target, donorTab }) => (
              <a
                key={label}
                href={`#${target}`}
                onClick={() => goToNav(donorTab, target)}
                className="px-2.5 py-2 rounded-lg text-sm font-semibold text-muted hover:text-ink hover:bg-surface-2 transition-colors duration-150 whitespace-nowrap"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 md:gap-3 shrink-0 relative">
            {unreadCount > 0 && (
              <button
                ref={bellRef}
                onClick={() => setNotifOpen(o => !o)}
                aria-label={`Notifications — ${unreadCount} unread`}
                aria-expanded={notifOpen}
                aria-controls="notifications-panel"
                className="relative p-2 rounded-lg transition hover:bg-surface-2"
                style={{ background: 'var(--surface-2)' }}
              >
                <Bell className="w-4 h-4" style={{ color: 'var(--muted)' }} aria-hidden="true" />
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-white text-xs font-bold font-mono" style={{ background: 'var(--blood)' }} aria-hidden="true">
                  {unreadCount}
                </span>
              </button>
            )}

            {/* Notifications panel — real feed from /api/notifications; the bell
                only exists while something is unread, so the panel lives and
                dies with it (E2E contract: bell must go at 0 unread). */}
            {notifOpen && unreadCount > 0 && (
              <div
                id="notifications-panel"
                ref={notifPanelRef}
                role="region"
                aria-label="Notifications"
                className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border shadow-3 overflow-hidden"
                style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Notifications</span>
                  <button
                    onClick={() => { setNotifOpen(false); readAllNotifications(); }}
                    className="text-xs font-bold underline underline-offset-2 hover:opacity-75 transition"
                    style={{ color: 'var(--blood)' }}
                  >
                    Mark all as read
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {sortedNotifications.length === 0 ? (
                    <p className="px-3 py-6 text-xs text-center" style={{ color: 'var(--muted)' }}>
                      No notifications yet — new SOS broadcasts appear here.
                    </p>
                  ) : (
                    sortedNotifications.map(n => {
                      const label = n.type === 'emergency' ? 'SOS' : n.type === 'system' ? 'System' : 'Badge';
                      const inner = (
                        <>
                          <div className="flex items-center gap-1.5">
                            {!n.read && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--blood)' }} aria-hidden="true" />}
                            <span className="text-xs font-bold uppercase tracking-wide font-mono" style={{ color: 'var(--blood)' }}>{label}</span>
                            {n.isSample && (
                              <span className="text-xs font-mono px-1.5 py-0.5 rounded border shrink-0" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                                Sample data
                              </span>
                            )}
                            <span className="text-xs font-mono ml-auto shrink-0" style={{ color: 'var(--muted)' }}>{timeAgo(n.timestamp)}</span>
                          </div>
                          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink)' }}>{n.message}</p>
                        </>
                      );
                      const rowStyle = { borderColor: 'var(--border)' };
                      const rowClass = n.type === 'emergency'
                        ? `px-3 py-2.5 border-b transition hover:bg-surface-2 ${!n.read ? '' : 'opacity-60'}`
                        : `px-3 py-2.5 border-b ${!n.read ? '' : 'opacity-60'}`;
                      return n.type === 'emergency' ? (
                        <a key={n.id} href="#emergencies-board" onClick={() => setNotifOpen(false)} className={rowClass} style={rowStyle}>
                          {inner}
                        </a>
                      ) : (
                        <div key={n.id} className={rowClass} style={rowStyle}>
                          {inner}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {currentUserDonor && (
              <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: currentUserDonor.isAvailable ? 'var(--safe)' : 'var(--muted)' }} />
                <span className="font-medium" style={{ color: 'var(--ink)' }}>{currentUserDonor.name.split(' ')[0]}</span>
                <span className="font-mono font-bold px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--blood)', color: 'white' }}>{currentUserDonor.bloodGroup}</span>
              </div>
            )}

            {/* Request blood — the one always-visible red action. */}
            <a
              href="#sos-form"
              className="hidden md:inline-flex items-center gap-2 h-12 px-5 rounded-xl font-display font-bold text-sm text-white transition-all duration-150 shadow-2 hover:shadow-3 hover:-translate-y-px"
              style={{ background: 'var(--blood)' }}
            >
              <Heart className="w-4 h-4 fill-current" aria-hidden="true" />
              Request blood
            </a>
            {/* Compact SOS pill on small screens. */}
            <a
              href="#sos-form"
              className="md:hidden inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full font-display font-bold text-xs text-white transition-opacity duration-150 hover:opacity-90"
              style={{ background: 'var(--blood)' }}
            >
              <Siren className="w-4 h-4" aria-hidden="true" />
              SOS
            </a>

            {/* Mobile menu */}
            <button
              className="lg:hidden p-2 rounded-lg"
              style={{ background: 'var(--surface-2)' }}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown — native hash links so the URL changes (and
            the E2E contract holds); clicking closes the menu instantly. */}
        {mobileMenuOpen && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="lg:hidden border-t px-4 py-3 flex flex-col gap-1" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {MOBILE_ITEMS.map(({ label, icon: Icon, target, donorTab }) => (
              <a
                key={label}
                href={`#${target}`}
                onClick={() => { setMobileMenuOpen(false); goToNav(donorTab, target); }}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold transition hover:bg-surface-2"
                style={{ color: 'var(--ink)' }}
              >
                <Icon className="w-4 h-4" style={{ color: 'var(--blood)' }} aria-hidden="true" />
                {label}
              </a>
            ))}
          </motion.div>
        )}
      </header>

      {/* HERO — crisis-first: copy left, the SOS card itself right. */}
      <div id="top" className="hero-glow border-b border-border/60">
      <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-10 md:pt-14 pb-12 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-start">
        {/* Left — calm, confident copy. */}
        <div className="lg:col-span-6 space-y-6 fade-up">
          <span className="inline-flex items-center gap-2 text-xs font-mono font-semibold px-3 py-1.5 rounded-full border bg-blood-soft border-blood/20 text-blood-ink">
            <span className="w-1.5 h-1.5 rounded-full bg-blood" aria-hidden="true" />
            Islamabad &amp; Rawalpindi · Early-stage community project
          </span>
          <h1 className="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight" style={{ color: 'var(--ink)' }}>
            Find blood donors <span style={{ color: 'var(--blood)' }}>fast.</span>
          </h1>
          <p className="font-serif-accent text-2xl md:text-3xl" style={{ color: 'var(--ink)' }}>
            When every minute counts.
          </p>
          <p className="text-base md:text-lg leading-relaxed max-w-xl" style={{ color: 'var(--muted)' }}>
            Tell us the blood group and the city — we match you with compatible, phone-verified donors nearby and connect you privately.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a
              href="#sos-form"
              aria-label="Request Blood (SOS)"
              className="inline-flex items-center gap-2.5 px-7 py-4 rounded-2xl font-display font-bold text-base md:text-lg text-white transition-all duration-150 shadow-2 hover:shadow-3 hover:-translate-y-px"
              style={{ background: 'var(--blood)' }}
            >
              <Heart className="w-5 h-5 fill-current" aria-hidden="true" />
              Request blood now
            </a>
            <button
              onClick={() => goToNav('register', 'donor-search')}
              className="inline-flex items-center gap-2 px-5 py-4 rounded-2xl font-display font-bold text-sm md:text-base border transition-all duration-150 shadow-1 hover:shadow-2 hover:-translate-y-px"
              style={{ background: 'var(--card)', borderColor: 'var(--border-strong)', color: 'var(--ink)' }}
            >
              <Droplets className="w-4 h-4" style={{ color: 'var(--blood)' }} aria-hidden="true" />
              I want to donate
            </button>
          </div>

          {/* Honest live line — the real number, never a fake badge. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <p className="flex items-center gap-2.5" style={{ color: 'var(--muted)' }}>
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full" style={{ background: 'rgb(196 18 48 / 0.4)' }} />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: 'var(--blood)' }} />
              </span>
              {pendingEmergencies.length > 0 ? (
                <span><strong style={{ color: 'var(--ink)' }}>{pendingEmergencies.length}</strong> open request{pendingEmergencies.length === 1 ? '' : 's'} right now — every minute counts.</span>
              ) : (
                <span>No open requests right now. Yours would be the first on the board.</span>
              )}
            </p>
            <a
              href="#emergencies-board"
              className="inline-flex items-center gap-1 font-semibold transition-opacity duration-150 hover:opacity-75"
              style={{ color: 'var(--blood)' }}
            >
              View Live Emergencies
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        {/* Right — the SOS card, with the signature drop motif peeking out. */}
        <div className="lg:col-span-6 relative fade-up">
          <div className="absolute -top-7 -right-2 sm:-top-10 sm:-right-6 w-24 h-24 sm:w-28 sm:h-28 pointer-events-none z-0" aria-hidden="true">
            <svg viewBox="0 0 64 64" className="w-full h-full drop-breathe">
              <circle
                cx="32" cy="32" r="30"
                fill="none" stroke="rgb(196 18 48 / 0.35)" strokeWidth="1.5"
                className="ring-ping"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              />
              <path
                d="M32 10c7 9 14 16.2 14 22.5a14 14 0 1 1-28 0C18 26.2 25 19 32 10z"
                fill="rgb(196 18 48 / 0.10)" stroke="var(--blood)" strokeWidth="2" strokeLinejoin="round"
              />
              <path
                d="M26.5 34l4 4 7.5-8"
                fill="none" stroke="var(--blood)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </div>
          <div id="sos-form" className={`relative z-10 scroll-mt-24 ${flashSOS ? 'sos-ring' : ''}`}>
            <SOSRequestForm hospitals={hospitals} onSuccess={handleSOSSuccess} />
          </div>

          {/* Signed-in donor widgets live under the SOS card. */}
          {currentUserDonor && (
            <div className="relative z-10 mt-6 space-y-6">
              <DonorStreakBadge donor={currentUserDonor} onToggleAvailability={handleToggleCurrentUserAvailability} onDonorUpdated={handleDonorProfileUpdated} />
              {meRole === 'donor' && <DonorInbox onChanged={loadData} />}
              <DonorAlerts onChanged={loadData} />
            </div>
          )}
        </div>
      </section>
      </div>

      {/* MAIN CONTENT — full-bleed so the bands span edge to edge. */}
      {view === "insights" ? (
        <main id="main-content" className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 pb-28 md:pb-24">
          <div className="py-10 space-y-8">
            <div>
              <a href="#top" className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity duration-150 hover:opacity-75" style={{ color: 'var(--blood)' }}>
                <ChevronRight className="w-4 h-4 rotate-180" aria-hidden="true" />
                Back to home
              </a>
              <h2 className="font-display font-extrabold text-3xl md:text-4xl mt-4" style={{ color: 'var(--ink)' }}>Analytics &amp; ML lab</h2>
              <p className="text-sm md:text-base mt-3 max-w-2xl leading-relaxed" style={{ color: 'var(--muted)' }}>
                The real numbers from this deployment — nothing invented. The ML lab is a local, explainable demo of donor matching; it never makes medical decisions.
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              <Suspense fallback={<div className="p-5" role="status" aria-label="Loading analytics"><SkeletonStats /></div>}>
                <StatsDashboard />
              </Suspense>
              <Suspense fallback={<div className="p-5" role="status" aria-label="Loading ML lab"><SkeletonStats /></div>}>
                <RealMLPanel />
              </Suspense>
            </div>
          </div>
        </main>
      ) : (
      <main id="main-content" className="flex-1 pb-28 md:pb-24">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 space-y-8">

        {/* LIVE REQUESTS STRIP — the live truth, full width. Horizontal
            snap-scroll cards on mobile, grid on larger screens. Each card
            carries the real blood group (big), the hospital, how long ago
            the request was made, and one concrete action. */}
        <div id="emergencies-board" className="rounded-3xl border scroll-mt-24" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--blood)', animation: 'blood-pulse 2s ease-in-out infinite' }} />
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--ink)' }}>Live requests</h2>
            </div>
            <span className="font-mono text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}><AnimatedNumber value={pendingEmergencies.length} /> pending</span>
          </div>
          {/* Screen-reader summary of the board state — announced when the
              count changes via SSE, without the animated counter noise. */}
          <p aria-live="polite" className="sr-only">
            {pendingEmergencies.length === 0
              ? 'No active emergencies.'
              : `${pendingEmergencies.length} active emergencies pending.`}
          </p>
          {emergencies.length === 0 ? (
            loadFailed ? (
              <ListState
                kind="error"
                title="Couldn't reach the server."
                sub="Check your connection and try again. In an emergency, call the hospital blood bank directly."
                actionLabel="Try again"
                onAction={loadData}
              />
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>No open requests right now. That's good news.</p>
                <p className="text-sm mt-2 max-w-md mx-auto leading-relaxed" style={{ color: 'var(--muted)' }}>
                  If you can give blood,{" "}
                  <a
                    href="#donor-search"
                    onClick={() => setActiveDonorTab('register')}
                    className="font-semibold underline underline-offset-2 transition-opacity hover:opacity-75"
                    style={{ color: 'var(--blood)' }}
                  >
                    be the first to register as a donor
                  </a>{" "}
                  — you'll be alerted the moment someone needs your group.
                </p>
              </div>
            )
          ) : (
            <div className="p-5 flex gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory sm:grid sm:grid-cols-2 sm:overflow-visible">
              {emergencies.map(sos => (
                <article key={sos.id} className={`snap-start shrink-0 w-[85%] sm:w-auto p-4 rounded-xl border transition-all ${highlightedSosIds.has(sos.id) ? 'live-highlight' : ''} ${sos.status === 'Fulfilled' ? 'bg-surface border-border opacity-60' : 'bg-blood-soft/50 border-blood/25'}`}>
                  <div className="flex items-start gap-3 mb-2.5">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-mono font-bold shrink-0" style={{ background: 'var(--blood)' }} aria-label={`Blood group ${sos.bloodGroup}`}>
                      {sos.bloodGroup}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-display font-bold text-sm" style={{ color: 'var(--ink)' }}>{sos.patientName}</div>
                        <span className={`inline-block text-xs font-mono font-bold px-1.5 py-0.5 rounded ${sos.urgency === 'Immediate (SOS)' ? 'bg-blood text-white' : 'bg-warn-soft text-warn-ink'}`}>
                          {sos.urgency}
                        </span>
                      </div>
                      <div className="text-xs mt-1 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                        <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        {timeAgo(sos.createdAt)} · {sos.hospitalName}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs mb-2 leading-relaxed" style={{ color: 'var(--muted)' }}>{sos.reason}</p>
                  <div className="text-xs space-y-1 mb-3" style={{ color: 'var(--muted)' }}>
                    {sos.postedBy === 'organization' && sos.orgName && (
                      <div className="flex items-center gap-1.5">Posted by <span className="font-semibold" style={{ color: 'var(--ink)' }}>{sos.orgName}</span> · verified organization</div>
                    )}
                    <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Required by <span className="font-semibold" style={{ color: 'var(--blood)' }}>{sos.requiredBy}</span></div>
                    <div className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> <span className="font-semibold" style={{ color: 'var(--safe-ink)' }}>{sos.matchingDonorsCount} compatible donors</span> nearby</div>
                  </div>
                  {sos.status === 'Pending' ? (
                    <div className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs bg-blood-soft border border-blood/15 text-muted">
                      <Lock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--blood)' }} />
                      <span>
                        Contact {sos.contactPhone} — the full number is revealed privately when a donor accepts the request.
                      </span>
                    </div>
                  ) : sos.status === 'Cancelled' ? (
                    <div className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                      <X className="w-4 h-4" /> Cancelled by requester
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg bg-safe-soft text-safe-ink">
                      <CheckCircle2 className="w-4 h-4" /> Fulfilled · Lives Saved
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    {sos.status === 'Pending' && (
                      <button
                        onClick={() => goToNav('register', 'donor-search')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-white transition hover:opacity-90"
                        style={{ background: 'var(--blood)' }}
                      >
                        <Heart className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                        I can help
                      </button>
                    )}
                    <SosReportButton sosId={sos.id} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {/* ROW 2 — discovery: map + directory left, donors & orgs right. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* LEFT — Map + Directory */}
          <div className="lg:col-span-8 space-y-6">
            <div id="map" className="scroll-mt-24">
              <Suspense fallback={<MapCardSkeleton />}>
                <MapComponent hospitals={hospitals} camps={camps} selectedItem={selectedItem} onSelectItem={(item) => { setSelectedItem(item); }} />
              </Suspense>
            </div>

          {/* Directory Tabs */}
          <div id="blood-banks" className="rounded-3xl border overflow-hidden scroll-mt-24" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
            {/* Tab Nav */}
            <div
              role="tablist"
              aria-label="Directory sections"
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
                  switch instant. */}
              {activeTab === 'hospitals' && (
                  <motion.div key="hospitals" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    {hospitals.some(h => h.isSample) && (
                      <div role="note" className="mb-4 p-3.5 rounded-xl flex items-start gap-2.5 bg-warn-soft border border-warn/30">
                        <Info className="w-4 h-4 shrink-0 mt-0.5 text-warn-ink" />
                        <p className="text-xs leading-relaxed text-warn-ink">
                          <span className="font-bold">Sample data — not live inventory. </span>
                          Stock levels below were compiled from public information and are not connected to hospital systems. Always call the hospital to confirm before travelling.
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {hospitals.map(h => (
                      <button key={h.id} onClick={() => setSelectedItem(h)} className={`text-left p-4 rounded-xl border transition-all ${selectedItem?.id === h.id ? 'bg-blood-soft border-blood' : 'bg-surface border-border'}`}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="font-display font-bold text-sm leading-tight" style={{ color: 'var(--ink)' }}>{h.name}</div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{h.address}</div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            {h.isSample && <Badge tone="warn" mono>Sample</Badge>}
                            <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded border border-border text-muted">{h.city.slice(0, 3).toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs mb-3" style={{ color: 'var(--muted)' }}>
                          <Phone className="w-3 h-3" /> {h.phone}
                          <span className="ml-auto font-semibold" style={{ color: 'var(--safe-ink)' }}>● {h.emergencyHours}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {Object.entries(h.bloodAvailability).slice(0, 4).map(([grp, stock]) => (
                            <div key={grp} className="rounded text-center py-1 text-xs font-mono border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                              <div className="font-bold" style={{ color: 'var(--ink)' }}>{grp}</div>
                              <div style={{ color: stock === 'In Stock' ? 'var(--safe-text)' : stock === 'Low' ? 'var(--warn-text)' : 'var(--danger-text)' }}>{stock === 'In Stock' ? '✓' : stock === 'Low' ? '!' : '✗'}</div>
                            </div>
                          ))}
                        </div>
                        {h.stockLastUpdated && (
                          <div className="mt-2 text-xs font-mono text-muted">
                            {h.isSample ? 'Sample data — call to confirm. ' : ''}Stock reviewed {formatReviewedDate(h.stockLastUpdated)}
                          </div>
                        )}
                        <div className="mt-3 flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--blood)' }}>
                          <MapPin className="w-3 h-3" /> Show on map <ChevronRight className="w-3 h-3" />
                        </div>
                      </button>
                    ))}
                    </div>
                    {hospitals.length === 0 && (
                      loadFailed ? (
                        <ListState
                          kind="error"
                          title="Couldn't load hospital listings."
                          sub="Check your connection and try again. In an emergency, call the hospital blood bank directly."
                          actionLabel="Try again"
                          onAction={loadData}
                        />
                      ) : (
                        <ListState
                          kind="empty"
                          title="No hospital listings yet."
                          sub="We're building this directory. Call PIMS or Holy Family directly if you need blood now."
                        />
                      )
                    )}
                  </motion.div>
                )}
                {activeTab === 'camps' && (
                  <motion.div key="camps" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    {camps.some(c => c.isSample) && (
                      <div role="note" className="mb-4 p-3.5 rounded-xl flex items-start gap-2.5 bg-warn-soft border border-warn/30">
                        <Info className="w-4 h-4 shrink-0 mt-0.5 text-warn-ink" />
                        <p className="text-xs leading-relaxed text-warn-ink">
                          <span className="font-bold">Sample data. </span>
                          Camp listings below are sample entries for demonstration. Check with the organizer before travelling.
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {camps.map(c => (
                      <div key={c.id} className="p-4 rounded-xl border flex flex-col" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded border bg-warn-soft border-warn/30 text-warn-ink">CAMP</span>
                          {c.isSample && <Badge tone="warn" mono>Sample</Badge>}
                          <span className="text-xs ml-auto" style={{ color: 'var(--muted)' }}>{c.city}</span>
                        </div>
                        <div className="font-display font-bold text-sm mb-1" style={{ color: 'var(--ink)' }}>{c.title}</div>
                        <div className="text-xs mb-2 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}><MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {c.location}</div>
                        <div className="text-xs leading-relaxed mb-3 flex-1" style={{ color: 'var(--muted)' }}>{c.description}</div>
                        <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                          <div className="text-xs" style={{ color: 'var(--muted)' }}>
                            <div className="font-semibold flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {c.date}</div>
                            <div className="font-mono">{c.time}</div>
                          </div>
                          <button onClick={() => handleCampRegistration(c.id)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition hover:opacity-90"
                            style={{ background: 'var(--blood)' }}>
                            Register ({c.registeredCount})
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                    {camps.length === 0 && (
                      loadFailed ? (
                        <ListState
                          kind="error"
                          title="Couldn't load camp listings."
                          sub="Check your connection and try again."
                          actionLabel="Try again"
                          onAction={loadData}
                        />
                      ) : (
                        <ListState
                          kind="empty"
                          title="No camps scheduled right now."
                          sub="Check back soon, or register as a donor to be alerted about the next drive."
                        />
                      )
                    )}
                  </motion.div>
                )}
                {activeTab === 'analytics' && <motion.div key="analytics" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Suspense fallback={<div className="p-5" role="status" aria-label="Loading analytics"><SkeletonStats /></div>}><StatsDashboard /></Suspense></motion.div>}
                {activeTab === 'ml-playground' && <motion.div key="ml" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Suspense fallback={<div className="p-5" role="status" aria-label="Loading ML lab"><SkeletonStats /></div>}><RealMLPanel /></Suspense></motion.div>}
            </div>
          </div>

          </div>

        {/* RIGHT COLUMN — donors, org portal & hotlines (inside ROW 2 grid). */}
        <div className="lg:col-span-4 space-y-6">
          {/* Donor Search */}
          <div id="donor-search" className="scroll-mt-24">
            <DonorSearch donors={donors} onReviewSubmitted={loadData} activeTab={activeDonorTab} setActiveTab={setActiveDonorTab} />
          </div>

          {/* Admin Dashboard — only rendered for the admin role so ordinary
              visitors never see (or fetch) moderation tools. */}
          {meRole === 'admin' && <AdminPanel onDataChanged={loadData} />}

          {/* Organization Portal */}
          <OrgPortal hospitals={hospitals} onDataChanged={loadData} />

          {/* Emergency Hotlines */}
          <div id="help" className="rounded-3xl border p-5 scroll-mt-24" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
            <h2 className="font-display font-bold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
              <Phone className="w-4 h-4" style={{ color: 'var(--blood)' }} />
              24/7 Emergency Hotlines
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
        </div>
          </div>

          {/* How it works — three illustrated steps. */}
          <HowItWorks />

          {/* Become a donor band (blood-tint) + trust band (wine). */}
          <BecomeDonorBand onBecomeDonor={() => { setActiveDonorTab('register'); scrollToId('donor-search'); }} />
          <TrustBand />
        </main>
      )}

      {/* MOBILE STICKY BOTTOM BAR — 64px + safe area, slides up once the hero
          scrolls away. Hidden on md+ where the header CTA is always visible. */}
      <div
        className={`md:hidden fixed bottom-0 inset-x-0 z-40 transition-transform duration-200 ${bottomBarVisible ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ background: 'var(--card)', borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-2 gap-2 p-2">
          <a href="#sos-form" className="inline-flex items-center justify-center gap-2 h-12 rounded-xl font-display font-bold text-sm text-white transition hover:opacity-90" style={{ background: 'var(--blood)' }}>
            <Heart className="w-4 h-4 fill-current" aria-hidden="true" />
            Request blood
          </a>
          <a href="#donor-search" onClick={() => setActiveDonorTab('search')} className="inline-flex items-center justify-center gap-2 h-12 rounded-xl font-display font-bold text-sm border transition" style={{ background: 'var(--card)', borderColor: 'var(--border-strong)', color: 'var(--ink)' }}>
            <Users className="w-4 h-4" style={{ color: 'var(--blood)' }} aria-hidden="true" />
            Find donors
          </a>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="border-t py-8 text-center" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
        <div className="flex items-center justify-center gap-2 mb-4">
          <Droplets className="w-4 h-4 fill-current" style={{ color: 'var(--blood)' }} />
          <span className="font-display font-bold text-sm" style={{ color: 'var(--ink)' }}>BloodRadar</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-4 px-4">
          {[
            { label: 'Request blood', href: '#sos-form' },
            { label: 'Find donors', href: '#donor-search' },
            { label: 'Live map', href: '#map' },
            { label: 'Become a donor', href: '#become-a-donor' },
            { label: 'Analytics & ML lab', href: '#insights' },
          ].map(({ label, href }) => (
            <a key={label} href={href} className="text-sm font-semibold transition-colors duration-150" style={{ color: 'var(--muted)' }}>
              {label}
            </a>
          ))}
        </nav>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>© 2026 BloodRadar · Islamabad &amp; Rawalpindi, Pakistan — an early-stage community project</p>
        <p className="text-xs mt-1 italic" style={{ color: 'var(--muted)', opacity: 0.7 }}>"A drop given in time is a lifetime returned."</p>
        <p className="text-xs mt-2 max-w-md mx-auto" style={{ color: 'var(--muted)' }}>
          This is not a medical service. In a life-threatening emergency, call Rescue 1122 or your hospital directly.
        </p>
      </footer>

      {/* AI Chatbot */}
      <Suspense fallback={null}>
        <AIChatbot onEmergencyTriggered={handleAIEmergencyTrigger} />
      </Suspense>
    </div>
  );
}
