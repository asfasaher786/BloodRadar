// P2-4: name lists for the neighbourhood dropdowns (donor signup + SOS form).
// Mirrors backend/config/neighbourhoods.ts — the client only needs the names;
// the server owns the centroid coordinates and distance math.

export const NEIGHBOURHOOD_NAMES: { [city: string]: string[] } = {
  Islamabad: [
    "F-6", "F-7", "F-8", "F-10", "F-11",
    "G-6", "G-7", "G-8", "G-9", "G-10", "G-11", "G-13",
    "H-8", "I-8", "I-9", "I-10", "E-11", "D-12",
    "Bhara Kahu", "Chak Shahzad",
  ],
  Rawalpindi: [
    "Saddar", "Satellite Town", "Bahria Town", "DHA", "Gulraiz",
    "Westridge", "Chaklala", "Airport Housing", "Race Course",
    "Peshawar Road", "Adiala Road", "Shamsabad", "Dhoke Kashmirian",
    "Tench Bhatta", "Lalkurti",
  ],
};

export function getNeighbourhoodsForCity(city: string): string[] {
  return NEIGHBOURHOOD_NAMES[city] || [];
}
