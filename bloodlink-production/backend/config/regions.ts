// Single source of truth for which cities/regions this deployment currently
// serves. BloodRadar is intentionally focused on one metro area right now —
// see README for why — but this file is the ONE place to touch when that
// changes, instead of hunting down hardcoded city names across the codebase.
//
// To add a new city or region: add it to SUPPORTED_CITIES below. Nothing
// else in the code needs to change — donor registration, SOS requests, and
// SMS parsing all read from this list.

export const SUPPORTED_CITIES: string[] = ["Islamabad", "Rawalpindi"];
export const DEFAULT_CITY: string = "Islamabad";

// Approximate city-center coordinates, used to place a donor on the map
// when we don't have their exact address. Add an entry here for any new
// city added to SUPPORTED_CITIES above.
export const CITY_CENTER_COORDINATES: { [city: string]: { latitude: number; longitude: number } } = {
  "Islamabad": { latitude: 33.6844, longitude: 73.0479 },
  "Rawalpindi": { latitude: 33.5651, longitude: 73.0169 }
};

// Used by phoneUtils.ts as a fallback when a phone number doesn't include a
// country code (e.g. a local "0300..." number). Real international numbers
// (anything starting with "+") are respected as-is and never forced into
// this default — see phoneUtils.ts.
export const DEFAULT_COUNTRY_CODE: string = "92"; // Pakistan

export function resolveCity(input?: string | null): string {
  if (!input) return DEFAULT_CITY;
  const match = SUPPORTED_CITIES.find(c => c.toLowerCase() === input.toLowerCase());
  return match || DEFAULT_CITY;
}

export function getCityCenter(city: string): { latitude: number; longitude: number } {
  return CITY_CENTER_COORDINATES[city] || CITY_CENTER_COORDINATES[DEFAULT_CITY];
}
