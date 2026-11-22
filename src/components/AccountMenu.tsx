import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cloudEnabled } from "../lib/cloud/api";
import { initialFor, openSignIn, useAuth } from "../lib/cloud/session";
import { syncNow, useSync } from "../lib/cloud/sync";
import { deleteAccount, errorMessage, signOut } from "../lib/cloud/auth";

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const PROVIDER_NAME = { email: "email code", google: "Google", microsoft: "Microsoft" } as const;

export default function AccountMenu() {
  const user = useAuth((s) => s.user);
  const status = useSync((s) => s.status);
  const lastSyncedAt = useSync((s) => s.lastSyncedAt);
  const syncError = useSync((s) => s.error);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "signout" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Keep "synced 2m ago" fresh while the menu is open.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !dropdownRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!cloudEnabled) return null;

  const btn = "flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-gray-700 hover:bg-gray-100";

  if (!user) {
    return (
      <div className="flex shrink-0 items-center rounded-xl border border-gray-200 bg-white/95 px-1.5 py-1.5 shadow-md backdrop-blur">
        <button className={`${btn} font-medium`} onClick={openSignIn} title="Sign in to save drawings to your account">
          Sign in
        </button>
      </div>
    );
  }

  const dot =
    status === "syncing"
      ? "bg-amber-400 animate-pulse"
      : status === "error"
      ? "bg-red-500"
      : status === "offline"
      ? "bg-gray-400"
      : "bg-emerald-500";
  const statusText =
    status === "syncing"
      ? "Saving to your account…"
      : status === "offline"
      ? "Offline. Changes are kept in this browser and saved when you're back online."
      : status === "error"
      ? syncError ?? "Couldn't save to your account."
      : lastSyncedAt
      ? `All drawings saved · ${ago(lastSyncedAt)}`
      : "Connecting…";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setConfirm(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={menuRef} className="relative flex shrink-0 items-center rounded-xl border border-gray-200 bg-white/95 px-1.5 py-1.5 shadow-md backdrop-blur">
      <button
        className="relative flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700"
        onClick={() => setOpen((o) => !o)}
        title={user.email ?? user.name ?? "Account"}
        aria-label="Account menu"
        aria-expanded={open}
      >
        {initialFor(user)}
        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${dot}`} />
      </button>

      {/* Portaled: the top bar's backdrop-blur would otherwise trap fixed children. */}
      {open &&
        createPortal(
        <div ref={dropdownRef} className="fixed right-3 top-16 z-30 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 px-4 py-3">
            {user.name && <div className="truncate text-sm font-semibold text-gray-900">{user.name}</div>}
            {user.email && <div className="truncate text-sm text-gray-600">{user.email}</div>}
            <div className="mt-1 text-xs text-gray-400">
              Signed in with {user.providers.map((p) => PROVIDER_NAME[p]).join(", ")}
            </div>
          </div>
          <div className="flex items-start gap-2 border-b border-gray-100 px-4 py-3 text-xs leading-5 text-gray-600">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <span className="flex-1">{statusText}</span>
            <button
              className="shrink-0 rounded px-1.5 font-medium text-indigo-600 hover:bg-indigo-50 disabled:text-gray-400"
              disabled={status === "syncing"}
              onClick={() => void syncNow()}
            >
              Sync now
            </button>
          </div>
          <button
            className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => {
              setOpen(false);
              setError(null);
              setConfirm("signout");
            }}
          >
            Sign out
          </button>
          <button
            className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              setOpen(false);
              setError(null);
              setConfirm("delete");
            }}
          >
            Delete account…
          </button>
        </div>,
          document.body
        )}

      {confirm &&
        createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape" && !busy) setConfirm(null);
          }}
        >
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            {confirm === "signout" ? (
              <>
                <h2 className="mb-1 text-base font-semibold text-gray-800">Sign out of Drawesome?</h2>
                <p className="mb-4 text-sm leading-5 text-gray-600">
                  Your drawings are saved in your account. Keep a copy in this browser, or remove them from this device
                  (useful on a shared computer)?
                </p>
              </>
            ) : (
              <>
                <h2 className="mb-1 text-base font-semibold text-gray-800">Delete your account?</h2>
                <p className="mb-4 text-sm leading-5 text-gray-600">
                  This permanently deletes your account and every drawing saved to it, on all devices. Drawings in this
                  browser stay here. This can't be undone.
                </p>
              </>
            )}
            {error && (
              <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              {confirm === "signout" ? (
                <>
                  <button
                    className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void run(() => signOut(true))}
                  >
                    Remove from this device
                  </button>
                  <button
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void run(() => signOut(false))}
                  >
                    {busy ? "Signing out…" : "Keep on this device"}
                  </button>
                </>
              ) : (
                <button
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void run(deleteAccount)}
                >
                  {busy ? "Deleting…" : "Delete account"}
                </button>
              )}
            </div>
          </div>
        </div>,
          document.body
        )}
    </div>
  );
}
