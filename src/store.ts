import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  Camera,
  DrawElement,
  StyleDefaults,
  Theme,
  Tool,
} from "./types";

const clone = (els: DrawElement[]): DrawElement[] =>
  els.map((e) => ({
    ...e,
    points: e.points ? e.points.map((p) => [p[0], p[1]] as [number, number]) : undefined,
    cells: e.cells ? e.cells.map((row) => [...row]) : undefined,
    startAnchor: e.startAnchor ? ([e.startAnchor[0], e.startAnchor[1]] as [number, number]) : e.startAnchor,
    endAnchor: e.endAnchor ? ([e.endAnchor[0], e.endAnchor[1]] as [number, number]) : e.endAnchor,
  }));

const HISTORY_LIMIT = 100;

const SCENES_KEY = "drawesome:scenes";
const DEFAULT_SCENE_NAME = "Untitled";
/** Scenes kept in this browser: the open one plus the most recently edited others. */
export const MAX_RECENTS = 10;
const MAX_OTHERS = MAX_RECENTS - 1;

/** A persisted snapshot of a scene, used for auto-save and the recents panel. */
export interface SceneRecord {
  id: string;
  name: string;
  elements: DrawElement[];
  /** When the scene's content or name last changed (not when it was last opened). */
  updatedAt: number;
}

/** Newest edit first, capped to the number of "other" scenes kept locally. */
const rankRecents = (list: SceneRecord[]): SceneRecord[] =>
  [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_OTHERS);

interface ScenesStore {
  version: number;
  currentId: string;
  scenes: SceneRecord[];
}

/** Load all persisted scenes, migrating the older single-scene format. */
function loadScenes(): ScenesStore | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SCENES_KEY);
    if (raw) {
      const data = JSON.parse(raw) as ScenesStore;
      if (data && Array.isArray(data.scenes) && data.scenes.length) return data;
    }
  } catch {
    /* ignore corrupt store */
  }
  try {
    const raw = localStorage.getItem("drawesome:autosave");
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.elements)) {
        const rec: SceneRecord = {
          id: nanoid(),
          name: typeof data.name === "string" && data.name ? data.name : DEFAULT_SCENE_NAME,
          elements: data.elements,
          updatedAt: Date.now(),
        };
        return { version: 1, currentId: rec.id, scenes: [rec] };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function persistScenes(data: ScenesStore) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SCENES_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / serialization errors */
  }
}

/** Return a name that doesn't collide with any of `taken`, suffixing -1, -2… */
function makeUniqueName(base: string, taken: string[]): string {
  const trimmed = base.trim() || DEFAULT_SCENE_NAME;
  const set = new Set(taken);
  if (!set.has(trimmed)) return trimmed;
  let n = 1;
  while (set.has(`${trimmed}-${n}`)) n++;
  return `${trimmed}-${n}`;
}

const loadedScenes = loadScenes();
const initialCurrent: SceneRecord = loadedScenes
  ? loadedScenes.scenes.find((s) => s.id === loadedScenes.currentId) ?? loadedScenes.scenes[0]
  : { id: nanoid(), name: DEFAULT_SCENE_NAME, elements: [], updatedAt: Date.now() };
const initialRecents: SceneRecord[] = loadedScenes
  ? loadedScenes.scenes.filter((s) => s.id !== initialCurrent.id)
  : [];

export interface AppState {
  elements: DrawElement[];
  selectedIds: string[];
  tool: Tool;
  camera: Camera;
  theme: Theme;
  defaults: StyleDefaults;
  gridEnabled: boolean;
  snapEnabled: boolean;
  presenting: boolean;
  frameIndex: number;
  sceneName: string;
  sceneId: string;
  /** Edit time of the open scene; bumped by auto-save when its content or name changes. */
  sceneUpdatedAt: number;
  recents: SceneRecord[];
  past: DrawElement[][];
  future: DrawElement[][];
  clipboard: DrawElement[];
  clipboardPasteCount: number;

  setSceneName: (name: string) => void;
  renameCurrent: (name: string) => void;
  newCanvas: () => void;
  loadRecent: (id: string) => void;
  deleteRecent: (id: string) => void;
  /** Open a scene that isn't in recents yet (e.g. one downloaded from the account). */
  openScene: (rec: SceneRecord) => void;
  /**
   * Merge scenes pulled from the account: `updated` replaces or adds local copies,
   * `removedIds` were deleted on another device, `evictIds` are safely backed up and
   * make room for newer ones in this browser.
   */
  applyRemote: (updated: SceneRecord[], removedIds: string[], evictIds: string[]) => void;
  /** Forget every scene in this browser and start from a blank canvas. */
  resetScenes: () => void;
  setPresenting: (v: boolean) => void;
  setFrameIndex: (i: number) => void;
  setTool: (tool: Tool) => void;
  setCamera: (cam: Partial<Camera>) => void;
  setSelection: (ids: string[]) => void;
  toggleTheme: () => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  setDefaults: (patch: Partial<StyleDefaults>) => void;

  /** Snapshot current elements so the next mutation can be undone. */
  pushHistory: () => void;
  setElements: (els: DrawElement[]) => void;
  addElement: (el: DrawElement) => void;
  updateElements: (ids: string[], patch: Partial<DrawElement>) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  pasteClipboard: () => void;
  selectAll: () => void;
  applyStyleToSelected: (patch: Partial<StyleDefaults>) => void;

  bringToFront: () => void;
  sendToBack: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  distribute: (axis: "h" | "v") => void;
  setLink: (id: string, link: string) => void;
  spawnConnected: (
    sourceId: string,
    dir: "left" | "right" | "up" | "down"
  ) => string | null;

  undo: () => void;
  redo: () => void;
  clearScene: () => void;
  loadScene: (els: DrawElement[]) => void;

  makeElement: (type: DrawElement["type"], x: number, y: number) => DrawElement;
}

export const useStore = create<AppState>((set, get) => ({
  elements: initialCurrent.elements,
  selectedIds: [],
  tool: "select",
  camera: { offsetX: 0, offsetY: 0, zoom: 1 },
  theme: "sketch",
  defaults: {
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    opacity: 100,
    fontSize: 20,
    textAlign: "center",
    textVAlign: "middle",
  },
  gridEnabled: true,
  snapEnabled: true,
  presenting: false,
  frameIndex: 0,
  sceneName: initialCurrent.name,
  sceneId: initialCurrent.id,
  sceneUpdatedAt: initialCurrent.updatedAt,
  recents: initialRecents,
  past: [],
  future: [],
  clipboard: [],
  clipboardPasteCount: 0,

  setSceneName: (name) => set({ sceneName: name }),

  renameCurrent: (name) => {
    const { recents } = get();
    const unique = makeUniqueName(name, recents.map((s) => s.name));
    set({ sceneName: unique });
  },

  newCanvas: () => {
    const { elements, sceneId, sceneName, sceneUpdatedAt, recents } = get();
    const others = recents.filter((s) => s.id !== sceneId);
    const nextRecents = rankRecents(
      elements.length > 0
        ? [{ id: sceneId, name: sceneName, elements, updatedAt: sceneUpdatedAt }, ...others]
        : others
    );
    set({
      elements: [],
      selectedIds: [],
      sceneId: nanoid(),
      sceneName: makeUniqueName(
        DEFAULT_SCENE_NAME,
        nextRecents.map((s) => s.name)
      ),
      sceneUpdatedAt: Date.now(),
      recents: nextRecents,
      past: [],
      future: [],
    });
  },

  loadRecent: (id) => {
    const target = get().recents.find((s) => s.id === id);
    if (target) get().openScene(target);
  },

  openScene: (target) => {
    const { elements, sceneId, sceneName, sceneUpdatedAt, recents } = get();
    if (target.id === sceneId) return;
    const others = recents.filter((s) => s.id !== target.id && s.id !== sceneId);
    const nextRecents = rankRecents(
      elements.length > 0
        ? [{ id: sceneId, name: sceneName, elements, updatedAt: sceneUpdatedAt }, ...others]
        : others
    );
    set({
      elements: target.elements,
      selectedIds: [],
      sceneId: target.id,
      sceneName: target.name,
      sceneUpdatedAt: target.updatedAt,
      recents: nextRecents,
      past: [],
      future: [],
    });
  },

  deleteRecent: (id) =>
    set((s) => ({ recents: s.recents.filter((r) => r.id !== id) })),

  applyRemote: (updated, removedIds, evictIds) => {
    const s = get();
    const removed = new Set(removedIds);
    const evict = new Set(evictIds);
    const incoming = new Map(updated.map((r) => [r.id, r]));
    const known = new Set(s.recents.map((r) => r.id));

    let recents = s.recents
      .filter((r) => !removed.has(r.id) && !evict.has(r.id) && r.id !== s.sceneId)
      .map((r) => incoming.get(r.id) ?? r);
    for (const r of updated) {
      if (r.id !== s.sceneId && !known.has(r.id)) recents.push(r);
    }
    recents = rankRecents(recents);

    const remoteCurrent = incoming.get(s.sceneId);
    if (removed.has(s.sceneId)) {
      // The open scene was deleted on another device: move to the newest remaining one.
      const [next, ...rest] = recents;
      set({
        elements: next ? next.elements : [],
        sceneId: next ? next.id : nanoid(),
        sceneName: next ? next.name : makeUniqueName(DEFAULT_SCENE_NAME, rest.map((r) => r.name)),
        sceneUpdatedAt: next ? next.updatedAt : Date.now(),
        recents: next ? rest : recents,
        selectedIds: [],
        past: [],
        future: [],
      });
    } else if (remoteCurrent) {
      // Edited on another device since this browser last changed it. Undo brings back
      // the local version.
      set({
        elements: remoteCurrent.elements,
        sceneName: remoteCurrent.name,
        sceneUpdatedAt: remoteCurrent.updatedAt,
        selectedIds: [],
        past: [...s.past, clone(s.elements)].slice(-HISTORY_LIMIT),
        future: [],
        recents,
      });
    } else {
      set({ recents });
    }
  },

  resetScenes: () =>
    set({
      elements: [],
      selectedIds: [],
      sceneId: nanoid(),
      sceneName: DEFAULT_SCENE_NAME,
      sceneUpdatedAt: Date.now(),
      recents: [],
      past: [],
      future: [],
    }),

  setPresenting: (v) => set({ presenting: v }),
  setFrameIndex: (i) => set({ frameIndex: i }),
  setTool: (tool) => set({ tool }),
  setCamera: (cam) => set((s) => ({ camera: { ...s.camera, ...cam } })),
  setSelection: (ids) => set({ selectedIds: ids }),
  toggleTheme: () =>
    set((s) => ({ theme: s.theme === "sketch" ? "clean" : "sketch" })),
  toggleGrid: () => set((s) => ({ gridEnabled: !s.gridEnabled })),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  setDefaults: (patch) => set((s) => ({ defaults: { ...s.defaults, ...patch } })),

  pushHistory: () =>
    set((s) => ({
      past: [...s.past, clone(s.elements)].slice(-HISTORY_LIMIT),
      future: [],
    })),

  setElements: (els) => set({ elements: els }),

  addElement: (el) => set((s) => ({ elements: [...s.elements, el] })),

  updateElements: (ids, patch) =>
    set((s) => ({
      elements: s.elements.map((e) =>
        ids.includes(e.id) ? { ...e, ...patch } : e
      ),
    })),

  deleteSelected: () => {
    const { selectedIds, elements, pushHistory } = get();
    if (selectedIds.length === 0) return;
    pushHistory();
    set({
      elements: elements.filter((e) => !selectedIds.includes(e.id)),
      selectedIds: [],
    });
  },

  duplicateSelected: () => {
    const { selectedIds, elements, pushHistory } = get();
    if (selectedIds.length === 0) return;
    pushHistory();
    const copies: DrawElement[] = [];
    const newIds: string[] = [];
    for (const e of elements) {
      if (selectedIds.includes(e.id)) {
        const copy = {
          ...clone([e])[0],
          id: nanoid(),
          x: e.x + 16,
          y: e.y + 16,
        };
        copies.push(copy);
        newIds.push(copy.id);
      }
    }
    set({ elements: [...elements, ...copies], selectedIds: newIds });
  },

  copySelected: () => {
    const { selectedIds, elements } = get();
    if (selectedIds.length === 0) return;
    set({
      clipboard: clone(elements.filter((e) => selectedIds.includes(e.id))),
      clipboardPasteCount: 0,
    });
  },

  pasteClipboard: () => {
    const { clipboard, clipboardPasteCount, elements, pushHistory } = get();
    if (clipboard.length === 0) return;
    pushHistory();
    const idMap = new Map(clipboard.map((e) => [e.id, nanoid()]));
    const offset = 16 * (clipboardPasteCount + 1);
    const copies = clone(clipboard).map((e) => {
      const startBinding = e.startBinding
        ? idMap.get(e.startBinding)
        : undefined;
      const endBinding = e.endBinding ? idMap.get(e.endBinding) : undefined;
      return {
        ...e,
        id: idMap.get(e.id)!,
        x: e.x + offset,
        y: e.y + offset,
        startBinding,
        endBinding,
        startAnchor: startBinding ? e.startAnchor : undefined,
        endAnchor: endBinding ? e.endAnchor : undefined,
        frameId: e.frameId ? idMap.get(e.frameId) : undefined,
      };
    });
    set({
      elements: [...elements, ...copies],
      selectedIds: copies.map((e) => e.id),
      clipboardPasteCount: clipboardPasteCount + 1,
    });
  },

  selectAll: () =>
    set((s) => ({ selectedIds: s.elements.map((e) => e.id) })),

  applyStyleToSelected: (patch) => {
    const { selectedIds, pushHistory, setDefaults } = get();
    setDefaults(patch);
    if (selectedIds.length === 0) return;
    pushHistory();
    set((s) => ({
      elements: s.elements.map((e) =>
        selectedIds.includes(e.id) ? { ...e, ...patch } : e
      ),
    }));
  },

  bringToFront: () => {
    const { selectedIds, elements, pushHistory } = get();
    if (!selectedIds.length) return;
    pushHistory();
    const sel = elements.filter((e) => selectedIds.includes(e.id));
    const rest = elements.filter((e) => !selectedIds.includes(e.id));
    set({ elements: [...rest, ...sel] });
  },
  sendToBack: () => {
    const { selectedIds, elements, pushHistory } = get();
    if (!selectedIds.length) return;
    pushHistory();
    const sel = elements.filter((e) => selectedIds.includes(e.id));
    const rest = elements.filter((e) => !selectedIds.includes(e.id));
    set({ elements: [...sel, ...rest] });
  },
  bringForward: () => {
    const { selectedIds, elements, pushHistory } = get();
    if (!selectedIds.length) return;
    pushHistory();
    const arr = [...elements];
    for (let i = arr.length - 2; i >= 0; i--) {
      if (selectedIds.includes(arr[i].id) && !selectedIds.includes(arr[i + 1].id)) {
        [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      }
    }
    set({ elements: arr });
  },
  sendBackward: () => {
    const { selectedIds, elements, pushHistory } = get();
    if (!selectedIds.length) return;
    pushHistory();
    const arr = [...elements];
    for (let i = 1; i < arr.length; i++) {
      if (selectedIds.includes(arr[i].id) && !selectedIds.includes(arr[i - 1].id)) {
        [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
      }
    }
    set({ elements: arr });
  },

  distribute: (axis) => {
    const { selectedIds, elements, pushHistory } = get();
    const sel = elements.filter((e) => selectedIds.includes(e.id));
    if (sel.length < 3) return;
    pushHistory();
    const moved = new Map<string, { x: number; y: number }>();
    if (axis === "h") {
      const sorted = [...sel].sort((a, b) => a.x - b.x);
      const min = sorted[0].x;
      const last = sorted[sorted.length - 1];
      const max = last.x + last.width;
      const totalW = sorted.reduce((s, e) => s + e.width, 0);
      const gap = (max - min - totalW) / (sorted.length - 1);
      let cursor = min;
      for (const e of sorted) {
        moved.set(e.id, { x: cursor, y: e.y });
        cursor += e.width + gap;
      }
    } else {
      const sorted = [...sel].sort((a, b) => a.y - b.y);
      const min = sorted[0].y;
      const last = sorted[sorted.length - 1];
      const max = last.y + last.height;
      const totalH = sorted.reduce((s, e) => s + e.height, 0);
      const gap = (max - min - totalH) / (sorted.length - 1);
      let cursor = min;
      for (const e of sorted) {
        moved.set(e.id, { x: e.x, y: cursor });
        cursor += e.height + gap;
      }
    }
    set({
      elements: elements.map((e) =>
        moved.has(e.id) ? { ...e, ...moved.get(e.id)! } : e
      ),
    });
  },

  setLink: (id, link) => {
    const { pushHistory } = get();
    pushHistory();
    set((s) => ({
      elements: s.elements.map((e) =>
        e.id === id ? { ...e, link: link || undefined } : e
      ),
    }));
  },

  spawnConnected: (sourceId, dir) => {
    const { elements, defaults, pushHistory } = get();
    const src = elements.find((e) => e.id === sourceId);
    if (!src) return null;
    const bindable =
      src.type === "rectangle" ||
      src.type === "diamond" ||
      src.type === "ellipse" ||
      src.type === "table" ||
      src.type === "image";
    if (!bindable) return null;
    pushHistory();
    const gap = 90;
    let nx = src.x;
    let ny = src.y;
    if (dir === "right") nx = src.x + src.width + gap;
    else if (dir === "left") nx = src.x - src.width - gap;
    else if (dir === "down") ny = src.y + src.height + gap;
    else ny = src.y - src.height - gap;

    const dup: DrawElement = {
      ...clone([src])[0],
      id: nanoid(),
      x: nx,
      y: ny,
      angle: 0,
      seed: Math.floor(Math.random() * 2 ** 31),
      label: src.type === "text" ? src.label : "",
      link: undefined,
      startBinding: undefined,
      endBinding: undefined,
      startAnchor: undefined,
      endAnchor: undefined,
    };

    const anchors: Record<string, { s: [number, number]; e: [number, number] }> = {
      right: { s: [1, 0.5], e: [0, 0.5] },
      left: { s: [0, 0.5], e: [1, 0.5] },
      down: { s: [0.5, 1], e: [0.5, 0] },
      up: { s: [0.5, 0], e: [0.5, 1] },
    };
    const sa = anchors[dir].s;
    const ea = anchors[dir].e;
    const sPt: [number, number] = [
      src.x + sa[0] * src.width,
      src.y + sa[1] * src.height,
    ];
    const ePt: [number, number] = [
      dup.x + ea[0] * dup.width,
      dup.y + ea[1] * dup.height,
    ];
    const arrow: DrawElement = {
      id: nanoid(),
      type: "arrow",
      x: sPt[0],
      y: sPt[1],
      width: ePt[0] - sPt[0],
      height: ePt[1] - sPt[1],
      angle: 0,
      strokeColor: defaults.strokeColor,
      backgroundColor: "transparent",
      fillStyle: defaults.fillStyle,
      strokeWidth: defaults.strokeWidth,
      strokeStyle: defaults.strokeStyle,
      opacity: defaults.opacity,
      seed: Math.floor(Math.random() * 2 ** 31),
      fontSize: defaults.fontSize,
      points: [
        [0, 0],
        [ePt[0] - sPt[0], ePt[1] - sPt[1]],
      ],
      startBinding: src.id,
      endBinding: dup.id,
      startAnchor: sa,
      endAnchor: ea,
    };

    set({ elements: [...elements, dup, arrow], selectedIds: [dup.id] });
    return dup.id;
  },

  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return {
        elements: prev,
        past: s.past.slice(0, -1),
        future: [clone(s.elements), ...s.future].slice(0, HISTORY_LIMIT),
        selectedIds: [],
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      return {
        elements: next,
        future: s.future.slice(1),
        past: [...s.past, clone(s.elements)].slice(-HISTORY_LIMIT),
        selectedIds: [],
      };
    }),

  clearScene: () => {
    const { elements, pushHistory } = get();
    if (elements.length === 0) return;
    pushHistory();
    set({ elements: [], selectedIds: [] });
  },

  loadScene: (els) => {
    get().pushHistory();
    set({ elements: els, selectedIds: [] });
  },

  makeElement: (type, x, y) => {
    const d = get().defaults;
    const el: DrawElement = {
      id: nanoid(),
      type,
      x,
      y,
      width: 0,
      height: 0,
      angle: 0,
      strokeColor: d.strokeColor,
      backgroundColor: d.backgroundColor,
      fillStyle: d.fillStyle,
      strokeWidth: d.strokeWidth,
      strokeStyle: d.strokeStyle,
      opacity: d.opacity,
      seed: Math.floor(Math.random() * 2 ** 31),
      fontSize: d.fontSize,
      textAlign: d.textAlign,
      textVAlign: d.textVAlign,
    };
    if (type === "line" || type === "arrow" || type === "draw") {
      el.points = [[0, 0]];
    }
    if (type === "text") {
      el.text = "";
      el.backgroundColor = "transparent";
    }
    if (type === "frame") {
      el.name = "Frame";
      el.backgroundColor = "transparent";
    }
    if (type === "table") {
      el.rows = 2;
      el.cols = 3;
      el.cells = [
        ["", "", ""],
        ["", "", ""],
      ];
      el.backgroundColor = "#ffffff";
    }
    if (type === "image") {
      el.backgroundColor = "transparent";
    }
    return el;
  },
}));

// ---- Auto-save ----
// Persist the scene to localStorage whenever the elements or scene name change,
// debounced so rapid edits (e.g. dragging) don't thrash storage. This is
// separate from the explicit JSON export and guards against losing unsaved work.
//
// It also keeps `sceneUpdatedAt` honest: a change to the open scene's content or name
// is an edit and gets the current time, while switching scenes or applying a copy
// from the account (which set `sceneUpdatedAt` themselves) is not. Account sync
// relies on this to decide which copy of a scene is newer.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastElements = useStore.getState().elements;
let lastName = useStore.getState().sceneName;
let lastId = useStore.getState().sceneId;
let lastRecents = useStore.getState().recents;
let lastUpdatedAt = useStore.getState().sceneUpdatedAt;
useStore.subscribe((state) => {
  if (
    state.elements === lastElements &&
    state.sceneName === lastName &&
    state.sceneId === lastId &&
    state.recents === lastRecents &&
    state.sceneUpdatedAt === lastUpdatedAt
  )
    return;
  const edited =
    state.sceneId === lastId &&
    state.sceneUpdatedAt === lastUpdatedAt &&
    (state.elements !== lastElements || state.sceneName !== lastName);
  lastElements = state.elements;
  lastName = state.sceneName;
  lastId = state.sceneId;
  lastRecents = state.recents;
  lastUpdatedAt = state.sceneUpdatedAt;
  if (edited) {
    // Strictly increasing, so two edits in the same millisecond still count as newer.
    useStore.setState({ sceneUpdatedAt: Math.max(Date.now(), state.sceneUpdatedAt + 1) });
    return; // the nested update above re-enters this listener and schedules the save
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = useStore.getState();
    const current: SceneRecord = {
      id: s.sceneId,
      name: s.sceneName,
      elements: s.elements,
      updatedAt: s.sceneUpdatedAt,
    };
    const scenes = [current, ...s.recents.filter((r) => r.id !== s.sceneId)].slice(
      0,
      MAX_RECENTS
    );
    persistScenes({ version: 1, currentId: s.sceneId, scenes });
  }, 300);
});
