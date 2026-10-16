import { useState, useEffect } from "react";
import { API_BASE } from "../lib/api";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell 
} from "recharts";
import { Activity, ShieldAlert, Award, ActivitySquare, TrendingUp, Users } from "lucide-react";

interface StatsData {
  totals: {
    totalDonors: number;
    activeSOS: number;
    fulfilledSOS: number;
    registeredCamps: number;
  };
  bloodDistribution: { bloodGroup: string; count: number }[];
  hospitalAvailability: { name: string; "In Stock Groups": number; "Critical/Low Groups": number }[];
}

interface StatsDashboardProps {
  lang: 'en' | 'ur';
}

export default function StatsDashboard({ lang }: StatsDashboardProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch(`${API_BASE}/api/stats`);
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (e) {
        console.error("Failed to load statistics dashboard data: ", e);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  if (loading || !stats) {
    return (
      <div className="h-64 flex flex-col items-center justify-center bg-[var(--card)] border border-slate-250 rounded-2xl">
        <div className="w-8 h-8 border-4 border-rose-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-[var(--muted)] mt-2 font-mono">Compiling clinical registry insights...</p>
      </div>
    );
  }

  // Beautiful medical color palette
  const COLORS = ["#f43f5e", "#e11d48", "#be123c", "#9f1239", "#312e81", "#1e1b4b", "#4338ca", "#6366f1"];

  return (
    <div id="stats-dashboard-grid-root" className="space-y-6">
      {/* Visual Quick indicators */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total donors registered */}
        <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-650 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase text-[var(--muted)] font-mono tracking-wider font-semibold">
              {lang === 'en' ? 'Verified Donors' : 'درج شدہ مستقل مہم'}
            </span>
            <span className="block text-xl font-extrabold text-[var(--ink)] mt-0.5">{stats.totals.totalDonors}</span>
          </div>
        </div>

        {/* Live Active SOS */}
        <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-red-50 text-red-650 flex items-center justify-center animate-pulse shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase text-[var(--muted)] font-mono tracking-wider font-semibold">
              {lang === 'en' ? 'Active SOS Request' : 'ایس او ایس ایمرجنسی'}
            </span>
            <span className="block text-xl font-extrabold text-red-650 mt-0.5">{stats.totals.activeSOS}</span>
          </div>
        </div>

        {/* Fulfilled requests */}
        <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-[var(--safe)] flex items-center justify-center shrink-0">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase text-[var(--muted)] font-mono tracking-wider font-semibold">
              {lang === 'en' ? 'Urgent Saved Lives' : 'بچائی گئی زندگیاں'}
            </span>
            <span className="block text-xl font-extrabold text-[var(--safe)] mt-0.5">{stats.totals.fulfilledSOS}</span>
          </div>
        </div>

        {/* Donation Drive Camps */}
        <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <ActivitySquare className="w-5 h-5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase text-[var(--muted)] font-mono tracking-wider font-semibold">
              {lang === 'en' ? 'Ongoing Drives' : 'فعال بلڈ کیمپ'}
            </span>
            <span className="block text-xl font-extrabold text-amber-600 mt-0.5">{stats.totals.registeredCamps}</span>
          </div>
        </div>
      </div>

      {/* Visual Charts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pie Chart: Donor Blood Distribution */}
        <div className="p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-sm">
          <h4 className="text-sm font-bold text-[var(--ink)] font-sans mb-4 flex items-center gap-2">
            <TrendingUp className="w-4.5 h-4.5 text-[var(--blood)]" />
            {lang === 'en' ? 'Twin Cities Donor Blood Type Mix' : 'خون کے گروپوں کی شرح تقسیم'}
          </h4>
          <div className="h-56 w-full flex items-center justify-center">
            {stats.bloodDistribution.length === 0 ? (
              <p className="text-xs text-[var(--muted)] font-mono">No data initialized</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.bloodDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="count"
                    nameKey="bloodGroup"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  >
                    {stats.bloodDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0", borderRadius: "10px", color: "#0f172a" }} 
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bar Chart: Hospital Stock Levels status */}
        <div className="p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-sm">
          <h4 className="text-sm font-bold text-[var(--ink)] font-sans mb-4 flex items-center gap-2">
            <Activity className="w-4.5 h-4.5 text-[var(--blood)]" />
            {lang === 'en' ? 'Hospital Blood Banks Stocks Status' : 'راولپنڈی و اسلام آباد ہسپتال بلڈ سٹاک لسٹ'}
          </h4>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.hospitalAvailability}
                margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={10} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e2e8f0", borderRadius: "10px", color: "#0f172a" }} 
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: "10px" }} />
                <Bar dataKey="In Stock Groups" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Critical/Low Groups" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
