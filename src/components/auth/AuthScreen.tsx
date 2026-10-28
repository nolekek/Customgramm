import React, { useState, useEffect } from "react";
import QRCode from "qrcode";
import { useTelegramStore } from "../../store/telegramStore";
import { telegram } from "../../services/telegram";
import { Phone, KeyRound, Lock, ArrowRight, RefreshCw, AlertCircle } from "lucide-react";

export const AuthScreen: React.FC = () => {
  const { authState, qrLink, authError, setAuthError } = useTelegramStore();
  const [authMode, setAuthMode] = useState<"qr" | "phone">("qr");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Form states
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (qrLink) {
      QRCode.toDataURL(qrLink, {
        width: 240,
        margin: 2,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error("QR Code generation error:", err));
    }
  }, [qrLink]);

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setIsLoading(true);
    setAuthError(null);
    try {
      await telegram.setAuthenticationPhoneNumber(phone.trim());
    } catch (err: any) {
      setAuthError(err.message || "Failed to submit phone number");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setIsLoading(true);
    setAuthError(null);
    try {
      await telegram.checkAuthenticationCode(code.trim());
    } catch (err: any) {
      setAuthError(err.message || "Invalid verification code");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setIsLoading(true);
    setAuthError(null);
    try {
      await telegram.checkAuthenticationPassword(password.trim());
    } catch (err: any) {
      setAuthError(err.message || "Invalid 2FA password");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshQr = async () => {
    setAuthError(null);
    try {
      await telegram.requestQrCode();
    } catch (err: any) {
      setAuthError(err.message || "Failed to request QR code");
    }
  };

  return (
    <div
      data-role="auth-screen"
      className="flex-1 flex flex-col items-center justify-center p-6 bg-[var(--bg-primary)] text-[var(--text-primary)]"
    >
      <div className="w-full max-w-md p-8 rounded-[var(--radius-card)] bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-2xl flex flex-col items-center text-center">
        {/* Brand Header */}
        <div className="w-14 h-14 rounded-2xl bg-[var(--accent-primary)] flex items-center justify-center text-2xl font-bold text-white mb-4 shadow-lg shadow-sky-500/20">
          C
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Customgramm</h1>
        <p className="text-xs text-[var(--text-secondary)] mb-6">
          The ultimate customizable Telegram client
        </p>

        {authError && (
          <div className="w-full mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2 text-left">
            <AlertCircle size={14} className="shrink-0" />
            <span>{authError}</span>
          </div>
        )}

        {/* Mode: QR Code Authentication */}
        {authMode === "qr" &&
          authState !== "WaitCode" &&
          authState !== "WaitPassword" && (
            <div className="flex flex-col items-center w-full">
              <div className="p-3 bg-white rounded-xl shadow-inner mb-4 flex items-center justify-center min-h-[240px] min-w-[240px]">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Telegram Login QR" className="w-60 h-60 rounded-lg" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-slate-500 text-xs">
                    <RefreshCw className="animate-spin text-sky-500" size={24} />
                    <span>Connecting to Telegram...</span>
                    <button
                      type="button"
                      onClick={handleRefreshQr}
                      className="mt-2 text-[11px] text-sky-600 hover:underline"
                    >
                      Click to refresh QR
                    </button>
                  </div>
                )}
              </div>

              <div className="text-xs text-[var(--text-secondary)] space-y-1 mb-6 text-left w-full px-2">
                <p className="font-semibold text-[var(--text-primary)] mb-1">Quick login with Telegram:</p>
                <p>1. Open Telegram on your phone</p>
                <p>2. Go to <b>Settings &rarr; Devices &rarr; Link Desktop Device</b></p>
                <p>3. Point your camera at this screen to confirm</p>
              </div>

              <button
                type="button"
                onClick={() => setAuthMode("phone")}
                className="text-xs text-[var(--accent-primary)] hover:underline flex items-center gap-1.5 transition-colors"
              >
                <Phone size={13} />
                <span>Or log in with phone number</span>
              </button>
            </div>
          )}

        {/* Mode: Phone Number Input */}
        {authMode === "phone" &&
          authState !== "WaitCode" &&
          authState !== "WaitPassword" && (
            <form onSubmit={handlePhoneSubmit} className="w-full flex flex-col gap-4">
              <div className="text-left">
                <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
                  Phone Number
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 234 567 8900"
                    autoFocus
                    required
                    className="w-full px-3.5 py-2.5 rounded-[var(--radius-input)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
                  />
                  <Phone size={16} className="absolute right-3 top-3 text-[var(--text-muted)]" />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 rounded-[var(--radius-input)] bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20"
              >
                {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <span>Continue</span>}
                <ArrowRight size={16} />
              </button>

              <button
                type="button"
                onClick={() => setAuthMode("qr")}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                Back to QR Code
              </button>
            </form>
          )}

        {/* Mode: Verification Code Input */}
        {authState === "WaitCode" && (
          <form onSubmit={handleCodeSubmit} className="w-full flex flex-col gap-4">
            <div className="text-left">
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
                Verification Code
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter code from Telegram"
                  autoFocus
                  required
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-input)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm tracking-widest text-center focus:outline-none focus:border-[var(--accent-primary)]"
                />
                <KeyRound size={16} className="absolute right-3 top-3 text-[var(--text-muted)]" />
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                Check your other Telegram sessions or SMS for the login code.
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-[var(--radius-input)] bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <span>Verify Code</span>}
              <ArrowRight size={16} />
            </button>
          </form>
        )}

        {/* Mode: 2FA Cloud Password Input */}
        {authState === "WaitPassword" && (
          <form onSubmit={handlePasswordSubmit} className="w-full flex flex-col gap-4">
            <div className="text-left">
              <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">
                2FA Cloud Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your 2FA password"
                  autoFocus
                  required
                  className="w-full px-3.5 py-2.5 rounded-[var(--radius-input)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-primary)]"
                />
                <Lock size={16} className="absolute right-3 top-3 text-[var(--text-muted)]" />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-[var(--radius-input)] bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <span>Submit Password</span>}
              <ArrowRight size={16} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
