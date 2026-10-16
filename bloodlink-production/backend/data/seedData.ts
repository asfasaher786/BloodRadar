export const preseededUsers = [
  {
    id: "usr-1",
    name: "Dr. Safeer Khan",
    email: "saf@bloodradar.pk",
    phone: "+92 333 1234567",
    bloodGroup: "O+",
    location: "Sector F-10, Islamabad",
    city: "Islamabad" as const,
    isDonor: true,
  },
  {
    id: "usr-2",
    name: "Fatima Ahmed",
    email: "fatima@bloodradar.pk",
    phone: "+92 321 9876543",
    bloodGroup: "A-",
    location: "Saddar, Rawalpindi",
    city: "Rawalpindi" as const,
    isDonor: true,
  }
];

export const preseededDonors = [
  {
    id: "dnr-1",
    name: "Zainab Malik",
    bloodGroup: "O-",
    phone: "+92 300 5551212",
    city: "Islamabad" as const,
    location: "G-11, Islamabad",
    latitude: 33.6667,
    longitude: 73.0112,
    isAvailable: true,
    isVerified: true,
    lastDonationDate: "2026-02-15",
    stats: { donationsCount: 8, streakCount: 4, livesSaved: 12 },
    badges: ["Life Saver", "Century Club", "Immediate SOS responder"],
    reviews: [
      { id: "rev-1-1", patientName: "Amir Khan", rating: 5, comment: "Extremely cooperative and arrived within 25 minutes. True lifesaver!", date: "2026-03-10" }
    ]
  },
  {
    id: "dnr-2",
    name: "Dr. Safeer Khan",
    bloodGroup: "O+",
    phone: "+92 333 1234567",
    city: "Islamabad" as const,
    location: "Sector F-10, Islamabad",
    latitude: 33.6934,
    longitude: 73.0169,
    isAvailable: true,
    isVerified: true,
    lastDonationDate: "2026-03-20",
    stats: { donationsCount: 15, streakCount: 7, livesSaved: 22 },
    badges: ["Elite Donor", "Loyalist", "Gold Class"],
    reviews: [
      { id: "rev-2-1", patientName: "Ayesha Bibi", rating: 5, comment: "Dr. Safeer answered at 2 AM and donated blood for critical surgery. God bless you, brother!", date: "2026-04-20" },
      { id: "rev-2-2", patientName: "Major Tariq", rating: 5, comment: "An ultimate professional donor. Prompt and highly supportive during our distress.", date: "2026-05-15" }
    ]
  },
  {
    id: "dnr-3",
    name: "Usman Ghani",
    bloodGroup: "B+",
    phone: "+92 345 8887766",
    city: "Rawalpindi" as const,
    location: "Saddar Road, Rawalpindi",
    latitude: 33.5932,
    longitude: 73.0538,
    isAvailable: true,
    isVerified: true,
    lastDonationDate: "2026-04-10",
    stats: { donationsCount: 3, streakCount: 1, livesSaved: 5 },
    badges: ["Rising Hero"],
    reviews: [
      { id: "rev-3-1", patientName: "Hamza Shah", rating: 4, comment: "Arrived quickly for the B+ requirement. Very polite gentleman.", date: "2026-04-24" }
    ]
  },
  {
    id: "dnr-4",
    name: "Fatima Ahmed",
    bloodGroup: "A-",
    phone: "+92 321 9876543",
    city: "Rawalpindi" as const,
    location: "Chungi No. 22, Rawalpindi",
    latitude: 33.5750,
    longitude: 73.0450,
    isAvailable: true,
    isVerified: true,
    lastDonationDate: "2026-01-05",
    stats: { donationsCount: 6, streakCount: 3, livesSaved: 9 },
    badges: ["SOS Responder", "Silver Class"],
    reviews: [
      { id: "rev-4-1", patientName: "Mariam Jameel", rating: 5, comment: "Responsive donor. Thank you so much for the help and speedy ride to PIMS.", date: "2026-02-25" }
    ]
  },
  {
    id: "dnr-5",
    name: "Amna Bibi",
    bloodGroup: "AB+",
    phone: "+92 334 2223344",
    city: "Islamabad" as const,
    location: "Bahria Town Phase 4, Islamabad",
    latitude: 33.5186,
    longitude: 73.1112,
    isAvailable: true,
    isVerified: true,
    lastDonationDate: "2025-11-12",
    stats: { donationsCount: 4, streakCount: 2, livesSaved: 4 },
    badges: ["Supporter"],
    reviews: []
  },
  {
    id: "dnr-6",
    name: "Hassan Raza",
    bloodGroup: "A+",
    phone: "+92 312 4445556",
    city: "Rawalpindi" as const,
    location: "Holy Family, Rawalpindi",
    latitude: 33.6300,
    longitude: 73.0700,
    isAvailable: true,
    isVerified: true,
    lastDonationDate: "2026-03-10",
    stats: { donationsCount: 9, streakCount: 5, livesSaved: 14 },
    badges: ["Hero Donor", "Century Club"],
    reviews: [
      { id: "rev-6-1", patientName: "Kashif Mahmood", rating: 5, comment: "Incredibly helpful person. Donated at Holy Family Hospital during dengue crisis.", date: "2026-03-25" }
    ]
  },
  {
    id: "dnr-7",
    name: "Bilal Siddiqui",
    bloodGroup: "B-",
    phone: "+92 301 7771122",
    city: "Islamabad" as const,
    location: "Sector I-8, Islamabad",
    latitude: 33.6595,
    longitude: 73.0746,
    isAvailable: false,
    isVerified: true,
    lastDonationDate: "2026-05-01",
    stats: { donationsCount: 1, streakCount: 0, livesSaved: 2 },
    badges: ["First Step"],
    reviews: []
  }
];

export const preseededHospitals = [
  {
    id: "hosp-1",
    name: "Pakistan Institute of Medical Sciences (PIMS)",
    address: "Ibn-e-Sina Road, Sector G-8/3, Islamabad",
    phone: "+92 51 9261170",
    city: "Islamabad" as const,
    latitude: 33.7029,
    longitude: 73.0569,
    emergencyHours: "24/7 Support",
    bloodAvailability: {
      "O+": "In Stock" as const,
      "O-": "Critical" as const,
      "A+": "Low" as const,
      "A-": "Out of Stock" as const,
      "B+": "In Stock" as const,
      "B-": "Low" as const,
      "AB+": "In Stock" as const,
      "AB-": "Critical" as const,
    },
    rating: 4.5,
    reviewsCount: 1420,
    stockLastUpdated: "2026-09-11"
  },
  {
    id: "hosp-2",
    name: "Holy Family Hospital (HFH)",
    address: "Satellite Town, Rawalpindi",
    phone: "+92 51 9290321",
    city: "Rawalpindi" as const,
    latitude: 33.6300,
    longitude: 73.0700,
    emergencyHours: "24/7 Support",
    bloodAvailability: {
      "O+": "In Stock" as const,
      "O-": "Low" as const,
      "A+": "In Stock" as const,
      "A-": "Low" as const,
      "B+": "Critical" as const,
      "B-": "Out of Stock" as const,
      "AB+": "Low" as const,
      "AB-": "Low" as const,
    },
    rating: 4.2,
    reviewsCount: 980,
    stockLastUpdated: "2026-09-11"
  },
  {
    id: "hosp-3",
    name: "Shifa International Hospital",
    address: "Pitras Bukhari Road, Sector H-8/4, Islamabad",
    phone: "+92 51 8463000",
    city: "Islamabad" as const,
    latitude: 33.6268,
    longitude: 73.0851,
    emergencyHours: "24/7 Premium Support",
    bloodAvailability: {
      "O+": "In Stock" as const,
      "O-": "In Stock" as const,
      "A+": "In Stock" as const,
      "A-": "Critical" as const,
      "B+": "In Stock" as const,
      "B-": "Critical" as const,
      "AB+": "In Stock" as const,
      "AB-": "Low" as const,
    },
    rating: 4.7,
    reviewsCount: 2150,
    stockLastUpdated: "2026-09-11"
  },
  {
    id: "hosp-4",
    name: "Benazir Bhutto Hospital (BBH)",
    address: "Murree Road, Rawalpindi",
    phone: "+92 51 9290301",
    city: "Rawalpindi" as const,
    latitude: 33.6062,
    longitude: 73.0645,
    emergencyHours: "24/7 Support",
    bloodAvailability: {
      "O+": "Critical" as const,
      "O-": "Out of Stock" as const,
      "A+": "In Stock" as const,
      "A-": "Low" as const,
      "B+": "In Stock" as const,
      "B-": "Low" as const,
      "AB+": "Low" as const,
      "AB-": "Critical" as const,
    },
    rating: 4.1,
    reviewsCount: 1100,
    stockLastUpdated: "2026-09-11"
  },
  {
    id: "hosp-5",
    name: "Fauji Foundation Hospital",
    address: "Jhelum Road, Rawalpindi",
    phone: "+92 51 5788100",
    city: "Rawalpindi" as const,
    latitude: 33.5414,
    longitude: 73.1202,
    emergencyHours: "24/7 Support",
    bloodAvailability: {
      "O+": "In Stock" as const,
      "O-": "Low" as const,
      "A+": "In Stock" as const,
      "A-": "Low" as const,
      "B+": "In Stock" as const,
      "B-": "Low" as const,
      "AB+": "In Stock" as const,
      "AB-": "Low" as const,
    },
    rating: 4.4,
    reviewsCount: 650,
    stockLastUpdated: "2026-09-11"
  },
  {
    id: "hosp-6",
    name: "Quaid-e-Azam International Hospital",
    address: "Peshawar Road, Near H-13, Islamabad",
    phone: "+92 51 8449100",
    city: "Islamabad" as const,
    latitude: 33.6514,
    longitude: 72.9691,
    emergencyHours: "24/7 Support",
    bloodAvailability: {
      "O+": "Low" as const,
      "O-": "Critical" as const,
      "A+": "In Stock" as const,
      "A-": "Out of Stock" as const,
      "B+": "In Stock" as const,
      "B-": "Low" as const,
      "AB+": "Low" as const,
      "AB-": "Critical" as const,
    },
    rating: 4.6,
    reviewsCount: 890,
    stockLastUpdated: "2026-09-11"
  }
];

export const preseededCamps = [
  {
    id: "camp-1",
    title: "Centaurus Mall Emergency Camp",
    organizer: "BloodRadar & Red Crescent",
    location: "Main Foyer, Sector F-8, Islamabad",
    city: "Islamabad" as const,
    date: "2026-06-01",
    time: "10:00 AM - 08:00 PM",
    description: "Annual Winter Emergency Drive to supply public hostpitals with O-Negative and A-Positive blood units.",
    latitude: 33.7077,
    longitude: 73.0504,
    registeredCount: 48
  },
  {
    id: "camp-2",
    title: "Giga Mall Mega Donation Drive",
    organizer: "Shifa Foundation",
    location: "Main Atrium, DHA Phase 2, Islamabad",
    city: "Islamabad" as const,
    date: "2026-06-15",
    time: "11:00 AM - 09:00 PM",
    description: "A community drive helping childhood Leukemia patients secure vital blood platelet units.",
    latitude: 33.5262,
    longitude: 73.1555,
    registeredCount: 65
  },
  {
    id: "camp-3",
    title: "Saddar Community Blood Drive",
    organizer: "Holy Family Blood Club",
    location: "Saddar Commercial Area, Rawalpindi",
    city: "Rawalpindi" as const,
    date: "2026-06-22",
    time: "09:00 AM - 05:00 PM",
    description: "Support our local emergency trauma centers by donating a single bag. Simple, fast check-ins with QR.",
    latitude: 33.5932,
    longitude: 73.0538,
    registeredCount: 37
  }
];

export const preseededEmergencies = [
  {
    id: "sos-1",
    patientName: "Muhammad Zubair",
    bloodGroup: "O-",
    unitsNeeded: 3,
    hospitalId: "hosp-2",
    hospitalName: "Holy Family Hospital (HFH)",
    contactPhone: "+92 333 9998822",
    requiredBy: "2026-05-26",
    reason: "Severe trauma from Murree Road accident",
    urgency: "Immediate (SOS)" as const,
    status: "Pending" as const,
    city: "Rawalpindi" as const,
    createdAt: "2026-05-25T11:00:00Z",
    matchingDonorsCount: 1
  },
  {
    id: "sos-2",
    patientName: "Ayesha Bibi",
    bloodGroup: "A-",
    unitsNeeded: 2,
    hospitalId: "hosp-3",
    hospitalName: "Shifa International Hospital",
    contactPhone: "+92 305 4443311",
    requiredBy: "2026-05-28",
    reason: "Emergency C-section surgery complications",
    urgency: "Urgent" as const,
    status: "Pending" as const,
    city: "Islamabad" as const,
    createdAt: "2026-05-25T08:30:00Z",
    matchingDonorsCount: 3
  }
];

export const preseededHistory = [
  { id: "dh-1", donorId: "dnr-2", locationName: "PIMS Islamabad", date: "2026-03-20", units: 1, type: "Whole Blood", status: "Completed" },
  { id: "dh-2", donorId: "dnr-2", locationName: "Shifa International", date: "2025-12-15", units: 1, type: "Whole Blood", status: "Completed" },
  { id: "dh-3", donorId: "dnr-1", locationName: "Holy Family Hospital", date: "2026-02-15", units: 1, type: "Platelets", status: "Completed" }
];

export const preseededNotifications = [
  {
    id: "notif-1",
    title: "🚨 SOS Emergency in Rawalpindi",
    message: "O- donor urgently required at Holy Family Hospital for trauma surgery patient Muhammad Zubair.",
    type: "emergency" as const,
    timestamp: "2026-05-25T11:05:00Z",
    read: false,
  },
  {
    id: "notif-2",
    title: "🌟 Weekly Streak Unlocked!",
    message: "You've successfully secured a streak badge for constant availability setup. Thank you!",
    type: "badge" as const,
    timestamp: "2026-05-25T09:00:00Z",
    read: false,
  }
];
