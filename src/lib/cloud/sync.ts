import { create } from "zustand";
import { MAX_RECENTS, useStore } from "../../store";
import type { SceneRecord } from "../../store";
import type { DrawElement } from "../../types";
import { api, ApiError } from "./api";
import { useAuth } from "./session";

/**
 * Keeps the scenes in this browser and the ones saved to the account in step.
 *
 * The browser stays the place where editing happens (auto-save to localStorage, works
 * offline); sync backs scenes up and brings in edits from other devices:
 *   1. send deletions made here (tombstones), unless the scene was edited later elsewhere
 *   2. upload scenes edited here since the account last saw them
 *   3. download scenes edited elsewhere, plus newer account-only scenes while there's
 *      room in this browser (MAX_RECENTS); older ones stay listed as "in your account"
 * Conflicts are last-write-wins per scene on the edit time (`updatedAt`). A scene that
 * isn't safely in the account yet is never dropped from this browser to make room.
 */
export interface RemoteScene {
  id: string;
  name: string;
  updatedAt: number;
  deleted: boolean;
}

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  error: string | null;
  /** Names of scenes too large to back up. */
  tooLarge: string[];
  /** Everything the account holds, tombstones included (as of the last sync). */
  remote: RemoteScene[];
}

export const useSync = create<SyncState>(() => ({
  status: "idle",
  lastSyncedAt: null,
  error: null,
  tooLarge: [],
  remote: [],
}));

const TOMBSTONES_KEY = "drawesome:cloud:tombstones";
const DOWNLOAD_CONCURRENCY = 4;

function loadTombstones(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TOMBSTONES_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveTombstones(t: Record<string, number>) {
  try {
    if (Object.keys(t).length) localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOMBSTONES_KEY);
  } catch {
    /* ignore */
  }
}

export function clearTombstones() {
  saveTombstones({});
}

function localScenes(): SceneRecord[] {
  const s = useStore.getState();
  return [
    { id: s.sceneId, name: s.sceneName, elements: s.elements, updatedAt: s.sceneUpdatedAt },
    ...s.recents,
  ];
}

/** Edit time of each scene currently in this browser. */
function localTimes(): Map<string, number> {
  return new Map(localScenes().map((r) => [r.id, r.updatedAt]));
}

/** True when the account holds this scene at the same or a newer edit. */
export function isBackedUp(scene: { id: string; updatedAt: number }, remote: RemoteScene[]): boolean {
  const r = remote.find((m) => m.id === scene.id);
  return !!r && !r.deleted && r.updatedAt >= scene.updatedAt;
}

async function download(id: string): Promise<SceneRecord | null> {
  try {
    const { scene } = await api<{ scene: { id: string; name: string; updatedAt: number; elements: DrawElement[] } }>(
      `/scenes/${encodeURIComponent(id)}`
    );
    return { id: scene.id, name: scene.name, updatedAt: scene.updatedAt, elements: scene.elements };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

let applyingRemote = false;

export interface SyncResult {
  ok: boolean;
  /** Scenes in this browser that the account doesn't have yet. */
  pending: number;
}

async function runSync(): Promise<SyncResult> {
  if (!useAuth.getState().token) return { ok: false, pending: 0 };
  useSync.setState({ status: "syncing" });
  try {
    const { scenes } = await api<{ scenes: RemoteScene[] }>("/scenes");
    const remote = new Map(scenes.map((m) => [m.id, m]));

    // 1. Deletions made in this browser.
    const tombstones = loadTombstones();
    for (const [id, deletedAt] of Object.entries(tombstones)) {
      const r = remote.get(id);
      if (r && !r.deleted && r.updatedAt <= deletedAt) {
        try {
          await api(`/scenes/${encodeURIComponent(id)}?deletedAt=${deletedAt}`, { method: "DELETE" });
          remote.set(id, { ...r, updatedAt: deletedAt, deleted: true });
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409)) throw err;
          if (err.body.remote) remote.set(id, err.body.remote as RemoteScene);
        }
      }
      delete tombstones[id];
      saveTombstones(tombstones);
    }

    // 2. Uploads.
    const local = localScenes();
    const removed: string[] = [];
    const tooLarge: string[] = [];
    for (const scene of local) {
      const r = remote.get(scene.id);
      if (r?.deleted && r.updatedAt >= scene.updatedAt) {
        removed.push(scene.id);
        continue;
      }
      if (r && !r.deleted && r.updatedAt >= scene.updatedAt) continue; // same, or newer there
      if (!r && scene.elements.length === 0) continue; // nothing worth saving yet
      try {
        await api(`/scenes/${encodeURIComponent(scene.id)}`, {
          method: "PUT",
          body: { name: scene.name, updatedAt: scene.updatedAt, elements: scene.elements },
        });
        remote.set(scene.id, { id: scene.id, name: scene.name, updatedAt: scene.updatedAt, deleted: false });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.body.remote) {
          remote.set(scene.id, err.body.remote as RemoteScene); // edited elsewhere meanwhile: download below
        } else if (err instanceof ApiError && err.status === 413) {
          tooLarge.push(scene.name || "Untitled");
        } else {
          throw err;
        }
      }
    }

    // 3. Downloads. Local copies older than the account's are refreshed; account-only
    //    scenes come in while they rank among the newest MAX_RECENTS.
    const remoteList = [...remote.values()];
    const backedUp = (s: SceneRecord) => isBackedUp(s, remoteList);
    const toDownload = local
      .filter((s) => {
        const r = remote.get(s.id);
        return r && !r.deleted && r.updatedAt > s.updatedAt;
      })
      .map((s) => s.id);

    const localIds = new Set(local.map((s) => s.id));
    const others = local.slice(1).filter((s) => !removed.includes(s.id));
    const mustKeep = others.filter((s) => !backedUp(s)).length;
    const slots = Math.max(0, MAX_RECENTS - 1 - mustKeep);
    const pool = [
      ...others.filter(backedUp).map((s) => ({ id: s.id, updatedAt: remote.get(s.id)!.updatedAt, accountOnly: false })),
      ...remoteList
        .filter((r) => !r.deleted && !localIds.has(r.id))
        .map((r) => ({ id: r.id, updatedAt: r.updatedAt, accountOnly: true })),
    ].sort((a, b) => b.updatedAt - a.updatedAt);
    toDownload.push(...pool.slice(0, slots).filter((p) => p.accountOnly).map((p) => p.id));
    const evict = pool.slice(slots).filter((p) => !p.accountOnly).map((p) => p.id);

    const downloaded: SceneRecord[] = [];
    for (let i = 0; i < toDownload.length; i += DOWNLOAD_CONCURRENCY) {
      const batch = await Promise.all(toDownload.slice(i, i + DOWNLOAD_CONCURRENCY).map(download));
      batch.forEach((rec, j) => {
        const id = toDownload[i + j];
        if (rec) downloaded.push(rec);
        else {
          // Deleted between listing and downloading.
          const r = remote.get(id);
          if (r) remote.set(id, { ...r, deleted: true });
          if (localIds.has(id)) removed.push(id);
        }
      });
    }

    // Apply, re-checking against the browser's state right now: the person may have
    // kept drawing while the requests were in flight, and that edit must win.
    const now = localTimes();
    const current = useStore.getState().sceneId;
    const updated = downloaded.filter((rec) => !(now.has(rec.id) && now.get(rec.id)! >= rec.updatedAt));
    const removedNow = removed.filter((id) => {
      const t = now.get(id);
      const r = remote.get(id);
      return t !== undefined && !!r && t <= r.updatedAt;
    });
    const evictNow = evict.filter((id) => {
      const t = now.get(id);
      const r = remote.get(id);
      return id !== current && t !== undefined && !!r && !r.deleted && t <= r.updatedAt;
    });
    if (updated.length || removedNow.length || evictNow.length) {
      applyingRemote = true;
      try {
        useStore.getState().applyRemote(updated, removedNow, evictNow);
      } finally {
        applyingRemote = false;
      }
    }

    const finalRemote = [...remote.values()];
    const pending = localScenes().filter((s) => s.elements.length > 0 && !isBackedUp(s, finalRemote)).length;
    useSync.setState({
      status: tooLarge.length ? "error" : "idle",
      error: tooLarge.length ? `Too large to save to your account: ${tooLarge.join(", ")}` : null,
      tooLarge,
      remote: finalRemote,
      lastSyncedAt: Date.now(),
    });
    return { ok: true, pending };
  } catch (err) {
    const offline = err instanceof ApiError && err.status === 0;
    if (useAuth.getState().token) {
      useSync.setState({
        status: offline ? "offline" : "error",
        error: offline ? null : err instanceof Error ? err.message : "Sync failed",
      });
    }
    return { ok: false, pending: -1 };
  }
}

// ---- Scheduling: one sync at a time; requests during a run share one follow-up run.
let running: Promise<SyncResult> | null = null;
let next: Promise<SyncResult> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Syncs now (or right after the current run) and resolves with that run's result. */
export function syncNow(): Promise<SyncResult> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!running) {
    running = runSync().finally(() => {
      running = null;
    });
    return running;
  }
  if (!next) {
    next = running.then(() => {
      next = null;
      return syncNow();
    });
  }
  return next;
}

/** Debounced sync, e.g. a couple of seconds after the last edit. */
export function requestSync(delayMs = 0) {
  if (!useAuth.getState().token) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
}

// ---- Actions used by the recents panel.

/** Deletes a scene here and, once synced, from the account and other devices. */
export function deleteScene(id: string) {
  const st = useStore.getState();
  if (st.recents.some((r) => r.id === id)) st.deleteRecent(id);
  if (!useAuth.getState().token) return;
  const tombstones = loadTombstones();
  tombstones[id] = Math.max(Date.now(), (useSync.getState().remote.find((r) => r.id === id)?.updatedAt ?? 0) + 1);
  saveTombstones(tombstones);
  useSync.setState((s) => ({ remote: s.remote.map((r) => (r.id === id ? { ...r, deleted: true } : r)) }));
  requestSync(0);
}

/** Opens a scene that is only in the account. */
export async function openAccountScene(id: string): Promise<void> {
  const rec = await download(id);
  if (!rec) {
    useSync.setState((s) => ({ remote: s.remote.map((r) => (r.id === id ? { ...r, deleted: true } : r)) }));
    throw new Error("This drawing was deleted on another device.");
  }
  useStore.getState().openScene(rec);
  requestSync(1500);
}

export function resetSyncState() {
  if (timer) clearTimeout(timer);
  timer = null;
  useSync.setState({ status: "idle", lastSyncedAt: null, error: null, tooLarge: [], remote: [] });
}

// ---- Triggers.
let started = false;
const EDIT_DEBOUNCE_MS = 2500;
const POLL_MS = 2 * 60_000;
const FOCUS_MIN_GAP_MS = 15_000;

export function startSyncTriggers() {
  if (started) return;
  started = true;

  // Edits (and scene switches, which move the outgoing scene into recents).
  let lastUpdatedAt = useStore.getState().sceneUpdatedAt;
  let lastRecents = useStore.getState().recents;
  useStore.subscribe((s) => {
    if (s.sceneUpdatedAt === lastUpdatedAt && s.recents === lastRecents) return;
    lastUpdatedAt = s.sceneUpdatedAt;
    lastRecents = s.recents;
    if (!applyingRemote) requestSync(EDIT_DEBOUNCE_MS);
  });

  // Coming back to the tab or the network: pick up edits from other devices.
  const maybeSync = () => {
    const last = useSync.getState().lastSyncedAt ?? 0;
    if (document.visibilityState === "visible" && Date.now() - last > FOCUS_MIN_GAP_MS) requestSync(0);
  };
  document.addEventListener("visibilitychange", maybeSync);
  window.addEventListener("focus", maybeSync);
  window.addEventListener("online", () => requestSync(0));
  window.setInterval(() => {
    if (document.visibilityState === "visible") requestSync(0);
  }, POLL_MS);
}
