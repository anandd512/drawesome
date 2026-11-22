import { api, ApiError, cloudEnabled, setUnauthorizedHandler } from "./api";
import { beginOidc, OidcAttempt, OidcProvider, OidcToken, takeRedirectResult } from "./oidc";
import { AuthConfig, clearSession, CloudUser, closeSignIn, setSession, useAuth } from "./session";
import { clearTombstones, resetSyncState, startSyncTriggers, syncNow } from "./sync";
import { useStore } from "../../store";

interface SessionResponse {
  token: string;
  user: CloudUser;
}

/** Fetches which sign-in options the backend offers. Safe to call again to retry. */
export async function loadAuthConfig(): Promise<void> {
  useAuth.setState({ configError: null });
  try {
    const config = await api<AuthConfig>("/auth/config", { auth: false });
    useAuth.setState({ config });
  } catch (err) {
    useAuth.setState({ configError: err instanceof Error ? err.message : "Couldn't load sign-in options." });
  }
}

function signedIn(res: SessionResponse) {
  setSession(res.token, res.user);
  closeSignIn();
  // Anything drawn here before signing in gets saved to the account too.
  void syncNow();
}

let initialized = false;

/** Error from a redirect sign-in, shown once by the sign-in dialog. */
let redirectError: string | null = null;
export function takeRedirectError(): string | null {
  const e = redirectError;
  redirectError = null;
  return e;
}

/** Called once at startup. Does nothing when accounts aren't configured. */
export function initCloud() {
  if (!cloudEnabled || initialized) return;
  initialized = true;

  setUnauthorizedHandler(() => {
    clearSession();
    resetSyncState();
  });
  startSyncTriggers();
  void loadAuthConfig();

  // Finish a sign-in that went through a full-page redirect (popup was blocked).
  let redirect: OidcToken | null = null;
  try {
    redirect = takeRedirectResult();
  } catch (err) {
    useAuth.setState({ signInOpen: true });
    redirectError = err instanceof Error ? err.message : "Sign-in didn't complete.";
  }
  if (redirect) {
    void exchangeOidc(redirect).catch((err) => {
      redirectError = err instanceof Error ? err.message : "Sign-in didn't complete.";
      useAuth.setState({ signInOpen: true });
    });
    return;
  }

  // Returning visitor: refresh the session (sliding expiry), then sync.
  if (useAuth.getState().token) {
    api<{ user: CloudUser; token: string }>("/me")
      .then((res) => {
        setSession(res.token, res.user);
        void syncNow();
      })
      .catch(() => {
        /* 401 already signed out via the handler; offline keeps the session for later */
      });
  }
}

// ---- Email code

export interface CodeSent {
  expiresInMinutes: number;
  resendAfter: number; // seconds
}

export async function startEmailSignIn(email: string): Promise<CodeSent> {
  return api<CodeSent>("/auth/email/start", { method: "POST", body: { email }, auth: false });
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const res = await api<SessionResponse>("/auth/email/verify", { method: "POST", body: { email, code }, auth: false });
  signedIn(res);
}

// ---- Google / Microsoft

async function exchangeOidc(token: OidcToken): Promise<void> {
  const res = await api<SessionResponse>("/auth/oidc", {
    method: "POST",
    body: { provider: token.provider, idToken: token.idToken, nonce: token.nonce },
    auth: false,
  });
  signedIn(res);
}

/** Starts provider sign-in; resolves once signed in. `attempt.cancel()` aborts it. */
export function signInWithProvider(provider: OidcProvider): { attempt: OidcAttempt; done: Promise<void> } {
  const clientId = useAuth.getState().config?.[provider];
  if (!clientId) throw new Error(`${provider === "google" ? "Google" : "Microsoft"} sign-in isn't set up.`);
  const attempt = beginOidc(provider, clientId);
  return { attempt, done: attempt.promise.then(exchangeOidc) };
}

// ---- Signing out and deleting the account

/**
 * Signs out. With `removeLocal`, also clears this browser's scenes, but only after a
 * final sync confirms every one of them is in the account.
 */
export async function signOut(removeLocal: boolean): Promise<void> {
  if (removeLocal) {
    const result = await syncNow();
    if (!result.ok || result.pending > 0) {
      throw new Error(
        "Some drawings in this browser aren't saved to your account yet, so they weren't removed. Check your connection and try again, or keep them on this device."
      );
    }
  } else {
    await syncNow().catch(() => undefined); // best effort; they stay here either way
  }
  clearSession();
  resetSyncState();
  clearTombstones();
  if (removeLocal) useStore.getState().resetScenes();
}

export async function deleteAccount(): Promise<void> {
  await api("/account", { method: "DELETE" });
  clearSession();
  resetSyncState();
  clearTombstones();
}

export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return fallback;
}
