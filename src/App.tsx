import { useEffect, useState } from "react";
import Canvas from "./components/Canvas";
import Toolbar from "./components/Toolbar";
import StylePanel from "./components/StylePanel";
import TopBar from "./components/TopBar";
import GuideWizard from "./components/GuideWizard";
import RecentsPanel from "./components/RecentsPanel";
import AIPanel from "./components/AIPanel";
import AISettingsPage from "./components/AISettingsPage";
import SignInDialog from "./components/SignInDialog";
import { useStore } from "./store";
import { getCommonBounds } from "./lib/geometry";
import { hasAISettings } from "./lib/ai";
import { initCloud } from "./lib/cloud/auth";
import { useAuth } from "./lib/cloud/session";
import type { DrawElement, Tool } from "./types";

const KEY_TO_TOOL: Record<string, Tool> = {
  v: "select",
  "1": "select",
  r: "rectangle",
  "2": "rectangle",
  d: "diamond",
  "3": "diamond",
  o: "ellipse",
  "4": "ellipse",
  a: "arrow",
  "5": "arrow",
  l: "line",
  "6": "line",
  p: "draw",
  "7": "draw",
  g: "table",
  f: "frame",
  h: "pan",
};

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function frames(elements: DrawElement[]): DrawElement[] {
  return elements
    .filter((e) => e.type === "frame")
    .sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
}

export default function App() {
  const presenting = useStore((s) => s.presenting);
  const [page, setPage] = useState<"canvas" | "settings">("canvas");
  const [aiOpen, setAIOpen] = useState(false);
  const [initialAIPrompt, setInitialAIPrompt] = useState("");
  const [aiConnected, setAIConnected] = useState(hasAISettings);
  const signInOpen = useAuth((s) => s.signInOpen);

  // Optional accounts: restore the session, finish a redirect sign-in, start syncing.
  useEffect(() => {
    initCloud();
  }, []);

  // Fit the camera to a bounds rectangle.
  const fitTo = (b: { x: number; y: number; width: number; height: number }, pad: number) => {
    const st = useStore.getState();
    const zoom = Math.min(
      4,
      Math.max(
        0.1,
        Math.min(
          window.innerWidth / (b.width + pad * 2),
          window.innerHeight / (b.height + pad * 2)
        )
      )
    );
    st.setCamera({
      zoom,
      offsetX: window.innerWidth / 2 - (b.x + b.width / 2) * zoom,
      offsetY: window.innerHeight / 2 - (b.y + b.height / 2) * zoom,
    });
  };

  const gotoFrame = (index: number) => {
    const st = useStore.getState();
    const fr = frames(st.elements);
    if (fr.length === 0) {
      if (st.elements.length) fitTo(getCommonBounds(st.elements), 80);
      return;
    }
    const i = ((index % fr.length) + fr.length) % fr.length;
    st.setFrameIndex(i);
    fitTo(fr[i], 40);
  };

  // Enter presentation -> fit to first frame.
  useEffect(() => {
    if (presenting) gotoFrame(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (st.presenting) {
        if (e.key === "Escape") st.setPresenting(false);
        else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown")
          gotoFrame(st.frameIndex + 1);
        else if (e.key === "ArrowLeft" || e.key === "PageUp")
          gotoFrame(st.frameIndex - 1);
        return;
      }

      if (isTyping(e.target)) return;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        st.selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === "c" && st.selectedIds.length > 0) {
        e.preventDefault();
        st.copySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "v" && st.clipboard.length > 0) {
        e.preventDefault();
        st.pasteClipboard();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        st.duplicateSelected();
        return;
      }
      // Quick-node spawning: Ctrl/Cmd + Arrow spawns a connected shape.
      if (mod && e.key.startsWith("Arrow")) {
        if (st.selectedIds.length === 1) {
          const dir =
            e.key === "ArrowRight"
              ? "right"
              : e.key === "ArrowLeft"
              ? "left"
              : e.key === "ArrowUp"
              ? "up"
              : "down";
          const id = st.spawnConnected(st.selectedIds[0], dir);
          if (id) e.preventDefault();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        st.deleteSelected();
        return;
      }
      if (e.key === "Escape") {
        st.setSelection([]);
        return;
      }
      if (!mod && !e.altKey) {
        const tool = KEY_TO_TOOL[e.key.toLowerCase()];
        if (tool) st.setTool(tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frameElements = frames(useStore((s) => s.elements));
  const frameCount = frameElements.length;
  const frameIndex = useStore((s) => s.frameIndex);

  if (page === "settings") {
    return (
      <AISettingsPage
        onBack={() => setPage("canvas")}
        onConnectionChange={setAIConnected}
      />
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      <Canvas />

      {!presenting && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
            <div className="pointer-events-none w-full max-w-6xl">
              <TopBar
                aiConnected={aiConnected}
                onOpenAI={(prompt = "") => {
                  setInitialAIPrompt(prompt);
                  setAIOpen(true);
                }}
                onOpenSettings={() => setPage("settings")}
              />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center p-3">
            <Toolbar />
          </div>

          <div className="pointer-events-none absolute left-3 top-36 z-10">
            <StylePanel />
          </div>

          <div className="pointer-events-none absolute right-0 top-1/2 z-10 -translate-y-1/2">
            <RecentsPanel />
          </div>

          <GuideWizard />
          {signInOpen && <SignInDialog />}
          {aiConnected && aiOpen && (
            <AIPanel
              initialPrompt={initialAIPrompt}
              onClose={() => setAIOpen(false)}
              onOpenSettings={() => {
                setAIOpen(false);
                setPage("settings");
              }}
            />
          )}
        </>
      )}

      {presenting && (
        <div className="absolute inset-0 z-40">
          <div className="pointer-events-auto absolute inset-0" />
          <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-3 rounded-lg bg-gray-900/85 px-4 py-2 text-sm text-white shadow-lg">
            <span>
              {frameCount > 0
                ? `${frameElements[frameIndex]?.name || "Frame"} · ${frameIndex + 1} / ${frameCount}`
                : "No frames — showing full canvas"}
            </span>
            <button
              onClick={() => useStore.getState().setPresenting(false)}
              className="rounded-md bg-white/20 px-2 py-0.5 hover:bg-white/30"
            >
              Exit (Esc)
            </button>
          </div>
          {frameCount > 0 && (
            <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-gray-900/85 px-3 py-2 text-white shadow-lg">
              <button
                onClick={() => gotoFrame(frameIndex - 1)}
                className="rounded-full px-3 py-1 hover:bg-white/20"
              >
                ← Prev
              </button>
              <button
                onClick={() => gotoFrame(frameIndex + 1)}
                className="rounded-full px-3 py-1 hover:bg-white/20"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
