export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  bloodGroup: string;
  location: string;
  city: string; // any city in SUPPORTED_CITIES (see src/lib/regions.ts)
  isDonor: boolean;
  avatar?: string;
}

export interface DonorReview {
  id: string;
  patientName: string;
  rating: number;
  comment: string;
  date: string;
}

export interface Donor {
  id: string;
  name: string; // public listings show first name + last initial only
  bloodGroup: string;
  phone: string; // always masked on public listings
  phoneMasked?: boolean;
  city: string; // any city in SUPPORTED_CITIES (see src/lib/regions.ts)
  area: string; // coarse area/neighbourhood text — never coordinates
  isAvailable: boolean;
  isVerified: boolean;
  lastDonationDate?: string;
  nextEligibleDate?: string;
  stats: {
    donationsCount: number;
    streakCount: number;
    livesSaved: number;
  };
  badges: string[];
  reviewsSummary?: {
    count: number;
    average: number | null;
  };
  reviews?: DonorReview[];
}

export interface Hospital {
  id: string;
  name: string;
  address: string;
  phone: string;
  city: string; // any city in SUPPORTED_CITIES (see src/lib/regions.ts)
  latitude: number;
  longitude: number;
  emergencyHours: string;
  bloodAvailability: {
    [key: string]: 'In Stock' | 'Critical' | 'Low' | 'Out of Stock';
  };
  rating: number;
  reviewsCount: number;
  // Honest-discovery flags: seeded hospitals are sample data, never live
  // inventory. stockLastUpdated is the real date the seed data was reviewed.
  isSample?: boolean;
  stockLastUpdated?: string; // ISO date, e.g. "2026-09-11"
}

export interface BloodCamp {
  id: string;
  title: string;
  organizer: string;
  location: string;
  city: string; // any city in SUPPORTED_CITIES (see src/lib/regions.ts)
  date: string;
  time: string;
  description: string;
  latitude: number;
  longitude: number;
  registeredCount: number;
  // Seeded camps are sample listings, not confirmed real-world events.
  isSample?: boolean;
}

export interface EmergencyRequest {
  id: string;
  patientName: string;
  bloodGroup: string;
  unitsNeeded: number;
  hospitalId: string;
  hospitalName: string;
  contactPhone: string;
  phoneMasked?: boolean;
  requiredBy: string;
  reason: string;
  urgency: 'Immediate (SOS)' | 'Urgent' | 'Routine';
  status: 'Pending' | 'Fulfilled' | 'Cancelled' | 'Expired';
  city: string; // any city in SUPPORTED_CITIES (see src/lib/regions.ts)
  createdAt: string;
  // P0-5: auto-close deadline. Absent on legacy rows — the server derives it
  // from createdAt + SOS_EXPIRY_HOURS. Present only while the SOS is open.
  expiresAt?: string;
  expiredAt?: string;
  matchingDonorsCount: number;
  // Organization portal (Phase 3): present only when an approved NGO/hospital
  // organization posted this request on behalf of the patient.
  orgId?: string;
  orgName?: string;
  postedBy?: 'organization';
  // P2-4: coarse neighbourhood the requester chose (from the supported list
  // for their city) — used for distance-based donor matching, never a street
  // address. Absent on legacy rows.
  neighbourhood?: string;
  // P2-4: anchor coordinates used for nearest-first donor ranking. Present
  // only when a neighbourhood (or hospital with coordinates) was set.
  latitude?: number;
  longitude?: number;
}

export interface DonationHistory {
  id: string;
  donorId: string;
  locationName: string;
  date: string;
  units: number;
  type: string;
  status: 'Completed' | 'Scheduled';
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
  isEmergencyAlert?: boolean;
  // Honest AI labeling: "gemini" = answered by the configured Gemini model,
  // "fallback" = local rules-based answer (no AI key set, or AI errored).
  source?: 'gemini' | 'fallback';
}

export interface RealtimeNotification {
  id: string;
  title: string;
  message: string;
  type: 'emergency' | 'system' | 'badge';
  timestamp: string;
  read: boolean;
  // Seeded demo rows are flagged by the backend so the UI can label them.
  isSample?: boolean;
}
