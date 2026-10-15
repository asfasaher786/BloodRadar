import React, { useState, FormEvent } from "react";
import { Donor } from "../types";
import { API_BASE } from "../lib/api";
import { SUPPORTED_CITIES, DEFAULT_CITY } from "../lib/regions";
import { 
  Search, MapPin, CheckCircle, ShieldAlert, PhoneCall, Award, 
  Calendar, ToggleLeft, ToggleRight, Star, MessageSquare, Send, Sparkles, UserPlus, Lock 
} from "lucide-react";

interface DonorSearchProps {
  donors: Donor[];
  lang: 'en' | 'ur';
  onReviewSubmitted: () => void;
  activeTab?: 'search' | 'register';
  setActiveTab?: (tab: 'search' | 'register') => void;
}

// Who a donor of each blood type can actually help — shown to educate
// first-time donors, similar to what Lifeblood/Canadian Blood Services do.
const DONOR_COMPATIBILITY: { [key: string]: string[] } = {
  "O-": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
  "O+": ["O+", "A+", "B+", "AB+"],
  "A-": ["A-", "A+", "AB-", "AB+"],
  "A+": ["A+", "AB+"],
  "B-": ["B-", "B+", "AB-", "AB+"],
  "B+": ["B+", "AB+"],
  "AB-": ["AB-", "AB+"],
  "AB+": ["AB+"]
};

export default function DonorSearch({ donors, lang, onReviewSubmitted, activeTab, setActiveTab }: DonorSearchProps) {
  const [bloodFilter, setBloodFilter] = useState("All");
  const [cityFilter, setCityFilter] = useState("All");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Expanded panel state per individual donor card
  const [expandedDonorReviews, setExpandedDonorReviews] = useState<string | null>(null);

  // Review submission state
  const [patientName, setPatientName] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);

  // Local Tab state if parent doesn't provide it
  const [localActiveTab, setLocalActiveTab] = useState<'search' | 'register'>('search');
  const currentTab = activeTab !== undefined ? activeTab : localActiveTab;
  const changeTab = setActiveTab !== undefined ? setActiveTab : setLocalActiveTab;

  // New Volunteer Registration state
  const [regName, setRegName] = useState("");
  const [regBlood, setRegBlood] = useState("O-");
  const [regPhone, setRegPhone] = useState("");
  const [regCity, setRegCity] = useState(DEFAULT_CITY);
  const [regLocation, setRegLocation] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [healthConfirmed, setHealthConfirmed] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState("");

  // Phone verification (during registration) state
  const [otpStage, setOtpStage] = useState<'idle' | 'sent' | 'verified'>('idle');
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);

  // Donor numbers are privacy-protected now: full numbers are never listed
  // publicly. The only way to reach a donor is through an SOS → contact
  // request → donor accepts flow. This button shows the masked number and
  // explains how contact works.
  const handleCall = (donor: Donor) => {
    setCopiedId(donor.id);
    setTimeout(() => setCopiedId(null), 3000);
  };

  const handleReviewSubmit = async (donorId: string) => {
    if (!patientName.trim() || !comment.trim()) {
      setReviewError(lang === 'en' ? "Please complete all fields" : "براہ کرم تمام خانے پُر کریں");
      return;
    }
    setIsSubmittingReview(true);
    setReviewError("");
    try {
      const response = await fetch(`${API_BASE}/api/donors/${donorId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName,
          rating,
          comment
        })
      });
      
      if (response.ok) {
        setReviewSuccess(lang === 'en' ? "Review successfully posted!" : "رائے کامیابی سے درج کر دی گئی!");
        setPatientName("");
        setComment("");
        setRating(5);
        // Refresh parent state
        onReviewSubmitted();
      } else {
        const data = await response.json();
        setReviewError(data.error || "Failed to post review.");
      }
    } catch (err) {
      setReviewError("Network error. Try again shortly.");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Registration is now OTP-first (privacy design): the form collects the
  // profile, then a verification code is sent to the phone, and verifying it
  // creates the donor AND logs the browser in via httpOnly cookies. No donor
  // record exists until the phone is verified.
  const handleRegisterVolunteer = async (e: FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regPhone.trim() || !regLocation.trim()) {
      setRegisterError(lang === 'en' ? "Please complete all fields." : "براہ کرم تمام لازمی خانے پُر کریں۔");
      return;
    }
    if (!ageConfirmed || !healthConfirmed) {
      setRegisterError(lang === 'en'
        ? "Please confirm the eligibility questions below — they exist to keep both you and patients safe."
        : "براہ کرم اہلیت کے سوالات کی تصدیق کریں — یہ آپ اور مریضوں دونوں کی حفاظت کے لیے ضروری ہیں۔");
      return;
    }
    if (!consentGiven) {
      setRegisterError(lang === 'en'
        ? "Please confirm you consent to your contact details being shared with patients in emergencies."
        : "براہ کرم اپنی رضامندی کی تصدیق کریں۔");
      return;
    }

    setIsRegistering(true);
    setRegisterError("");
    setRegisterSuccess(null);

    try {
      // Step 1: request the verification code for this phone.
      const response = await fetch(`${API_BASE}/api/auth/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: regPhone })
      });
      const data = await response.json();
      if (response.ok) {
        setOtpStage('sent');
        setOtpCode("");
        setOtpError("");
        if (data.devOtp) setDevOtpHint(data.devOtp);
      } else {
        setRegisterError(data.error || (lang === 'en' ? "Couldn't send the verification code. Try again." : "کوڈ نہیں بھیجا جا سکا۔ دوبارہ کوشش کریں۔"));
      }
    } catch (err) {
      setRegisterError(lang === 'en' ? "Network/Server error. Please try again." : "سرور میں خرابی۔ دوبارہ کوشش کریں۔");
    } finally {
      setIsRegistering(false);
    }
  };

  // Step 2: verify the code — this creates the verified donor profile and
  // sets the session cookies (the phone is proven, not just claimed).
  const handleVerifyOtp = async () => {
    if (otpCode.trim().length !== 6) return;
    setOtpBusy(true);
    setOtpError("");
    try {
      const response = await fetch(`${API_BASE}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone: regPhone,
          code: otpCode.trim(),
          registerAsDonor: true,
          name: regName,
          bloodGroup: regBlood,
          city: regCity,
          location: regLocation
        })
      });
      const data = await response.json();
      if (response.ok) {
        setOtpStage('verified');
        setRegisterSuccess(lang === 'en' ? "Successfully registered as a verified savior volunteer! Your live card is now added to the registry." : "بطور تصدیق شدہ رضاکار خون عطیہ دہندہ کامیابی سے اندراج ہو چکا ہے!");
        if (data.user?.phone) localStorage.setItem("bloodradar_my_donor_phone", data.user.phone);
        setRegName("");
        setRegPhone("");
        setRegLocation("");
        setRegBlood("O-");
        setAgeConfirmed(false);
        setHealthConfirmed(false);
        setConsentGiven(false);
        onReviewSubmitted();
      } else {
        setOtpError(data.error || (lang === 'en' ? "Incorrect code. Try again." : "غلط کوڈ۔ دوبارہ کوشش کریں۔"));
      }
    } catch {
      setOtpError(lang === 'en' ? "Network error. Try again." : "نیٹ ورک میں خرابی۔ دوبارہ کوشش کریں۔");
    } finally {
      setOtpBusy(false);
    }
  };

  const filtered = donors.filter(donor => {
    if (bloodFilter !== "All" && donor.bloodGroup !== bloodFilter) return false;
    if (cityFilter !== "All" && donor.city !== cityFilter) return false;
    if (availableOnly && !donor.isAvailable) return false;
    return true;
  });

  return (
    <div id="donor-search-module-card" className="bg-[var(--card)] rounded-2xl border border-[var(--border)] p-5 md:p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div>
          <h3 className="text-base md:text-lg font-sans font-bold text-[var(--ink)] flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-[var(--blood)] animate-pulse" />
            {lang === 'en' ? 'Savior Network & Registry' : 'لائیو عطیہ دہندگان کی رجسٹری'}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5 font-sans">
            {lang === 'en' ? 'Verified volunteers in Rawalpindi & Islamabad serving real-time medical needs' : 'راولپنڈی اور اسلام آباد کے تصدیق شدہ رضاکار برائے فوری رابطہ'}
          </p>
        </div>

        {/* Available only switch / Top Actions */}
        {currentTab === 'search' && (
          <button
            id="btn-toggle-available-only"
            onClick={() => setAvailableOnly(!availableOnly)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)] hover:text-slate-950 hover:bg-slate-100 transition cursor-pointer self-start md:self-auto"
          >
            {availableOnly ? (
              <ToggleRight className="w-5.5 h-5.5 text-[var(--blood)]" />
            ) : (
              <ToggleLeft className="w-5.5 h-5.5 text-[var(--muted)]" />
            )}
            <span>{lang === 'en' ? 'Active / Available Only' : 'دستیاب رضاکار'}</span>
          </button>
        )}
      </div>

      {/* Sub-Tabs Selector */}
      <div className="flex border-b border-slate-150 mb-5 text-xs">
        <button
          onClick={() => changeTab('search')}
          id="btn-donor-tab-search"
          className={`flex-1 py-2.5 text-center font-bold font-sans tracking-wide border-b-2 transition-all duration-300 cursor-pointer ${
            currentTab === 'search'
              ? 'border-rose-600 text-[var(--blood)] font-extrabold'
              : 'border-transparent text-slate-505 hover:text-slate-800'
          }`}
        >
          🔍 {lang === 'en' ? 'Search Live Registry' : 'رضاکار تلاش کریں'} ({donors.length})
        </button>
        <button
          onClick={() => changeTab('register')}
          id="btn-donor-tab-register"
          className={`flex-1 py-2.5 text-center font-bold font-sans tracking-wide border-b-2 transition-all duration-300 cursor-pointer ${
            currentTab === 'register'
              ? 'border-rose-600 text-[var(--blood)] font-extrabold'
              : 'border-transparent text-[var(--muted)] hover:text-slate-800'
          }`}
        >
          ✍️ {lang === 'en' ? 'Register As Savior' : 'بطور رضاکار لائیو اندراج'}
        </button>
      </div>

      {currentTab === 'search' ? (
        <>
          {/* Filters Area */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5 text-xs">
            {/* Blood group selection */}
            <div>
              <label className="block text-[var(--muted)] font-medium mb-1.5 font-sans">
                {lang === 'en' ? 'Filter Blood Type' : 'بلڈ گروپ منتخب کریں'}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {["All", "O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"].map(gp => (
                  <button
                    key={gp}
                    onClick={() => setBloodFilter(gp)}
                    id={`btn-filter-blood-${gp}`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-sans transition-all duration-200 cursor-pointer ${
                      bloodFilter === gp 
                        ? 'bg-rose-605 text-white bg-[var(--blood)] shadow-sm' 
                        : 'bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] hover:border-slate-300 hover:text-[var(--ink)]'
                    }`}
                  >
                    {gp}
                  </button>
                ))}
              </div>
            </div>

            {/* City Filter */}
            <div>
              <label className="block text-[var(--muted)] font-medium mb-1.5 font-sans">
                {lang === 'en' ? 'Filter City' : 'شہر منتخب کریں'}
              </label>
              <div className="flex gap-2">
                {["All", ...SUPPORTED_CITIES].map(city => (
                  <button
                    key={city}
                    onClick={() => setCityFilter(city)}
                    id={`btn-filter-city-${city}`}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold font-sans transition-all duration-200 cursor-pointer ${
                      cityFilter === city 
                        ? 'bg-rose-605 text-white bg-[var(--blood)] shadow-sm' 
                        : 'bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] hover:border-slate-300 hover:text-[var(--ink)]'
                    }`}
                  >
                    {city}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Donors List layout */}
          <div className="space-y-4 max-h-[500px] overflow-y-auto scrollbar-thin pr-1">
            {filtered.length === 0 ? (
              <div className="text-center py-8 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
                <ShieldAlert className="w-8 h-8 text-[var(--muted)] mx-auto mb-2" />
                <p className="text-sm font-medium text-[var(--muted)]">
                  {lang === 'en' ? 'No matching available donors found' : 'کوئی مماثل رضاکار تلاش نہیں کیا جا سکا'}
                </p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  {lang === 'en' ? 'Try seeking different blood compatibility or cities' : 'دوسری مطابقت یا دوسرے جڑواں شہر منتخب کریں'}
                </p>
              </div>
            ) : (
              filtered.map((donor) => {
                const reviews = donor.reviews || [];
                const totalReviews = reviews.length;
                const avgRating = totalReviews > 0 
                  ? (reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(1)
                  : null;

                return (
                  <div 
                    key={donor.id}
                    className="p-4 rounded-xl bg-[var(--card)] border border-slate-250 hover:border-rose-300 hover:shadow-sm transition-all duration-300 flex flex-col gap-4"
                  >
                    {/* Primary row */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {/* Big blood marker */}
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-650 via-rose-600 to-rose-700 shadow shadow-rose-100 flex flex-col items-center justify-center text-white font-sans shrink-0">
                          <span className="text-base font-extrabold leading-none">{donor.bloodGroup}</span>
                          <span className="text-[9px] font-mono tracking-tighter opacity-80 mt-1 uppercase">Twin</span>
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h4 className="text-sm font-bold text-[var(--ink)] font-sans tracking-wide">
                              {donor.name}
                            </h4>
                            
                            {/* Average Star Rating Badge */}
                            <div className="flex items-center gap-1 bg-[var(--warn)]/10 border border-[var(--warn)]/30 px-1.5 py-0.5 rounded text-[10px] text-amber-705 font-bold font-sans">
                              <Star className="w-2.5 h-2.5 fill-amber-550 text-amber-500" />
                              <span className="font-semibold">{avgRating ? `${avgRating} (${totalReviews})` : (lang === 'en' ? 'New (0)' : 'نیا (0)')}</span>
                            </div>

                            {donor.isVerified ? (
                              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-medium bg-[var(--safe)]/8 border border-[var(--safe)]/30 text-[var(--safe)]" title={lang === 'en' ? "Phone number verified" : "فون نمبر تصدیق شدہ"}>
                                <CheckCircle className="w-2.5 h-2.5" /> {lang === 'en' ? 'Verified' : 'تصدیق شدہ'}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono font-medium bg-[var(--warn)]/10 border border-[var(--warn)]/30 text-[var(--warn)]" title={lang === 'en' ? "Phone not yet verified — worth a quick call to confirm" : "فون نمبر ابھی تصدیق شدہ نہیں — رابطہ کر کے تصدیق کر لیں"}>
                                {lang === 'en' ? 'Unverified' : 'غیر تصدیق شدہ'}
                              </span>
                            )}

                            {donor.isAvailable ? (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono font-medium bg-green-50 border border-green-200 text-green-700">
                                Available
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono font-medium bg-slate-100 border border-[var(--border)] text-[var(--muted)]">
                                Busy
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] mt-1">
                            <MapPin className="w-3.5 h-3.5 text-rose-500" />
                            <span>{donor.location}, {donor.city}</span>
                          </div>

                          {/* Badges */}
                          <div className="flex flex-wrap gap-1 mt-2">
                            {donor.badges.map((badge, bIdx) => (
                              <span 
                                key={bIdx}
                                className="px-2 py-0.5 rounded-md text-[9px] bg-indigo-50 border border-indigo-100 text-indigo-700 font-sans tracking-wide flex items-center gap-0.5"
                              >
                                <Award className="w-2.5 h-2.5" />
                                {badge}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Actions layout (Donations & Reviews toggle & Dial calls) */}
                      <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto border-t sm:border-t-0 border-slate-100 pt-3 sm:pt-0">
                        
                        <div className="text-left sm:text-right text-xs max-sm:flex max-sm:items-center max-sm:gap-2 max-sm:w-full">
                          <div className="text-[var(--muted)] font-sans">
                            {lang === 'en' ? 'Donated count:' : 'عطیات تعداد:'} <span className="text-slate-800 font-semibold">{donor.stats?.donationsCount ?? 1} bags</span>
                          </div>
                          <div className="text-[var(--muted)] font-sans">
                            {lang === 'en' ? 'Lives Saved:' : 'بچائی گئی جانیں:'} <span className="text-[var(--safe)] font-bold">{donor.stats?.livesSaved ?? 1}</span>
                          </div>
                        </div>

                        <div className="flex gap-2 w-full sm:w-auto text-xs">
                          {/* Reviews Toggle Button */}
                          <button
                            onClick={() => {
                              if (expandedDonorReviews === donor.id) {
                                setExpandedDonorReviews(null);
                              } else {
                                setExpandedDonorReviews(donor.id);
                                // Reset states
                                setPatientName("");
                                setRating(5);
                                setComment("");
                                setReviewError("");
                                setReviewSuccess(null);
                              }
                            }}
                            className={`flex-1 sm:flex-initial py-2 px-3 rounded-xl text-xs font-bold leading-none border transition duration-300 flex items-center justify-center gap-1 cursor-pointer ${
                              expandedDonorReviews === donor.id 
                                ? 'bg-slate-900 border-slate-900 text-white font-bold' 
                                : 'bg-[var(--surface)] border-[var(--border)] text-[var(--ink)] hover:bg-slate-100'
                            }`}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>{lang === 'en' ? 'Reviews' : 'رائے'} ({totalReviews})</span>
                          </button>

                          {/* Protected number — full numbers are revealed only via the SOS contact flow */}
                          <button
                            id={`btn-call-donor-${donor.id}`}
                            onClick={() => handleCall(donor)}
                            title={lang === 'en' ? "Protected number — raise an SOS and request contact to connect" : "محفوظ نمبر — رابطے کے لیے SOS درج کریں"}
                            className="flex-1 sm:flex-initial py-2 px-3.5 rounded-xl text-xs font-bold leading-none bg-rose-50 text-rose-700 border border-[var(--blood)]/20 transition duration-300 flex items-center justify-center gap-1.5 cursor-pointer font-sans"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>
                              {copiedId === donor.id 
                                ? (lang === 'en' ? 'Use SOS to connect' : 'SOS کے ذریعے رابطہ کریں') 
                                : donor.phone}
                            </span>
                          </button>
                        </div>

                      </div>
                    </div>

                    {/* Testimonials drawer */}
                    {expandedDonorReviews === donor.id && (
                      <div className="border-t border-slate-100 pt-3 mt-1 space-y-3">
                        <div className="flex items-center justify-between">
                          <h5 className="font-semibold text-xs text-[var(--ink)] tracking-wide font-sans flex items-center gap-1.5 uppercase">
                            <MessageSquare className="w-3.5 h-3.5 text-[var(--blood)]" />
                            {lang === 'en' ? `Patient testimonials for ${donor.name}` : `مریضوں کی آراء برائے ${donor.name}`}
                          </h5>
                          {avgRating && (
                            <div className="text-[10px] font-bold text-[var(--warn)] bg-[var(--warn)]/10 px-2 py-0.5 rounded border border-[var(--warn)]/30/60 font-mono">
                              ⭐ {avgRating} / 5.0 Rating
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Left: Testimonials List */}
                          <div className="space-y-2 max-h-[190px] overflow-y-auto scrollbar-thin pr-1">
                            {reviews.length === 0 ? (
                              <div className="text-center py-6 bg-[var(--surface)] border border-[var(--border)] border-dashed rounded-xl">
                                <Sparkles className="w-5 h-5 text-slate-350 mx-auto mb-1" />
                                <p className="text-[10px] text-[var(--muted)] font-sans">
                                  {lang === 'en' ? 'No patient ratings yet.' : 'کوئی رائے تاحال درج نہیں کی گئی۔'}
                                </p>
                                <p className="text-[9px] text-[var(--muted)] mt-0.5 font-sans">
                                  {lang === 'en' ? 'Interact first to leave a 1-5 star review!' : 'عطیہ دہندہ کے ساتھ تعاون کے بعد اس فیڈ بیک کو بھریں!'}
                                </p>
                              </div>
                            ) : (
                              reviews.map((rev) => (
                                <div key={rev.id} className="p-2.5 rounded-lg bg-[var(--surface)]/55 border border-[var(--border)] text-[11px]">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="font-bold text-slate-800 font-sans">{rev.patientName}</span>
                                    <div className="text-amber-550 flex items-center text-[9px] font-mono">
                                      {"★".repeat(rev.rating)}{"☆".repeat(5 - rev.rating)}
                                      <span className="text-[var(--muted)] font-normal ml-1.5">{rev.date}</span>
                                    </div>
                                  </div>
                                  <p className="text-[var(--muted)] italic leading-relaxed">
                                    "{rev.comment}"
                                  </p>
                                </div>
                              ))
                            )}
                          </div>

                          {/* Right: Write testimonial form */}
                          <div className="p-3 rounded-xl bg-[var(--surface)]/70 border border-[var(--border)] relative text-xs">
                            <h6 className="font-bold text-[10px] uppercase tracking-wider text-slate-705 mb-2">
                              {lang === 'en' ? 'Add rating & testimonial' : 'رائے اور ریٹنگ شامل کریں'}
                            </h6>

                            {reviewError && (
                              <p className="p-1.5 mb-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-[10px] font-semibold leading-tight">
                                ⚠️ {reviewError}
                              </p>
                            )}

                            {reviewSuccess ? (
                              <div className="absolute inset-0 bg-[var(--safe)]/8/95 flex flex-col items-center justify-center p-3 rounded-xl text-center border border-emerald-250">
                                <CheckCircle className="w-7 h-7 text-[var(--safe)] mb-1.5 animate-bounce" />
                                <p className="text-[11px] font-bold text-emerald-800">{reviewSuccess}</p>
                                <button
                                  onClick={() => setReviewSuccess(null)}
                                  className="mt-2.5 px-3 py-1 bg-[var(--card)] border border-emerald-250 hover:bg-[var(--safe)]/8 text-[var(--safe)] text-[10px] font-bold rounded-lg transition cursor-pointer"
                                >
                                  Okay
                                </button>
                              </div>
                            ) : (
                              <form 
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  handleReviewSubmit(donor.id);
                                }} 
                                className="space-y-2"
                              >
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[8px] uppercase tracking-wide text-[var(--muted)] font-bold mb-0.5">
                                      {lang === 'en' ? 'Patient / Attendant' : 'مریض یا نگران'}
                                    </label>
                                    <input
                                      type="text"
                                      required
                                      value={patientName}
                                      onChange={(e) => setPatientName(e.target.value)}
                                      placeholder={lang === 'en' ? "Zainab Bibi" : "مثال: زینب بی بی"}
                                      className="w-full px-2 py-1 text-xs rounded-md border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:ring-1 focus:ring-[var(--blood)] font-sans"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[8px] uppercase tracking-wide text-[var(--muted)] font-bold mb-0.5">
                                      {lang === 'en' ? 'Rating' : 'سٹارز ریٹنگ'}
                                    </label>
                                    <div className="flex gap-0.5 items-center mt-0.5">
                                      {[1, 2, 3, 4, 5].map((num) => (
                                        <button
                                          type="button"
                                          key={num}
                                          onClick={() => setRating(num)}
                                          className="transition hover:scale-110 cursor-pointer"
                                        >
                                          <Star 
                                            className={`w-3.5 h-3.5 ${
                                              num <= rating 
                                                ? 'text-amber-500 fill-amber-500' 
                                                : 'text-slate-300'
                                            }`}
                                          />
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[8px] uppercase tracking-wide text-slate-505 font-bold mb-0.5">
                                    {lang === 'en' ? 'Testimonial / Comment' : 'مختصر تجربہ'}
                                  </label>
                                  <textarea
                                    required
                                    rows={2}
                                    maxLength={160}
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder={lang === 'en' ? "Prompt response, reached quickly..." : "فوری رابطہ کیا اور بہت مدد کی۔"}
                                    className="w-full px-2 py-1 text-xs rounded-md border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:ring-1 focus:ring-[var(--blood)] resize-none font-sans"
                                  />
                                </div>

                                <button
                                  type="submit"
                                  disabled={isSubmittingReview}
                                  className="w-full py-1.5 rounded-lg bg-[var(--blood)] hover:brightness-110 disabled:opacity-50 text-white font-bold text-xs transition flex items-center justify-center gap-1 cursor-pointer font-sans shadow-sm"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>
                                    {isSubmittingReview 
                                      ? '...' 
                                      : (lang === 'en' ? 'Submit Feedback' : 'رائے جمع کریں')}
                                  </span>
                                </button>
                              </form>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* VOLUNTEER REGISTRATION FORM */
        <div className="p-1 text-xs">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-5 h-5 text-rose-655" />
            <div>
              <h4 className="font-bold text-sm text-slate-850 font-sans">
                {lang === 'en' ? 'Save Lives in Rawalpindi & Islamabad' : 'جڑواں شہروں میں انسانیت کی خدمت کریں'}
              </h4>
              <p className="text-[11px] text-[var(--muted)] font-sans mt-0.5">
                {lang === 'en' ? 'Join over 600 verified local blood donors available for emergencies' : 'ہنگامی حالات کے لیے راولپنڈی اور اسلام آباد کے عطیہ دہندگان میں شامل ہوں'}
              </p>
            </div>
          </div>

          {registerError && (
            <div className="p-3 mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl font-medium">
              ⚠️ {registerError}
            </div>
          )}

          {registerSuccess ? (
            <div className="p-5 bg-[var(--safe)]/8/70 border border-[var(--safe)]/30 rounded-2xl text-center space-y-3">
              <CheckCircle className="w-10 h-10 text-emerald-605 mx-auto animate-bounce" />
              <h5 className="font-bold text-emerald-900 text-sm">
                {lang === 'en' ? 'Welcome to Savior Network!' : 'رضاکار نیٹ ورک میں خوش آمدید!'}
              </h5>
              <p className="text-xs text-[var(--muted)] leading-relaxed max-w-md mx-auto">
                {registerSuccess}
              </p>
              <p className="text-[11px] text-[var(--safe)] font-semibold font-sans">
                ✅ {lang === 'en' ? "Phone verified — your profile now carries the trusted badge, and you're logged in on this device." : "فون تصدیق شدہ — اب آپ کے پروفائل پر تصدیقی بیج موجود ہے۔"}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setRegisterSuccess(null);
                    setOtpStage('idle');
                    setDevOtpHint(null);
                    changeTab('search');
                  }}
                  className="px-4 py-2 bg-[var(--blood)] hover:brightness-110 text-white font-bold rounded-xl transition shadow-sm cursor-pointer font-sans"
                >
                  {lang === 'en' ? 'View Live Savior List' : 'لائیو فہرست دیکھیں'}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleRegisterVolunteer} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Full Name */}
                <div>
                  <label className="block text-[var(--muted)] font-bold tracking-wide text-[10px] uppercase mb-1.5">
                    {lang === 'en' ? 'Full Name' : 'عطیہ دہندہ کا نام'} <span className="text-red-505">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder={lang === 'en' ? "e.g., Haris Mahmood" : "مثال: حارث محمود"}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:ring-1 focus:ring-[var(--blood)] font-sans"
                  />
                </div>

                {/* Blood Group Selector */}
                <div>
                  <label className="block text-[var(--muted)] font-bold tracking-wide text-[10px] uppercase mb-1.5">
                    {lang === 'en' ? 'Your Blood Group' : 'آپ کا بلڈ گروپ'} <span className="text-red-505">*</span>
                  </label>
                  <select
                    value={regBlood}
                    onChange={(e) => setRegBlood(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:ring-1 focus:ring-[var(--blood)] font-sans font-semibold text-xs"
                  >
                    {["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"].map(gp => (
                      <option key={gp} value={gp}>{gp}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[var(--muted)] mt-1.5 font-sans">
                    {lang === 'en' ? 'Your blood can help patients with: ' : 'آپ کا خون ان مریضوں کی مدد کر سکتا ہے: '}
                    <span className="font-semibold text-[var(--ink)]">
                      {(DONOR_COMPATIBILITY[regBlood] || []).join(", ")}
                    </span>
                  </p>
                </div>

                {/* Contact phone */}
                <div>
                  <label className="block text-[var(--muted)] font-bold tracking-wide text-[10px] uppercase mb-1.5">
                    {lang === 'en' ? 'Contact Phone (For Patients)' : 'رابطہ نمبر (مریضوں کے لیے)'} <span className="text-red-505">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="+92 333 XXXXXXX"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:ring-1 focus:ring-[var(--blood)] font-mono"
                  />
                </div>

                {/* Twin Cities Switch */}
                <div>
                  <label className="block text-[var(--muted)] font-bold tracking-wide text-[10px] uppercase mb-1.5">
                    {lang === 'en' ? 'Twin Cities Region' : 'علاقہ / شہر'} <span className="text-red-505">*</span>
                  </label>
                  <div className="flex gap-2">
                    {SUPPORTED_CITIES.map(city => (
                      <button
                        type="button"
                        key={city}
                        onClick={() => setRegCity(city)}
                        className={`flex-1 py-2 rounded-xl text-xs font-semibold font-sans transition-all duration-200 cursor-pointer ${
                          regCity === city 
                            ? 'bg-[var(--blood)] text-white shadow shadow-rose-650/30 font-bold' 
                            : 'bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] hover:border-slate-300 hover:text-[var(--ink)]'
                        }`}
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                </div>

              </div>

              {/* Specific Hospital nearby / Area address */}
              <div>
                <label className="block text-[var(--muted)] font-bold tracking-wide text-[10px] uppercase mb-1.5">
                  {lang === 'en' ? 'Specific Sector / Area Location' : 'مخصوص سیکٹر یا علاقہ کی لوکیشن'} <span className="text-red-505">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={regLocation}
                  onChange={(e) => setRegLocation(e.target.value)}
                  placeholder={lang === 'en' ? "e.g., G-10/4, near PIMS Hospital or Satellite Town" : "مثال: جی 10، نزد پمز ہسپتال یا سیٹلائٹ ٹاؤن"}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:ring-1 focus:ring-[var(--blood)] font-sans"
                />
              </div>

              <div className="p-3.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl space-y-2.5">
                <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wide font-sans">
                  {lang === 'en' ? 'Quick Eligibility Check' : 'اہلیت کی مختصر جانچ'}
                </p>
                <label className="flex items-start gap-2 text-[11px] text-[var(--ink)] font-sans cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ageConfirmed}
                    onChange={(e) => setAgeConfirmed(e.target.checked)}
                    className="mt-0.5 accent-rose-600"
                  />
                  <span>
                    {lang === 'en'
                      ? "I am between 18 and 65 years old."
                      : "میری عمر 18 سے 65 سال کے درمیان ہے۔"}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[11px] text-[var(--ink)] font-sans cursor-pointer">
                  <input
                    type="checkbox"
                    checked={healthConfirmed}
                    onChange={(e) => setHealthConfirmed(e.target.checked)}
                    className="mt-0.5 accent-rose-600"
                  />
                  <span>
                    {lang === 'en'
                      ? "I am in generally good health, with no current fever, illness, or recent major surgery."
                      : "میں عمومی طور پر صحت مند ہوں، مجھے بخار، بیماری یا حالیہ بڑا آپریشن نہیں ہوا۔"}
                  </span>
                </label>
              </div>

              <div className="flex items-start gap-2 p-3 bg-red-50/20 border border-red-200/50 rounded-xl">
                <ShieldAlert className="w-5 h-5 text-[var(--blood)] shrink-0 mt-0.5" />
                <label className="flex items-start gap-2 text-[10px] text-[var(--muted)] leading-relaxed font-sans cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentGiven}
                    onChange={(e) => setConsentGiven(e.target.checked)}
                    className="mt-0.5 accent-rose-600 shrink-0"
                  />
                  <span>
                    {lang === 'en' 
                      ? "I consent to my blood type and contact phone being listed so local twin cities hospitals and patient attendants can reach me during a blood crisis."
                      : "میں اس بات پر رضامند ہوں کہ میرا بلڈ گروپ اور فون نمبر لائیو ڈیٹا بیس پر ظاہر کیا جائے تاکہ مریض کے لواحقین ہنگامی حالت میں مجھ سے رابطہ کر سکیں۔"}
                  </span>
                </label>
              </div>

              {otpStage === 'sent' && (
                <div className="p-3.5 bg-[var(--safe)]/8/60 border border-[var(--safe)]/30 rounded-xl space-y-2">
                  <p className="text-[11px] font-bold text-emerald-800 font-sans">
                    {lang === 'en' ? `Verification code sent to ${regPhone}. Enter it below to create your verified profile.` : `تصدیقی کوڈ ${regPhone} پر بھیج دیا گیا ہے۔`}
                  </p>
                  {devOtpHint && (
                    <p className="text-[10px] text-[var(--warn)] bg-[var(--warn)]/10 border border-[var(--warn)]/30 rounded-lg px-2 py-1 font-mono">
                      {lang === 'en' ? 'Test mode — your code:' : 'ٹیسٹ موڈ — آپ کا کوڈ:'} {devOtpHint}
                    </p>
                  )}
                  {otpError && <p className="text-[11px] text-red-600 font-sans">⚠️ {otpError}</p>}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                      placeholder={lang === 'en' ? "6-digit code" : "6 ہندسوں کا کوڈ"}
                      className="flex-1 px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-center tracking-[0.3em] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--safe)]"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyOtp}
                      disabled={otpBusy || otpCode.length !== 6}
                      className="px-4 py-2 rounded-lg bg-[var(--safe)] hover:brightness-110 disabled:opacity-50 text-white font-bold text-[11px] transition font-sans"
                    >
                      {otpBusy
                        ? (lang === 'en' ? 'Verifying...' : 'تصدیق ہو رہی ہے...')
                        : (lang === 'en' ? 'Verify & Create' : 'تصدیق کریں')}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isRegistering}
                className="w-full py-3 rounded-xl bg-[var(--blood)] hover:brightness-110 disabled:opacity-50 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer font-sans shadow-md"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>
                  {isRegistering 
                    ? (lang === 'en' ? 'Sending code...' : 'کوڈ بھیجا جا رہا ہے...') 
                    : otpStage === 'sent'
                      ? (lang === 'en' ? 'Resend Verification Code' : 'کوڈ دوبارہ بھیجیں')
                      : (lang === 'en' ? 'Submit & Get Verification Code' : 'فارم جمع کریں اور کوڈ حاصل کریں')}
                </span>
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
