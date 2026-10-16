import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import { Bell, BellOff, Loader2, Moon, Smartphone, AppWindow, Save } from "lucide-react";

// Donor alert settings (Phase 3.5). The logged-in donor controls which
// channels reach them (in-app, SMS, web push) and their quiet hours —
// except Immediate (SOS) requests, which can be allowed through during
// quiet hours if the donor opts in. Web push is only offered when the
// deployment has VAPID keys configured; otherwise it shows an honest
// "not configured" note instead of a button that can never work.

interface NotifyPrefs {
  appAlerts: boolean;
  smsAlerts: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  allowImmediateDuringQuiet: boolean;
}

interface PushStatus {
  enabled: boolean;
  publicKey: string | null;
}

interface MyAlert {
  id: string;
  title: string;
  message: string;
  type: string;
  sosId?: string;
  read: boolean;
  timestamp: string;
}

// Standard URL-safe base64 → Uint8Array for pushManager.subscribe.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const outputArray = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) outputArray[i] = raw.charCodeAt(i);
  return outputArray;
}

export default function DonorAlerts({ onChanged }: { onChanged: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [timezone, setTimezone] = useState("");
  const [smsProvider, setSmsProvider] = useState("");
  const [push, setPush] = useState<PushStatus | null>(null);
  const [pushState, setPushState] = useState<"unknown" | "subscribed" | "denied" | "unsupported">("unknown");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [alerts, setAlerts] = useState<MyAlert[]>([]);

  const load = async () => {
    try {
      const [prefsRes, pushRes, mineRes] = await Promise.all([
        fetch(`${API_BASE}/api/notifications/preferences`, { credentials: "include" }),
        fetch(`${API_BASE}/api/notifications/push/status`),
        fetch(`${API_BASE}/api/notifications/mine`, { credentials: "include" }),
      ]);
      if (prefsRes.ok) {
        const data = await prefsRes.json();
        setPrefs(data.prefs);
        setTimezone(data.timezone || "");
        setSmsProvider(data.smsProvider || "");
      }
      if (pushRes.ok) {
        const data = await pushRes.json();
        setPush(data);
        if (data.enabled) {
          const reg = await navigator.serviceWorker?.getRegistration?.();
          if (reg) {
            const sub = await reg.pushManager.getSubscription();
            setPushState(sub ? "subscribed" : "unknown");
          }
        }
      }
      if (mineRes.ok) {
        setAlerts((await mineRes.json()) as MyAlert[]);
      }
    } catch {
      /* keep defaults; the panel stays usable */
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { load(); }, []);

  // New matched-request alerts arrive the moment an SOS is created — keep
  // this donor's feed live without a page reload.
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events`);
    const refresh = async () => {
      const res = await fetch(`${API_BASE}/api/notifications/mine`, { credentials: "include" });
      if (res.ok) setAlerts((await res.json()) as MyAlert[]);
    };
    es.addEventListener("emergency-created", refresh);
    return () => es.close();
  }, []);

  const save = async () => {
    if (!prefs) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/notifications/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(prefs),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ ok: true, text: "Alert settings saved." });
        onChanged();
      } else {
        setMsg({ ok: false, text: data.error || "Couldn't save the settings." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const subscribePush = async () => {
    if (!push?.enabled || !push.publicKey) return;
    setBusy(true);
    setMsg(null);
    try {
      if (!("Notification" in window)) { setPushState("unsupported"); setBusy(false); return; }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState("denied");
        setMsg({ ok: false, text: "Browser notifications are blocked. Allow them in the browser settings, then try again." });
        setBusy(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(push.publicKey),
      });
      const res = await fetch(`${API_BASE}/api/notifications/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(sub.toJSON()),
      });
      if (res.ok) {
        setPushState("subscribed");
        setMsg({ ok: true, text: "Push alerts are on — you'll get a notification when a matching request is raised." });
      } else {
        const data = await res.json().catch(() => ({}));
        setMsg({ ok: false, text: data.error || "Couldn't save the subscription." });
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err?.name === "NotAllowedError" ? "Notifications were blocked." : "Push isn't available in this browser." });
    } finally {
      setBusy(false);
    }
  };

  const unsubscribePush = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) await sub.unsubscribe();
      await fetch(`${API_BASE}/api/notifications/push/unsubscribe`, { method: "POST", credentials: "include" });
      setPushState("unknown");
      setMsg({ ok: true, text: "Push alerts turned off." });
    } catch {
      setMsg({ ok: false, text: "Couldn't turn push off. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const markAlertsRead = async () => {
    await fetch(`${API_BASE}/api/notifications/mine/read-all`, { method: "POST", credentials: "include" }).catch(() => {});
    setAlerts(prev => prev.map(a => ({ ...a, read: true })));
  };

  if (!loaded || !prefs) return null;

  const toggle = (key: keyof NotifyPrefs) => setPrefs({ ...prefs, [key]: !prefs[key] });

  return (
    <div id="donor-alerts-card" className="rounded-2xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(196,18,48,0.08)', border: '1px solid rgba(196,18,48,0.2)' }}>
          <Bell className="w-4 h-4" style={{ color: 'var(--blood)' }} />
        </div>
        <div>
          <h2 className="text-sm font-display font-bold" style={{ color: 'var(--ink)' }}>Donor Alerts</h2>
          <p className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
            When a new request matches your blood group and city, we alert you here.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {/* Channel toggles */}
        <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl border cursor-pointer" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            <AppWindow className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
            In-app alerts
          </span>
          <input type="checkbox" className="w-4 h-4 accent-[#C41230]" checked={prefs.appAlerts} onChange={() => toggle("appAlerts")} />
        </label>

        <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl border cursor-pointer" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            <Smartphone className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
            SMS alerts
          </span>
          <input type="checkbox" className="w-4 h-4 accent-[#C41230]" checked={prefs.smsAlerts} onChange={() => toggle("smsAlerts")} />
        </label>
        {smsProvider === "console" && (
          <p className="text-[10px] font-mono" style={{ color: 'var(--warn-ink)' }}>
            Test mode: SMS messages are printed to the server log, not actually sent. A live SMS provider is configured at deployment.
          </p>
        )}

        {/* Quiet hours */}
        <div className="p-2.5 rounded-xl border space-y-2" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--ink)' }}>
              <Moon className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
              Quiet hours {timezone ? `(${timezone})` : ""}
            </span>
            <input type="checkbox" className="w-4 h-4 accent-[#C41230]" checked={prefs.quietHoursEnabled} onChange={() => toggle("quietHoursEnabled")} />
          </label>
          {prefs.quietHoursEnabled && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  aria-label="Quiet hours start"
                  className="px-2 py-1 rounded-lg border text-xs font-mono"
                  style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  value={prefs.quietStart}
                  onChange={(e) => setPrefs({ ...prefs, quietStart: e.target.value })}
                />
                <span className="text-[10px]" style={{ color: 'var(--muted)' }}>to</span>
                <input
                  type="time"
                  aria-label="Quiet hours end"
                  className="px-2 py-1 rounded-lg border text-xs font-mono"
                  style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                  value={prefs.quietEnd}
                  onChange={(e) => setPrefs({ ...prefs, quietEnd: e.target.value })}
                />
              </div>
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  Let Immediate (SOS) requests through during quiet hours
                </span>
                <input type="checkbox" className="w-4 h-4 accent-[#C41230]" checked={prefs.allowImmediateDuringQuiet} onChange={() => toggle("allowImmediateDuringQuiet")} />
              </label>
            </>
          )}
        </div>

        {/* Web push */}
        <div className="p-2.5 rounded-xl border space-y-2" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          {push?.enabled ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                  <Bell className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
                  Web push notifications
                </span>
                {pushState === "subscribed" ? (
                  <button
                    onClick={unsubscribePush}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition disabled:opacity-50"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    <BellOff className="w-3 h-3" /> Turn off
                  </button>
                ) : (
                  <button
                    onClick={subscribePush}
                    disabled={busy || pushState === "denied" || pushState === "unsupported"}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold text-white transition disabled:opacity-50"
                    style={{ background: 'var(--blood)' }}
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />} Turn on
                  </button>
                )}
              </div>
              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
                {pushState === "subscribed" && "On — this browser will notify you about matching requests even when the tab is closed."}
                {pushState === "denied" && "Notifications are blocked in this browser. Allow them in the browser settings to enable this."}
                {pushState === "unsupported" && "This browser doesn't support web push."}
                {pushState === "unknown" && "Off — turn on to get notified even when this tab is closed."}
              </p>
            </>
          ) : (
            <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
              <Bell className="w-3 h-3 inline mr-1" />
              Web push isn't configured on this deployment yet, so browser notifications are unavailable. In-app and SMS alerts still work.
            </p>
          )}
        </div>

        <button
          onClick={save}
          disabled={busy || prefs.quietStart === prefs.quietEnd}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white transition disabled:opacity-50"
          style={{ background: 'var(--blood)' }}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save alert settings
        </button>
        {prefs.quietStart === prefs.quietEnd && (
          <p className="text-[10px]" style={{ color: 'var(--blood)' }}>Quiet hours start and end can't be the same time.</p>
        )}

        {msg && (
          <p className="text-[10px] font-semibold" role="status" style={{ color: msg.ok ? 'var(--safe-ink)' : 'var(--blood)' }}>
            {msg.text}
          </p>
        )}

        {/* Recent matched-request alerts (this donor only) */}
        {alerts.length > 0 && (
          <div className="mt-1 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[10px] font-mono font-bold tracking-wider uppercase" style={{ color: 'var(--muted)' }}>
                Recent alerts
              </span>
              {alerts.some(a => !a.read) && (
                <button onClick={markAlertsRead} className="text-[10px] font-semibold underline transition" style={{ color: 'var(--muted)' }}>
                  Mark all read
                </button>
              )}
            </div>
            <ul className="space-y-1.5">
              {alerts.slice(0, 5).map(a => (
                <li key={a.id} className={`p-2 rounded-lg border-l-2 text-[10px] leading-relaxed ${a.read ? "opacity-60" : ""}`} style={{ background: 'var(--surface)', borderLeftColor: a.read ? 'var(--border)' : 'var(--blood)' }}>
                  <span className="font-bold" style={{ color: 'var(--ink)' }}>{a.title}</span>
                  <br />
                  <span style={{ color: 'var(--muted)' }}>{a.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
