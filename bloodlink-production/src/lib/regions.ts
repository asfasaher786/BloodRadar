// Frontend mirror of backend/config/regions.ts — kept in sync manually since
// frontend and backend build separately. Single place to edit when this
// deployment expands to a new city.
export const SUPPORTED_CITIES: string[] = ["Islamabad", "Rawalpindi"];
export const DEFAULT_CITY: string = "Islamabad";

export const CITY_CENTER_COORDINATES: { [city: string]: { latitude: number; longitude: number } } = {
  "Islamabad": { latitude: 33.6844, longitude: 73.0479 },
  "Rawalpindi": { latitude: 33.5651, longitude: 73.0169 }
};
