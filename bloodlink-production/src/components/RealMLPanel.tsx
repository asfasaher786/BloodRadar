import { useState, useEffect } from "react";
import { API_BASE } from "../lib/api";
import { Brain, RefreshCw, MapPin } from "lucide-react";

interface ModelStatus {
  totalRealRequests: number;
  labeledExamples: number;
  isTrained: boolean;
  classes: string[];
  minRequired: number;
}

export default function RealMLPanel() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [testText, setTestText] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [clustering, setClustering] = useState<any>(null);

  const loadStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ml/real-status`);
      if (res.ok) setStatus(await res.json());
    } catch (e) { console.error(e); }
  };

  const loadClustering = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ml/real-donor-clustering?k=3`);
      if (res.ok) setClustering(await res.json());
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    loadStatus();
    loadClustering();
  }, []);

  const handleClassify = async () => {
    if (!testText.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/ml/real-classify-urgency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testText })
      });
      setResult(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h2 className="text-2xl font-black text-[var(--ink)] tracking-tight flex items-center gap-2">
          <Brain className="text-[var(--blood)] w-7 h-7" />
          Real ML Lab
        </h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          Trained live on this platform's real database — not synthetic data. Predictions are honestly withheld until there's enough real data to trust.
        </p>
      </div>

      {/* Model status */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-[var(--ink)] text-sm">
            Urgency Classifier — Live Training Status
          </h3>
          <button onClick={loadStatus} className="text-[var(--muted)] hover:text-[var(--ink)] transition" aria-label="Refresh model status">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {status ? (
          <div className="space-y-2 text-xs font-sans">
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Real emergency requests in database</span>
              <span className="font-bold text-[var(--ink)]">{status.totalRealRequests}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Usable labeled examples</span>
              <span className="font-bold text-[var(--ink)]">{status.labeledExamples} / {status.minRequired} needed</span>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${status.isTrained ? 'bg-emerald-500' : 'bg-amber-400'}`}
                style={{ width: `${Math.min(100, (status.labeledExamples / status.minRequired) * 100)}%` }}
              />
            </div>
            <p className={`text-xs font-semibold mt-2 ${status.isTrained ? 'text-[var(--safe)]' : 'text-[var(--warn)]'}`}>
              {status.isTrained
                ? 'Trained on real data — predictions available below.'
                : `Not enough real data yet. Needs ${status.minRequired - status.labeledExamples} more real requests before predictions can be trusted.`}
            </p>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">Loading...</p>
        )}
      </div>

      {/* Test the classifier */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
        <h3 className="font-bold text-[var(--ink)] text-sm mb-3">
          Test It
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            aria-label="Emergency message to classify"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="e.g. major surgery scheduled tomorrow, needs platelets"
            className="flex-1 px-3 py-2 text-xs rounded-xl border border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--blood)]"
          />
          <button
            onClick={handleClassify}
            disabled={loading || !testText.trim()}
            className="px-4 py-2 bg-[var(--blood)] hover:brightness-110 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition"
          >
            {loading ? '...' : 'Classify'}
          </button>
        </div>
        {result && (
          <div className="mt-3 p-3 bg-[var(--surface)] rounded-xl text-xs">
            {result.trained ? (
              <>
                <span className="font-bold text-[var(--ink)]">{result.predictedClass}</span>
                <span className="text-[var(--muted)]"> ({(result.confidence * 100).toFixed(1)}% confidence)</span>
              </>
            ) : (
              <span className="text-[var(--warn)]">
                Not enough real data to classify yet ({result.status?.labeledExamples || 0}/{result.status?.minRequired || 15} examples).
              </span>
            )}
          </div>
        )}
      </div>

      {/* Real donor clustering */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
        <h3 className="font-bold text-[var(--ink)] text-sm mb-3 flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-[var(--blood)]" />
          Real Donor Clusters (for camp planning)
        </h3>
        {clustering ? (
          <div className="text-xs text-[var(--muted)] space-y-2">
            <p>Based on {clustering.realDonorCount} real registered donors.</p>
            {clustering.centroids?.map((c: any, i: number) => (
              <div key={i} className="flex justify-between p-2 bg-[var(--surface)] rounded-lg">
                <span>{c.label}</span>
                <span className="font-mono">{c.count} donors nearby</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">Loading...</p>
        )}
      </div>
    </div>
  );
}
