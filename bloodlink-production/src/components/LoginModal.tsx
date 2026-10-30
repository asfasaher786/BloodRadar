import { useState, useEffect } from "react";
import { API_BASE } from "../lib/api";
import Modal from "./ui/Modal";
import Input from "./ui/Input";
import Button from "./ui/Button";
import { ShieldCheck, PhoneCall } from "lucide-react";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onLoggedIn: () => void;
}

/**
 * One door for returning users: phone → OTP → done. Donors without a
 * profile yet land logged-in with an empty identity (they can then use
 * "Register As Savior" to create the profile), admins/org staff resolve
 * their roles server-side from the verified phone.
 */
export default function LoginModal({ open, onClose, onLoggedIn }: LoginModalProps) {
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [devOtp, setDevOtp] = useState("");

  // Fresh state every time the modal opens.
  useEffect(() => {
    if (open) {
      setStage("phone");
      setPhone("");
      setCode("");
      setBusy(false);
      setError("");
      setDevOtp("");
    }
  }, [open]);

  const sendCode = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (res.ok) {
        setStage("code");
        setDevOtp(data.devOtp || "");
      } else {
        setError(data.error || "Couldn't send the code. Try again.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.trim().length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: code.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        onLoggedIn();
        onClose();
      } else {
        setError(data.error || "Incorrect code. Try again.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log in" size="sm">
      <div id="login-modal" className="space-y-4">
        <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
          Enter your phone number — we'll send a 6-digit code to verify it's
          really you. Already a donor? You'll be logged straight back into
          your profile.
        </p>

        {stage === "phone" ? (
          <Input
            id="login-phone"
            label="Phone number"
            placeholder="+92 333 XXXXXXX"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            icon={<PhoneCall className="w-4 h-4" />}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
          />
        ) : (
          <Input
            id="login-code"
            label="Verification code"
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            icon={<ShieldCheck className="w-4 h-4" />}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.trim().length === 6) verify();
            }}
            disabled={busy}
            hint={devOtp ? `Test mode — your code is ${devOtp}` : undefined}
          />
        )}

        {error && (
          <p role="alert" className="text-xs font-medium" style={{ color: "var(--blood-ink)" }}>
            {error}
          </p>
        )}

        {stage === "phone" ? (
          <Button
            size="md"
            fullWidth
            loading={busy}
            disabled={phone.trim().length < 7}
            icon={<PhoneCall className="w-4 h-4" />}
            onClick={sendCode}
          >
            Send verification code
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              size="md"
              fullWidth
              loading={busy}
              disabled={code.trim().length !== 6}
              icon={<ShieldCheck className="w-4 h-4" />}
              onClick={verify}
            >
              Verify &amp; log in
            </Button>
            <Button variant="ghost" size="md" fullWidth onClick={() => { setStage("phone"); setError(""); setDevOtp(""); }}>
              Change number
            </Button>
          </div>
        )}

        <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
          New here? Close this and use <strong>Find donors → Register As Savior</strong> to
          join the registry.
        </p>
      </div>
    </Modal>
  );
}
