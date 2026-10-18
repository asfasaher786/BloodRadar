import { useEffect, useRef, useState } from "react";
import { Hospital, BloodCamp } from "../types";
import { Building, Crosshair, MapPin, Phone, Calendar, X } from "lucide-react";
import { SUPPORTED_CITIES, CITY_CENTER_COORDINATES, DEFAULT_CITY } from "../lib/regions";

interface MapComponentProps {
  hospitals: Hospital[];
  camps: BloodCamp[];
  selectedItem: Hospital | BloodCamp | null;
  onSelectItem: (item: any) => void;
  lang: 'en' | 'ur';
}

type LocateStatus = 'idle' | 'locating' | 'success' | 'denied' | 'error';

// Brand-token marker HTML (inline styles use CSS vars so markers follow the
// design system; Tailwind classes inside Leaflet's injected HTML are fragile).
function hospitalIconHtml(isSelected: boolean): string {
  return `
    <div class="bloodradar-marker ${isSelected ? 'bloodradar-marker-selected' : ''}" style="width:32px;height:32px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:var(--color-blood, #C41230);border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.25);">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
    </div>
  `;
}

function campIconHtml(isSelected: boolean): string {
  return `
    <div class="bloodradar-marker ${isSelected ? 'bloodradar-marker-selected' : ''}" style="width:32px;height:32px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:var(--color-warn, #FFB300);border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.25);">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3d2e00" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    </div>
  `;
}

export default function MapComponent({ hospitals, camps, selectedItem, onSelectItem, lang }: MapComponentProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const clusterRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [locateStatus, setLocateStatus] = useState<LocateStatus>('idle');
  const locateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize Map — centers on wherever the real data actually is, not a
  // hardcoded location, so this works for any city/country this platform
  // is deployed to serve.
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapContainerRef.current || mapInstanceRef.current) return;

    try {
      const allPoints = [...hospitals, ...camps].filter(p => p.latitude && p.longitude);
      let defaultCenter: [number, number];
      let zoom = 12;

      if (allPoints.length > 0) {
        // Real, data-driven center: the average of all actual points we have.
        const avgLat = allPoints.reduce((sum, p) => sum + p.latitude, 0) / allPoints.length;
        const avgLng = allPoints.reduce((sum, p) => sum + p.longitude, 0) / allPoints.length;
        defaultCenter = [avgLat, avgLng];
      } else {
        // No real data yet at all — fall back to the configured default
        // city center, which is a config setting, not a hardcoded value.
        const fallback = CITY_CENTER_COORDINATES[DEFAULT_CITY];
        defaultCenter = [fallback.latitude, fallback.longitude];
        zoom = 11;
      }

      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView(defaultCenter, zoom);

      // Esri World Street Map (free for public web apps with attribution,
      // no API key). OSM's own tile server blocks live apps by policy, and
      // CARTO basemaps now require an API key, so neither works keyless.
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ',
        maxZoom: 19
      }).addTo(map);

      // Marker clustering when the plugin is available; plain layer group
      // as a graceful fallback if the CDN script is ever blocked.
      const cluster = typeof L.markerClusterGroup === "function"
        ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 })
        : L.layerGroup();
      cluster.addTo(map);
      clusterRef.current = cluster;

      mapInstanceRef.current = map;
      setMapLoaded(true);

      // Force layout re-calculate once the map is ready. The callback must
      // be cancelable: React StrictMode (dev) unmounts right after mount, and
      // invalidateSize on a removed map crashes Leaflet's _getMapPanePos
      // (removal deletes the panes but leaves `_loaded` true).
      map.whenReady(() => {
        sizeTimerRef.current = setTimeout(() => {
          if (mapInstanceRef.current === map) {
            map.invalidateSize();
          }
        }, 300);
      });

    } catch (e) {
      console.error("Leaflet initialization failed: ", e);
    }

    return () => {
      if (sizeTimerRef.current) {
        clearTimeout(sizeTimerRef.current);
        sizeTimerRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        clusterRef.current = null;
        userMarkerRef.current = null;
      }
    };
  }, []);

  // Update Markers when hospitals, camps or selection changes
  useEffect(() => {
    const L = (window as any).L;
    const map = mapInstanceRef.current;
    const cluster = clusterRef.current;
    if (!L || !map || !cluster || !mapLoaded) return;

    cluster.clearLayers();

    const createHospitalIcon = (isHighlighted: boolean) => L.divIcon({
      html: hospitalIconHtml(!!isHighlighted),
      className: "bloodradar-div-icon",
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const createCampIcon = (isHighlighted: boolean) => L.divIcon({
      html: campIconHtml(!!isHighlighted),
      className: "bloodradar-div-icon",
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    // On mobile the details bottom sheet handles selection; popups are a
    // desktop pattern, so we only open them on wider screens.
    const isDesktop = window.innerWidth >= 768;

    // Add hospitals
    hospitals.forEach(h => {
      const isSelected = selectedItem && selectedItem.id === h.id;
      const marker = L.marker([h.latitude, h.longitude], {
        icon: createHospitalIcon(isSelected)
      })
      .bindPopup(`        <div style="padding:2px;font-family:var(--font-sans);color:var(--color-ink, #1a1421);">
          <h3 style="font-weight:700;font-size:14px;color:var(--color-blood, #C41230);margin:0 0 4px;">${h.name}</h3>
          <p style="font-size:12px;color:var(--color-muted, #6B6578);margin:0 0 4px;">${h.address}</p>
          <p style="font-size:12px;font-weight:600;margin:0;color:var(--color-safe-ink, #007A57);">${h.emergencyHours}</p>
          ${h.isSample ? '<p style="font-size:11px;margin:4px 0 0;color:var(--color-warn-ink, #8A5A00);font-weight:600;">Sample data — not live inventory</p>' : ''}
        </div>
      `);

      marker.on('click', () => {
        onSelectItem(h);
        if (isDesktop) marker.openPopup();
      });

      // Leaflet marks interactive divIcons as role="button"; give each one
      // an accessible name (axe rule: aria-command-name). The icon element
      // only exists once the marker is added to the map, so label it then.
      marker.on('add', () => {
        const markerEl = marker.getElement();
        if (markerEl) markerEl.setAttribute("aria-label", `Hospital marker: ${h.name}`);
      });

      cluster.addLayer(marker);

      if (isSelected) {
        map.setView([h.latitude, h.longitude], 14, { animate: true });
        if (isDesktop) marker.openPopup();
      }
    });

    // Add camps
    camps.forEach(c => {
      const isSelected = selectedItem && selectedItem.id === c.id;
      const marker = L.marker([c.latitude, c.longitude], {
        icon: createCampIcon(isSelected)
      })
      .bindPopup(`
        <div style="padding:2px;font-family:var(--font-sans);color:var(--color-ink, #1a1421);">
          <h3 style="font-weight:700;font-size:14px;color:var(--color-warn-ink, #8A5A00);margin:0 0 4px;">${c.title}</h3>
          <p style="font-size:12px;color:var(--color-muted, #6B6578);margin:0 0 4px;">${c.location}</p>
          <p style="font-size:12px;font-weight:600;margin:0;color:var(--color-ink, #1a1421);">${c.date} (${c.time})</p>
          ${c.isSample ? '<p style="font-size:11px;margin:4px 0 0;color:var(--color-warn-ink, #8A5A00);font-weight:600;">Sample listing — confirm with the organizer</p>' : ''}
        </div>
      `);

      marker.on('click', () => {
        onSelectItem(c);
        if (isDesktop) marker.openPopup();
      });

      marker.on('add', () => {
        const markerEl = marker.getElement();
        if (markerEl) markerEl.setAttribute("aria-label", `Donation camp marker: ${c.title}`);
      });

      cluster.addLayer(marker);

      if (isSelected) {
        map.setView([c.latitude, c.longitude], 14, { animate: true });
        if (isDesktop) marker.openPopup();
      }
    });

  }, [hospitals, camps, selectedItem, mapLoaded]);

  // Jump to any configured city's center — works for however many cities
  // are in SUPPORTED_CITIES, not hardcoded to exactly two.
  const jumpToCity = (cityName: string) => {
    const map = mapInstanceRef.current;
    const coords = CITY_CENTER_COORDINATES[cityName];
    if (!map || !coords) return;
    // Instant jump (no Leaflet animation): works in throttled/hidden tabs
    // and respects reduced-motion users.
    map.setView([coords.latitude, coords.longitude], 12);
  };

  // "Locate me" — geolocation with graceful denial. If the user declines or
  // the browser blocks it, we say so honestly and keep the city view.
  const handleLocateMe = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!("geolocation" in navigator)) {
      setLocateStatus('error');
      scheduleLocateReset();
      return;
    }
    setLocateStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        map.setView([latitude, longitude], 14);
        // Pulsing "you are here" dot — removed automatically next locate.
        const L = (window as any).L;
        if (L && mapInstanceRef.current) {
          if (userMarkerRef.current) userMarkerRef.current.remove();
          const icon = L.divIcon({
            html: '<div style="width:14px;height:14px;border-radius:9999px;background:var(--color-pulse, #FF4560);border:3px solid #ffffff;box-shadow:0 0 0 4px rgba(255,69,96,0.35);animation:blood-pulse 2s ease-in-out infinite;"></div>',
            className: "bloodradar-div-icon",
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });
          userMarkerRef.current = L.marker([latitude, longitude], { icon }).addTo(map);
        }
        setLocateStatus('success');
        scheduleLocateReset();
      },
      (err) => {
        setLocateStatus(err && err.code === 1 ? 'denied' : 'error');
        scheduleLocateReset();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  };

  const scheduleLocateReset = () => {
    if (locateTimerRef.current) clearTimeout(locateTimerRef.current);
    locateTimerRef.current = setTimeout(() => setLocateStatus('idle'), 6000);
  };

  // Mobile bottom sheet for the selected item (desktop keeps Leaflet popups).
  const sheetItem = selectedItem;
  const isHospitalSheet = sheetItem && 'emergencyHours' in sheetItem;

  return (
    <div id="leaflet-map-root-card" className="bg-[var(--card)] rounded-2xl border border-[var(--border)] overflow-hidden relative shadow-sm">
      <div className="p-4 bg-[var(--surface)] border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-[var(--blood)] rounded-full animate-ping"></div>
          <h2 className="font-sans font-bold text-[var(--ink)] flex items-center gap-1.5 text-sm md:text-base">
            <Building className="w-4 h-4 text-[var(--blood)]" />
            {lang === 'en' ? 'Live Blood Map' : 'لائیو بلڈ میپ'}
          </h2>
        </div>
        <div className="flex gap-1.5 items-center">
          {SUPPORTED_CITIES.map(cityName => (
            <button
              key={cityName}
              id={`btn-zoom-${cityName.toLowerCase()}`}
              onClick={() => jumpToCity(cityName)}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)] transition"
            >
              {cityName}
            </button>
          ))}
          <button
            id="btn-locate-me"
            onClick={handleLocateMe}
            aria-label={lang === 'en' ? 'Locate me on the map' : 'میرا مقام دکھائیں'}
            title={lang === 'en' ? 'Locate me' : 'میرا مقام'}
            disabled={locateStatus === 'locating'}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)] transition disabled:opacity-50 flex items-center gap-1"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{lang === 'en' ? 'Locate me' : 'میرا مقام'}</span>
          </button>
        </div>
      </div>

      {locateStatus !== 'idle' && (
        <div
          role="status"
          aria-live="polite"
          className="px-4 py-2 text-xs font-semibold border-b"
          style={{
            background: locateStatus === 'success' ? 'var(--safe-soft)' : 'var(--warn-soft)',
            borderColor: locateStatus === 'success' ? 'var(--safe)' : 'var(--warn)',
            color: locateStatus === 'success' ? 'var(--safe-ink)' : 'var(--warn-ink)',
          }}
        >
          {locateStatus === 'locating' && (lang === 'en' ? 'Finding your location…' : 'آپ کا مقام تلاش کیا جا رہا ہے…')}
          {locateStatus === 'success' && (lang === 'en' ? 'Here you are — the map is centered on your location.' : 'نقشہ آپ کے مقام پر مرکوز ہے۔')}
          {locateStatus === 'denied' && (lang === 'en' ? 'Location access denied — showing the city map instead.' : 'مقام کی اجازت نہیں دی گئی — شہر کا نقشہ دکھایا جا رہا ہے۔')}
          {locateStatus === 'error' && (lang === 'en' ? 'Couldn\'t get your location right now — showing the city map instead.' : 'ابھی آپ کا مقام حاصل نہیں ہو سکا۔')}
        </div>
      )}

      {/* Map Division */}
      <div 
        ref={mapContainerRef} 
        style={{ height: "420px" }} 
        className="w-full bg-[var(--surface)] relative z-10"
        id="leaflet-live-map-container"
      >
        {!mapLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--surface-2)]/90 z-20">
            <div className="w-10 h-10 border-4 border-[var(--blood)] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-[var(--muted)] mt-3 font-mono">{lang === 'en' ? 'Loading map…' : 'نقشہ لوڈ ہو رہا ہے…'}</p>
          </div>
        )}

        {/* Mobile bottom sheet — selected item details */}
        {sheetItem && (
          <div
            id="map-mobile-sheet"
            className="absolute bottom-3 left-3 right-3 z-30 md:hidden rounded-xl border shadow-2xl p-4"
            style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-display font-bold text-sm leading-tight" style={{ color: 'var(--ink)' }}>
                  {'name' in sheetItem ? sheetItem.name : sheetItem.title}
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
                  <MapPin className="w-3 h-3 inline mr-1" />
                  {'address' in sheetItem ? sheetItem.address : sheetItem.location}, {sheetItem.city}
                </p>
              </div>
              <button
                id="btn-map-sheet-close"
                onClick={() => onSelectItem(null)}
                aria-label={lang === 'en' ? 'Close details' : 'بند کریں'}
                className="shrink-0 p-1.5 rounded-lg transition"
                style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-2.5 flex items-center gap-2 text-xs font-semibold">
              {isHospitalSheet && 'phone' in sheetItem && (
                <a
                  href={`tel:${sheetItem.phone}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white transition"
                  style={{ background: 'var(--safe-ink)' }}
                >
                  <Phone className="w-3.5 h-3.5" />
                  {lang === 'en' ? 'Call hospital' : 'ہسپتال کو کال کریں'}
                </a>
              )}
              {!isHospitalSheet && 'date' in sheetItem && (
                <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                  <Calendar className="w-3.5 h-3.5" />
                  {sheetItem.date} ({sheetItem.time})
                </span>
              )}
            </div>

            {'isSample' in sheetItem && sheetItem.isSample && (
              <p className="mt-2 text-[10px] font-semibold" style={{ color: 'var(--warn-ink)' }}>
                {isHospitalSheet
                  ? (lang === 'en' ? 'Sample data — not live inventory. Call to confirm stock.' : 'نمونے کا ڈیٹا — اسٹاک کی تصدیق کے لیے کال کریں۔')
                  : (lang === 'en' ? 'Sample listing — confirm with the organizer.' : 'نمونے کا اندراج — منتظم سے تصدیق کریں۔')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="p-3 bg-[var(--surface)] flex items-center justify-around text-xs border-t border-[var(--border)] text-[var(--muted)] font-mono">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ background: 'var(--blood)', border: '2px solid #ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}></div>
          <span className="font-sans font-medium">{lang === 'en' ? 'Hospitals / Blood Banks' : 'ہسپتال / بلڈ بینک'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ background: 'var(--warn)', border: '2px solid #ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}></div>
          <span className="font-sans font-medium">{lang === 'en' ? 'Donation Camps' : 'کیمپ مقامات'}</span>
        </div>
      </div>
    </div>
  );
}
