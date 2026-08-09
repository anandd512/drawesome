import { useState } from "react";
import { useStore } from "../store";
import type { SceneRecord } from "../store";

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

export default function RecentsPanel() {
  const [open, setOpen] = useState(false);
  const recents = useStore((s) => s.recents);
  const sceneId = useStore((s) => s.sceneId);
  const sceneName = useStore((s) => s.sceneName);
  const elements = useStore((s) => s.elements);
  const loadRecent = useStore((s) => s.loadRecent);
  const deleteRecent = useStore((s) => s.deleteRecent);

  const current: SceneRecord = {
    id: sceneId,
    name: sceneName,
    elements,
    updatedAt: Date.now(),
  };
  const items = [current, ...recents].slice(0, 10);

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
        {items.map((s) => {
          const isCurrent = s.id === sceneId;
          return (
            <div
              key={s.id}
              onClick={() => {
                if (!isCurrent) loadRecent(s.id);
              }}
              className={`group flex items-center gap-2 px-3 py-2 transition ${
                isCurrent ? "bg-indigo-50" : "cursor-pointer hover:bg-gray-50"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span title="Saved in this browser" className="shrink-0 text-xs">
                    💾
                  </span>
                  <span className="truncate text-sm font-medium text-gray-800">
                    {s.name || "Untitled"}
                  </span>
                  {isCurrent && (
                    <span className="shrink-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      current
                    </span>
                  )}
                </div>
                <div className="mt-0.5 pl-5 text-xs text-gray-500">
                  {relativeTime(s.updatedAt)}
                </div>
              </div>
              {!isCurrent && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRecent(s.id);
                  }}
                  title="Delete from this browser"
                  aria-label={`Delete ${s.name || "Untitled"}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                >
                  🗑
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
