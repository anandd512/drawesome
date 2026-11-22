import { useRef, useState } from "react";
import { useStore } from "../store";
import {
  exportJSON,
  exportPNG,
  exportSVG,
  parseJSON,
} from "../lib/export";
import { getCommonBounds } from "../lib/geometry";
import AccountMenu from "./AccountMenu";

interface TopBarProps {
  aiConnected: boolean;
  onOpenAI: (prompt?: string) => void;
  onOpenSettings: () => void;
}

export default function TopBar({ aiConnected, onOpenAI, onOpenSettings }: TopBarProps) {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const gridEnabled = useStore((s) => s.gridEnabled);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const camera = useStore((s) => s.camera);
  const setCamera = useStore((s) => s.setCamera);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const sceneName = useStore((s) => s.sceneName);
  const setSceneName = useStore((s) => s.setSceneName);
  const renameCurrent = useStore((s) => s.renameCurrent);

  const [prompt, setPrompt] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<null | "new" | "clear">(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fitAll = () => {
    const st = useStore.getState();
    if (st.elements.length === 0) return;
    const b = getCommonBounds(st.elements);
    const pad = 80;
    const zoom = Math.min(
      2,
      Math.max(
        0.1,
        Math.min(
          window.innerWidth / (b.width + pad * 2),
          window.innerHeight / (b.height + pad * 2)
        )
      )
    );
    setCamera({
      zoom,
      offsetX: window.innerWidth / 2 - (b.x + b.width / 2) * zoom,
      offsetY: window.innerHeight / 2 - (b.y + b.height / 2) * zoom,
    });
  };

  const onGenerate = () => {
    const text = prompt.trim();
    if (!text) return;
    onOpenAI(text);
    setPrompt("");
  };

  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const els = parseJSON(String(reader.result));
      if (els) {
        useStore.getState().loadScene(els);
        setSceneName(file.name.replace(/\.json$/i, "") || "Untitled");
        setTimeout(fitAll, 0);
      } else {
        alert("Could not read this file as a Drawesome scene.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const startPresent = () => {
    const st = useStore.getState();
    st.setFrameIndex(0);
    st.setPresenting(true);
  };

  const doNew = () => {
    useStore.getState().newCanvas();
    setCamera({ offsetX: 0, offsetY: 0, zoom: 1 });
  };
  const doClear = () => useStore.getState().clearScene();

  const requestNew = () => {
    if (useStore.getState().elements.length > 0) setPending("new");
    else doNew();
  };
  const requestClear = () => {
    if (useStore.getState().elements.length > 0) setPending("clear");
    else doClear();
  };
  const proceed = (exportFirst: boolean) => {
    const st = useStore.getState();
    if (exportFirst) exportJSON(st.elements, st.sceneName);
    if (pending === "new") doNew();
    else if (pending === "clear") doClear();
    setPending(null);
  };

  const zoomPct = Math.round(camera.zoom * 100);
  const setZoom = (z: number) => {
    const nz = Math.min(30, Math.max(0.1, z));
    setCamera({
      zoom: nz,
      offsetX: window.innerWidth / 2 - ((window.innerWidth / 2 - camera.offsetX) / camera.zoom) * nz,
      offsetY: window.innerHeight / 2 - ((window.innerHeight / 2 - camera.offsetY) / camera.zoom) * nz,
    });
  };

  const btn =
    "flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-gray-700 hover:bg-gray-100";

  return (
    <div className="pointer-events-auto flex items-center gap-2 overflow-x-auto pb-1">
      <div className="flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white/95 px-3 py-1.5 shadow-md backdrop-blur">
        <span className="text-lg">🖊️</span>
        <input
          value={sceneName}
          onChange={(e) => setSceneName(e.target.value)}
          onBlur={(e) => renameCurrent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          spellCheck={false}
          title="Rename scene"
          aria-label="Scene name"
          className="w-36 rounded px-1 font-semibold text-gray-800 outline-none hover:bg-gray-100 focus:bg-gray-100"
        />
      </div>

      {aiConnected && (
        <div className="flex min-w-[300px] flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-white/95 px-2 py-1.5 shadow-md backdrop-blur">
          <span className="pl-1 text-sm text-indigo-600">✦</span>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onGenerate();
            }}
            placeholder="Describe a diagram or change"
            aria-label="Ask AI about the diagram"
            className="min-w-0 flex-1 bg-transparent px-1 text-sm text-gray-800 outline-none placeholder:text-gray-400"
          />
          <button
            onClick={onGenerate}
            disabled={!prompt.trim()}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask AI
          </button>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white/95 px-1.5 py-1.5 shadow-md backdrop-blur">
        {aiConnected && (
          <>
            <button className={btn} title="Open AI diagram studio" onClick={() => onOpenAI()}>
              ✦ AI tools
            </button>
            <div className="mx-0.5 h-6 w-px bg-gray-200" />
          </>
        )}
        <button className={btn} title="Undo (Ctrl+Z)" onClick={undo}>
          ↶
        </button>
        <button className={btn} title="Redo (Ctrl+Y)" onClick={redo}>
          ↷
        </button>
        <div className="mx-0.5 h-6 w-px bg-gray-200" />
        <button className={btn} title="Zoom out" onClick={() => setZoom(camera.zoom / 1.2)}>
          −
        </button>
        <button className="w-12 text-center text-xs text-gray-600" onClick={() => setZoom(1)} title="Reset zoom">
          {zoomPct}%
        </button>
        <button className={btn} title="Zoom in" onClick={() => setZoom(camera.zoom * 1.2)}>
          +
        </button>
        <button className={btn} title="Fit to view" onClick={fitAll}>
          ⤢
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white/95 px-1.5 py-1.5 shadow-md backdrop-blur">
        <button
          className={`${btn} ${theme === "clean" ? "bg-indigo-50 text-indigo-700" : ""}`}
          title="Toggle sketch / clean look"
          onClick={toggleTheme}
        >
          {theme === "sketch" ? "✏️ Sketch" : "📐 Clean"}
        </button>
        <button
          className={`h-8 rounded-lg px-2 text-sm ${
            gridEnabled ? "bg-indigo-50 text-indigo-700" : "text-gray-500"
          } hover:bg-gray-100`}
          title="Toggle grid"
          onClick={toggleGrid}
        >
          ▦
        </button>
        <button className={btn} title="Presentation mode" onClick={startPresent}>
          ▶ Present
        </button>
      </div>

      <div className="relative flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white/95 px-1.5 py-1.5 shadow-md backdrop-blur">
        <button className={btn} title={aiConnected ? "AI model settings" : "Connect AI"} onClick={onOpenSettings}>
          {aiConnected ? "⚙ AI" : "✦ Connect AI"}
        </button>
        <div className="mx-0.5 h-6 w-px bg-gray-200" />
        <button className={btn} onClick={requestNew} title="New canvas">
          ＋ New
        </button>
        <div className="mx-0.5 h-6 w-px bg-gray-200" />
        <button className={btn} onClick={() => setMenuOpen((o) => !o)}>
          ⬇ Export
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-11 z-30 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            onMouseLeave={() => setMenuOpen(false)}
          >
            {[
              ["PNG image", () => exportPNG(useStore.getState().elements, useStore.getState().theme)],
              ["SVG vector", () => exportSVG(useStore.getState().elements, useStore.getState().theme)],
              ["JSON scene", () => exportJSON(useStore.getState().elements, useStore.getState().sceneName)],
            ].map(([label, fn]) => (
              <button
                key={label as string}
                onClick={() => {
                  (fn as () => void)();
                  setMenuOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                {label as string}
              </button>
            ))}
          </div>
        )}
        <button className={btn} onClick={() => fileRef.current?.click()} title="Open a JSON scene">
          ⬆ Open
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onImport}
        />
        <button
          className="h-8 rounded-lg px-2 text-sm text-red-600 hover:bg-red-50"
          title="Clear canvas"
          onClick={requestClear}
        >
          🗑
        </button>
      </div>

      <AccountMenu />

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
            <h2 className="mb-1 text-base font-semibold text-gray-800">
              {pending === "new" ? "Create a new canvas?" : "Clear the canvas?"}
            </h2>
            <p className="mb-4 text-sm text-gray-600">
              Your current canvas has changes that aren't exported. Export it first
              so you don't lose your work?
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                onClick={() => proceed(false)}
              >
                Discard
              </button>
              <button
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                onClick={() => proceed(true)}
              >
                Export first
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
