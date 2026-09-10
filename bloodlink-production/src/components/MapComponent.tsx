import { useEffect, useRef, useState } from "react";
import { Hospital, BloodCamp } from "../types";
import { MapPin, Building, Calendar, Phone } from "lucide-react";
import { SUPPORTED_CITIES, CITY_CENTER_COORDINATES, DEFAULT_CITY } from "../lib/regions";

interface MapComponentProps {
  hospitals: Hospital[];
  camps: BloodCamp[];
  selectedItem: Hospital | BloodCamp | null;
  onSelectItem: (item: any) => void;
  lang: 'en' | 'ur';
}

export default function MapComponent({ hospitals, camps, selectedItem, onSelectItem, lang }: MapComponentProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);

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

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      mapInstanceRef.current = map;
      setMapLoaded(true);

      // Force layout re-calculate
      setTimeout(() => {
        map.invalidateSize();
      }, 500);

    } catch (e) {
      console.error("Leaflet initialization failed: ", e);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Markers when hospitals, camps or selection changes
  useEffect(() => {
    const L = (window as any).L;
    const map = mapInstanceRef.current;
    if (!L || !map || !mapLoaded) return;

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Custom Icons using Leaflet divIcon with beautiful Tailwind styles for Red Hospital & Amber Camps
    const createHospitalIcon = (isHighlighted: boolean) => L.divIcon({
      html: `
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 ${isHighlighted ? 'bg-rose-500 border-white scale-125 shadow-lg shadow-rose-500/50' : 'bg-red-600 border-[var(--blood)]/20'} text-white transition-all duration-300">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
        </div>
      `,
      className: "custom-map-marker-hospital",
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const createCampIcon = (isHighlighted: boolean) => L.divIcon({
      html: `
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 ${isHighlighted ? 'bg-amber-500 border-white scale-125 shadow-lg shadow-amber-500/50' : 'bg-amber-600 border-amber-200'} text-black transition-all duration-300">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
      `,
      className: "custom-map-marker-camp",
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    // Add hospitals
    hospitals.forEach(h => {
      const isSelected = selectedItem && selectedItem.id === h.id;
      const marker = L.marker([h.latitude, h.longitude], {
        icon: createHospitalIcon(!!isSelected)
      })
      .addTo(map)
      .bindPopup(`
        <div className="p-1 font-sans text-slate-800">
          <h4 className="font-bold text-sm text-red-700 m-0">${h.name}</h4>
          <p className="text-xs text-[var(--muted)] my-1">${h.address}</p>
          <p className="text-xs font-semibold m-0 flex items-center gap-1 text-[var(--safe)]">
            🟢 ${h.emergencyHours}
          </p>
        </div>
      `);

      marker.on('click', () => {
        onSelectItem(h);
      });

      markersRef.current.push(marker);

      if (isSelected) {
        map.setView([h.latitude, h.longitude], 14, { animate: true });
        marker.openPopup();
      }
    });

    // Add camps
    camps.forEach(c => {
      const isSelected = selectedItem && selectedItem.id === c.id;
      const marker = L.marker([c.latitude, c.longitude], {
        icon: createCampIcon(!!isSelected)
      })
      .addTo(map)
      .bindPopup(`
        <div className="p-1 font-sans text-slate-800">
          <h4 className="font-bold text-sm text-[var(--warn)] m-0">${c.title}</h4>
          <p className="text-xs text-[var(--muted)] my-1">📍 ${c.location}</p>
          <p className="text-xs font-semibold m-0 text-[var(--muted)]">
            📅 ${c.date} (${c.time})
          </p>
        </div>
      `);

      marker.on('click', () => {
        onSelectItem(c);
      });

      markersRef.current.push(marker);

      if (isSelected) {
        map.setView([c.latitude, c.longitude], 14, { animate: true });
        marker.openPopup();
      }
    });

  }, [hospitals, camps, selectedItem, mapLoaded]);

  // Jump to any configured city's center — works for however many cities
  // are in SUPPORTED_CITIES, not hardcoded to exactly two.
  const jumpToCity = (cityName: string) => {
    const map = mapInstanceRef.current;
    const coords = CITY_CENTER_COORDINATES[cityName];
    if (!map || !coords) return;
    map.setView([coords.latitude, coords.longitude], 12, { animate: true });
  };

  return (
    <div id="leaflet-map-root-card" className="bg-[var(--card)] rounded-2xl border border-[var(--border)] overflow-hidden relative shadow-sm">
      <div className="p-4 bg-[var(--surface)] border-b border-slate-150 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-[var(--blood)] rounded-full animate-ping"></div>
          <h3 className="font-sans font-bold text-[var(--ink)] flex items-center gap-1.5 text-sm md:text-base">
            <Building className="w-4 h-4 text-[var(--blood)]" />
            {lang === 'en' ? 'Live Blood Map' : 'لائیو بلڈ میپ'}
          </h3>
        </div>
        <div className="flex gap-1.5">
          {SUPPORTED_CITIES.map(cityName => (
            <button
              key={cityName}
              id={`btn-zoom-${cityName.toLowerCase()}`}
              onClick={() => jumpToCity(cityName)}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[var(--card)] border border-[var(--border)] text-slate-650 hover:bg-[var(--surface)] hover:text-[var(--ink)] transition"
            >
              {cityName}
            </button>
          ))}
        </div>
      </div>

      {/* Map Division */}
      <div 
        ref={mapContainerRef} 
        style={{ height: "420px" }} 
        className="w-full bg-[var(--surface)] relative z-10"
        id="leaflet-live-map-container"
      >
        {!mapLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/90 z-20">
            <div className="w-10 h-10 border-4 border-rose-605 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-rose-650 mt-3 font-mono">Initializing GPS Geolocation & OSM Maps...</p>
          </div>
        )}
      </div>

      <div className="p-3 bg-[var(--surface)] flex items-center justify-around text-xs border-t border-slate-150 text-[var(--muted)] font-mono">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-600 border border-white shadow-sm"></div>
          <span className="font-sans font-medium">{lang === 'en' ? 'Hospitals / Blood Banks' : 'ہسپتال / بلڈ بینک'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-amber-500 border border-white shadow-sm"></div>
          <span className="font-sans font-medium">{lang === 'en' ? 'Donation Camps' : 'کیمپ مقامات'}</span>
        </div>
      </div>
    </div>
  );
}
