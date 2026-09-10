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
  name: string;
  bloodGroup: string;
  phone: string;
  city: string; // any city in SUPPORTED_CITIES (see src/lib/regions.ts)
  location: string;
  latitude: number;
  longitude: number;
  isAvailable: boolean;
  isVerified: boolean;
  lastDonationDate?: string;
  stats: {
    donationsCount: number;
    streakCount: number;
    livesSaved: number;
  };
  badges: string[];
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
}

export interface EmergencyRequest {
  id: string;
  patientName: string;
  bloodGroup: string;
  unitsNeeded: number;
  hospitalId: string;
  hospitalName: string;
  contactPhone: string;
  requiredBy: string;
  reason: string;
  urgency: 'Immediate (SOS)' | 'Urgent' | 'Routine';
  status: 'Pending' | 'Fulfilled' | 'Cancelled';
  city: string; // any city in SUPPORTED_CITIES (see src/lib/regions.ts)
  createdAt: string;
  matchingDonorsCount: number;
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
}

export interface RealtimeNotification {
  id: string;
  title: string;
  message: string;
  type: 'emergency' | 'system' | 'badge';
  timestamp: string;
  read: boolean;
}
