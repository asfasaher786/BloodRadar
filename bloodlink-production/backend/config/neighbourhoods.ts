// P2-4: consented coarse locations. Donors pick a neighbourhood at signup
// and requesters can pick the SOS's neighbourhood; matching ranks by real
// haversine distance between those centroids instead of "same city name".
// Coordinates are approximate area centroids on purpose — a neighbourhood,
// never a street address, so privacy is preserved by design.

export interface Neighbourhood {
  name: string;
  latitude: number;
  longitude: number;
}

export const NEIGHBOURHOODS: { [city: string]: Neighbourhood[] } = {
  Islamabad: [
    { name: "F-6", latitude: 33.7275, longitude: 73.0686 },
    { name: "F-7", latitude: 33.7186, longitude: 73.0606 },
    { name: "F-8", latitude: 33.7093, longitude: 73.055 },
    { name: "F-10", latitude: 33.7079, longitude: 73.0465 },
    { name: "F-11", latitude: 33.7132, longitude: 73.0288 },
    { name: "G-6", latitude: 33.7105, longitude: 73.0779 },
    { name: "G-7", latitude: 33.7043, longitude: 73.0694 },
    { name: "G-8", latitude: 33.6965, longitude: 73.0608 },
    { name: "G-9", latitude: 33.6881, longitude: 73.0533 },
    { name: "G-10", latitude: 33.6805, longitude: 73.04 },
    { name: "G-11", latitude: 33.6727, longitude: 73.0287 },
    { name: "G-13", latitude: 33.6536, longitude: 72.992 },
    { name: "H-8", latitude: 33.69, longitude: 73.048 },
    { name: "I-8", latitude: 33.6601, longitude: 73.0805 },
    { name: "I-9", latitude: 33.6534, longitude: 73.0664 },
    { name: "I-10", latitude: 33.645, longitude: 73.0561 },
    { name: "E-11", latitude: 33.7, longitude: 72.9865 },
    { name: "D-12", latitude: 33.66, longitude: 72.965 },
    { name: "Bhara Kahu", latitude: 33.7415, longitude: 73.1785 },
    { name: "Chak Shahzad", latitude: 33.67, longitude: 73.15 },
  ],
  Rawalpindi: [
    { name: "Saddar", latitude: 33.6007, longitude: 73.0483 },
    { name: "Satellite Town", latitude: 33.6375, longitude: 73.0736 },
    { name: "Bahria Town", latitude: 33.544, longitude: 73.117 },
    { name: "DHA", latitude: 33.53, longitude: 73.12 },
    { name: "Gulraiz", latitude: 33.613, longitude: 73.08 },
    { name: "Westridge", latitude: 33.605, longitude: 73.025 },
    { name: "Chaklala", latitude: 33.6, longitude: 73.093 },
    { name: "Airport Housing", latitude: 33.56, longitude: 73.09 },
    { name: "Race Course", latitude: 33.61, longitude: 73.045 },
    { name: "Peshawar Road", latitude: 33.58, longitude: 73.005 },
    { name: "Adiala Road", latitude: 33.56, longitude: 73.015 },
    { name: "Shamsabad", latitude: 33.635, longitude: 73.045 },
    { name: "Dhoke Kashmirian", latitude: 33.64, longitude: 73.07 },
    { name: "Tench Bhatta", latitude: 33.62, longitude: 73.06 },
    { name: "Lalkurti", latitude: 33.595, longitude: 73.055 },
  ],
};

export function getNeighbourhoodsForCity(city: string): Neighbourhood[] {
  return NEIGHBOURHOODS[city] || [];
}

// Exact, case-insensitive match on the dropdown values. Unknown or free-text
// inputs return null — callers then fall back to the city centre.
export function resolveNeighbourhood(city: string, name: string): Neighbourhood | null {
  const needle = (name || "").trim().toLowerCase();
  if (!needle) return null;
  return getNeighbourhoodsForCity(city).find((n) => n.name.toLowerCase() === needle) || null;
}
