import { create } from "zustand";
import { setAuthToken } from "./api";

/** The signed-in person, as the backend describes them. */
export interface CloudUser {
  id: string;
  email: string | null;
  name: string | null;
  providers: ("email" | "google" | "microsoft")[];
}

/** Which sign-in options the backend offers (client ids are public). */
export interface AuthConfig {
  email: boolean;
  google: string | null;
  microsoft: string | null;
}

interface AuthState {
  /** null until GET /auth/config answers. */
  config: AuthConfig | null;
  configError: string | null;
  user: CloudUser | null;
  token: string | null;
  signInOpen: boolean;
}

const SESSION_KEY = "drawesome:session";

function loadSession(): { token: string | null; user: CloudUser | null } {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { token?: unknown; user?: CloudUser };
      if (typeof data.token === "string" && data.user?.id) return { token: data.token, user: data.user };
    }
  } catch {
    /* blocked or corrupt storage: signed out */
  }
  return { token: null, user: null };
}

const initial = loadSession();
setAuthToken(initial.token);

export const useAuth = create<AuthState>(() => ({
  config: null,
  configError: null,
  user: initial.user,
  token: initial.token,
  signInOpen: false,
}));

export function setSession(token: string, user: CloudUser) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
  } catch {
    /* still signed in for this page load */
  }
  setAuthToken(token);
  useAuth.setState({ token, user });
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  setAuthToken(null);
  useAuth.setState({ token: null, user: null });
}

export const openSignIn = () => useAuth.setState({ signInOpen: true });
export const closeSignIn = () => useAuth.setState({ signInOpen: false });

/** "Ada Lovelace" → "A", falling back to the email address. */
export function initialFor(user: CloudUser): string {
  const source = user.name?.trim() || user.email?.trim() || "?";
  return source.charAt(0).toUpperCase();
}
