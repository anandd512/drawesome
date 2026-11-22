/**
 * "Continue with Google / Microsoft" without a client secret: a standard OpenID Connect
 * implicit request for an ID token (response_type=id_token) with a random nonce and
 * state. The backend verifies the token's signature, audience, issuer and nonce.
 *
 * The provider page opens in a popup so the canvas (and undo history) stays put. It
 * redirects back to public/auth-callback.html, which hands the result over through
 * localStorage (the popup can lose `window.opener` to the provider's
 * Cross-Origin-Opener-Policy, but storage events always reach same-origin tabs). If
 * the popup is blocked, the whole tab goes to the provider and comes back instead;
 * auto-save already holds the scene, and takeRedirectResult() finishes on reload.
 */
export type OidcProvider = "google" | "microsoft";

const PENDING_KEY = "drawesome:oidc:pending";
const RESULT_KEY = "drawesome:oidc:result";
const MAX_WAIT_MS = 10 * 60_000;

interface Pending {
  provider: OidcProvider;
  state: string;
  nonce: string;
  mode: "popup" | "redirect";
  createdAt: number;
}

interface CallbackResult {
  state?: string;
  idToken?: string;
  error?: string;
}

export interface OidcToken {
  provider: OidcProvider;
  idToken: string;
  nonce: string;
}

export class OidcCancelled extends Error {
  constructor() {
    super("Sign-in was cancelled.");
  }
}

function randomString(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Where the app lives, e.g. https://anandd512.github.io/drawesome/ */
export function appRootUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/** Must be registered exactly as-is with Google and Microsoft. */
export function redirectUri(): string {
  return new URL("auth-callback.html", appRootUrl()).href;
}

function authorizeUrl(provider: OidcProvider, clientId: string, state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "id_token",
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });
  if (provider === "microsoft") params.set("response_mode", "fragment");
  const base =
    provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
  return `${base}?${params.toString()}`;
}

function friendlyError(code: string | undefined): Error {
  if (code === "access_denied" || code === "user_cancelled") return new OidcCancelled();
  return new Error("Sign-in didn't complete. Please try again.");
}

function settle(pending: Pending, result: CallbackResult): OidcToken {
  if (!result.state || result.state !== pending.state) {
    throw new Error("Sign-in could not be verified. Please try again.");
  }
  if (result.error || !result.idToken) throw friendlyError(result.error);
  return { provider: pending.provider, idToken: result.idToken, nonce: pending.nonce };
}

export interface OidcAttempt {
  /** Resolves with the ID token, or never settles if the tab is redirecting away. */
  promise: Promise<OidcToken>;
  cancel: () => void;
  redirecting: boolean;
}

export function beginOidc(provider: OidcProvider, clientId: string): OidcAttempt {
  const pending: Pending = {
    provider,
    state: randomString(16),
    nonce: randomString(32),
    mode: "popup",
    createdAt: Date.now(),
  };
  localStorage.removeItem(RESULT_KEY);
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = authorizeUrl(provider, clientId, pending.state, pending.nonce);

  const width = 480;
  const height = 640;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open(url, "drawesome-signin", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);

  if (!popup) {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, mode: "redirect" }));
    window.location.assign(url);
    return { promise: new Promise<OidcToken>(() => {}), cancel: () => {}, redirecting: true };
  }

  let cleanup = () => {};
  const attempt: OidcAttempt = { promise: Promise.resolve() as unknown as Promise<OidcToken>, cancel: () => {}, redirecting: false };
  // The executor runs synchronously, so `attempt` must exist before this line.
  attempt.promise = new Promise<OidcToken>((resolve, reject) => {
    const finish = (fn: () => void) => {
      cleanup();
      localStorage.removeItem(PENDING_KEY);
      localStorage.removeItem(RESULT_KEY);
      fn();
    };
    const check = () => {
      const result = readJson<CallbackResult>(RESULT_KEY);
      if (!result) return;
      try {
        const token = settle(pending, result);
        finish(() => resolve(token));
      } catch (err) {
        finish(() => reject(err));
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === RESULT_KEY && e.newValue) check();
    };
    window.addEventListener("storage", onStorage);
    // Belt and braces for browsers that are slow to fire storage events across windows.
    const poll = window.setInterval(check, 1000);
    const timeout = window.setTimeout(() => finish(() => reject(new OidcCancelled())), MAX_WAIT_MS);
    cleanup = () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(poll);
      window.clearTimeout(timeout);
    };
    attempt.cancel = () => {
      try {
        popup.close();
      } catch {
        /* the popup may already be gone */
      }
      finish(() => reject(new OidcCancelled()));
    };
  });
  return attempt;
}

/** After a full-page redirect sign-in, returns the token (or throws) once; otherwise null. */
export function takeRedirectResult(): OidcToken | null {
  const pending = readJson<Pending>(PENDING_KEY);
  const result = readJson<CallbackResult>(RESULT_KEY);
  if (!pending || pending.mode !== "redirect") return null;
  if (!result) {
    // Abandoned (e.g. the person pressed Back on the provider page). Expire it quietly.
    if (Date.now() - pending.createdAt > MAX_WAIT_MS) localStorage.removeItem(PENDING_KEY);
    return null;
  }
  localStorage.removeItem(PENDING_KEY);
  localStorage.removeItem(RESULT_KEY);
  return settle(pending, result);
}
