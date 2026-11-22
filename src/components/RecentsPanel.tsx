import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { SceneRecord } from "../store";
import { cloudEnabled } from "../lib/cloud/api";
import { openSignIn, useAuth } from "../lib/cloud/session";
import { deleteScene, isBackedUp, openAccountScene, useSync } from "../lib/cloud/sync";

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface Row {
  id: string;
  name: string;
  updatedAt: number;
  where: "local" | "synced" | "account";
  empty?: boolean;
}

export default function RecentsPanel() {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recents = useStore((s) => s.recents);
  const sceneId = useStore((s) => s.sceneId);
  const sceneName = useStore((s) => s.sceneName);
  const sceneUpdatedAt = useStore((s) => s.sceneUpdatedAt);
  const elements = useStore((s) => s.elements);
  const loadRecent = useStore((s) => s.loadRecent);
  const signedIn = useAuth((s) => !!s.user);
  const remote = useSync((s) => s.remote);

  // A delete button needs a second click within a few seconds.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const current: SceneRecord = { id: sceneId, name: sceneName, elements, updatedAt: sceneUpdatedAt };
  const local = [current, ...[...recents].sort((a, b) => b.updatedAt - a.updatedAt)];
  const localIds = new Set(local.map((s) => s.id));
  const rows: Row[] = local.map((s) => ({
    id: s.id,
    name: s.name,
    updatedAt: s.updatedAt,
    where: signedIn && isBackedUp(s, remote) ? "synced" : "local",
    empty: s.elements.length === 0,
  }));
  const accountOnly: Row[] = signedIn
    ? remote
        .filter((r) => !r.deleted && !localIds.has(r.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt, where: "account" }))
    : [];

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Recent scenes"
        aria-label="Show recent scenes"
        className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-l-xl border border-r-0 border-gray-200 bg-white/95 text-lg shadow-md backdrop-blur hover:bg-gray-100"
      >
        🕘
      </button>
    );
  }

  const openRow = async (row: Row) => {
    setError(null);
    if (row.id === sceneId) return;
    if (row.where !== "account") {
      loadRecent(row.id);
      return;
    }
    setOpening(row.id);
    try {
      await openAccountScene(row.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open this drawing.");
    } finally {
      setOpening(null);
    }
  };

  const ICON: Record<Row["where"], [string, string]> = {
    local: ["💾", signedIn ? "Only in this browser so far (saving to your account…)" : "Saved in this browser"],
    synced: ["☁️", "Saved to your account and this browser"],
    account: ["☁️", "In your account. Click to open it here."],
  };

  const renderRow = (s: Row) => {
    const isCurrent = s.id === sceneId;
    const [icon, defaultTitle] = ICON[s.where];
    const iconTitle =
      signedIn && s.where === "local" && s.empty ? "Saved to your account once you draw something" : defaultTitle;
    const deleteTitle = signedIn ? "Delete from your account and this browser" : "Delete from this browser";
    return (
      <div
        key={s.id}
        onClick={() => void openRow(s)}
        className={`group flex items-center gap-2 px-3 py-2 transition ${
          isCurrent ? "bg-indigo-50" : "cursor-pointer hover:bg-gray-50"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span title={iconTitle} className={`shrink-0 text-xs ${s.where === "account" ? "opacity-60" : ""}`}>
              {icon}
            </span>
            <span className="truncate text-sm font-medium text-gray-800">{s.name || "Untitled"}</span>
            {isCurrent && (
              <span className="shrink-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                current
              </span>
            )}
          </div>
          <div className="mt-0.5 pl-5 text-xs text-gray-500">
            {opening === s.id ? "Opening…" : `Edited ${relativeTime(s.updatedAt)}`}
          </div>
        </div>
        {!isCurrent && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Deleting from the account reaches every device, so ask twice.
              if (signedIn && armed !== s.id) {
                setArmed(s.id);
                return;
              }
              setArmed(null);
              deleteScene(s.id);
            }}
            title={armed === s.id ? "Click again to delete" : deleteTitle}
            aria-label={`Delete ${s.name || "Untitled"}`}
            className={`flex h-7 shrink-0 items-center justify-center rounded transition ${
              armed === s.id
                ? "bg-red-600 px-2 text-xs font-medium text-white opacity-100"
                : "w-7 text-gray-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
            }`}
          >
            {armed === s.id ? "Delete?" : "🗑"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="pointer-events-auto flex h-[70vh] max-h-[560px] w-64 flex-col overflow-hidden rounded-l-xl border border-r-0 border-gray-200 bg-white/95 shadow-md backdrop-blur">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-sm font-semibold text-gray-800">Recent scenes</span>
        <button
          onClick={() => setOpen(false)}
          title="Collapse"
          aria-label="Collapse recent scenes"
          className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {rows.map(renderRow)}
        {accountOnly.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              In your account
            </div>
            {accountOnly.map(renderRow)}
          </>
        )}
      </div>
      {error && <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {cloudEnabled && !signedIn && (
        <div className="border-t border-gray-100 px-3 py-2.5 text-xs leading-5 text-gray-500">
          These live in this browser only.{" "}
          <button className="font-medium text-indigo-600 hover:text-indigo-800" onClick={openSignIn}>
            Sign in
          </button>{" "}
          to keep them in your account and open them anywhere.
        </div>
      )}
    </div>
  );
}
