import { useEffect, useRef, useState } from "react";
import { closeSignIn, useAuth } from "../lib/cloud/session";
import {
  errorMessage,
  loadAuthConfig,
  signInWithProvider,
  startEmailSignIn,
  takeRedirectError,
  verifyEmailCode,
} from "../lib/cloud/auth";
import { OidcCancelled, type OidcAttempt, type OidcProvider } from "../lib/cloud/oidc";

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

const PROVIDER_LABEL: Record<OidcProvider, string> = { google: "Google", microsoft: "Microsoft" };

type Step = "choose" | "code" | "waiting";

export default function SignInDialog() {
  const config = useAuth((s) => s.config);
  const configError = useAuth((s) => s.configError);

  const [step, setStep] = useState<Step>("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => takeRedirectError());
  const [waitingFor, setWaitingFor] = useState<OidcProvider | null>(null);
  const attemptRef = useRef<OidcAttempt | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  // Abandon a pending popup if the dialog goes away.
  useEffect(() => () => attemptRef.current?.cancel(), []);

  const close = () => {
    attemptRef.current?.cancel();
    closeSignIn();
  };

  const sendCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await startEmailSignIn(email.trim());
      setMinutes(res.expiresInMinutes);
      setResendIn(res.resendAfter);
      setCode("");
      setStep("code");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmailCode(email.trim(), value);
      // Success closes the dialog (see signedIn in lib/cloud/auth.ts).
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const withProvider = async (provider: OidcProvider) => {
    setError(null);
    try {
      const { attempt, done } = signInWithProvider(provider);
      if (attempt.redirecting) return; // the tab is leaving for the provider's page
      attemptRef.current = attempt;
      setWaitingFor(provider);
      setStep("waiting");
      await done;
    } catch (err) {
      if (!(err instanceof OidcCancelled)) setError(errorMessage(err));
      setStep("choose");
    } finally {
      attemptRef.current = null;
      setWaitingFor(null);
    }
  };

  const providers = (["google", "microsoft"] as const).filter((p) => config?.[p]);
  const btnProvider =
    "flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
  const btnPrimary =
    "w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40";
  const input =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
      // Keep canvas shortcuts (Delete, tool keys…) from firing behind the dialog.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !busy) close();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="signin-title" className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <button
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
        >
          ✕
        </button>

        {step === "choose" && (
          <>
            <h2 id="signin-title" className="text-lg font-semibold text-gray-900">
              Sign in to Drawesome
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-600">
              Save your drawings to your account and open them on any device. No password needed.
            </p>

            {!config && !configError && <p className="mt-6 text-sm text-gray-500">Loading sign-in options…</p>}
            {!config && configError && (
              <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {configError}{" "}
                <button className="font-medium underline" onClick={() => void loadAuthConfig()}>
                  Try again
                </button>
              </div>
            )}

            {config && (
              <div className="mt-6 space-y-3">
                {providers.map((p) => (
                  <button key={p} className={btnProvider} disabled={busy} onClick={() => void withProvider(p)}>
                    {p === "google" ? <GoogleLogo /> : <MicrosoftLogo />}
                    Continue with {PROVIDER_LABEL[p]}
                  </button>
                ))}

                {config.email && (
                  <>
                    {providers.length > 0 && (
                      <div className="flex items-center gap-3 py-1 text-xs text-gray-400">
                        <div className="h-px flex-1 bg-gray-200" />
                        or
                        <div className="h-px flex-1 bg-gray-200" />
                      </div>
                    )}
                    <form onSubmit={sendCode} className="space-y-3">
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-medium text-gray-700">Email</span>
                        <input
                          type="email"
                          required
                          autoComplete="email"
                          autoFocus={providers.length === 0}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          className={input}
                        />
                      </label>
                      <button type="submit" className={btnPrimary} disabled={busy || !email.trim()}>
                        {busy ? "Sending…" : "Email me a sign-in code"}
                      </button>
                    </form>
                  </>
                )}

                {!config.email && providers.length === 0 && (
                  <p className="text-sm text-gray-500">Sign-in isn't available right now.</p>
                )}
              </div>
            )}

            {error && (
              <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <p className="mt-5 text-xs leading-5 text-gray-500">
              Drawings already in this browser are saved to your account when you sign in.
            </p>
          </>
        )}

        {step === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <h2 id="signin-title" className="text-lg font-semibold text-gray-900">
              Check your email
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-600">
              We sent a 6-digit code to <span className="font-medium text-gray-900">{email.trim()}</span>. It expires in{" "}
              {minutes} minutes.
            </p>
            <label className="mt-6 block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">Sign-in code</span>
              <input
                ref={codeRef}
                value={code}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(digits);
                  if (digits.length === 6) void verify(digits);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                aria-describedby="code-help"
                className={`${input} text-center font-mono text-2xl tracking-[0.5em]`}
              />
            </label>
            <button type="submit" className={`${btnPrimary} mt-4`} disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            {error && (
              <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div id="code-help" className="mt-5 flex items-center justify-between text-sm">
              <button
                type="button"
                className="font-medium text-gray-600 hover:text-gray-900"
                onClick={() => {
                  setStep("choose");
                  setError(null);
                }}
              >
                ← Use a different email
              </button>
              <button
                type="button"
                className="font-medium text-indigo-600 hover:text-indigo-800 disabled:cursor-not-allowed disabled:text-gray-400"
                disabled={busy || resendIn > 0}
                onClick={() => void sendCode()}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </button>
            </div>
            <p className="mt-4 text-xs leading-5 text-gray-500">Can't find it? Check your spam or junk folder.</p>
          </form>
        )}

        {step === "waiting" && waitingFor && (
          <div className="py-2">
            <h2 id="signin-title" className="text-lg font-semibold text-gray-900">
              Continue in the {PROVIDER_LABEL[waitingFor]} window
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-600">
              Pick your account in the window that just opened. This page updates once you're signed in.
            </p>
            <div className="mt-6 flex items-center gap-3 text-sm text-gray-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
              Waiting for {PROVIDER_LABEL[waitingFor]}…
            </div>
            <button
              className="mt-6 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
              onClick={() => attemptRef.current?.cancel()}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
