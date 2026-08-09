import { useEffect, useRef, useState } from "react";
import { generateAIScene, hasAISettings } from "../lib/ai";
import { getCommonBounds } from "../lib/geometry";
import { useStore } from "../store";

interface AIPanelProps {
  initialPrompt: string;
  onClose: () => void;
  onOpenSettings: () => void;
}

export default function AIPanel({ initialPrompt, onClose, onOpenSettings }: AIPanelProps) {
  const [mode, setMode] = useState<"prompt" | "image">("prompt");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const configured = hasAISettings();

  useEffect(() => setPrompt(initialPrompt), [initialPrompt]);

  const fitAll = () => {
    const state = useStore.getState();
    if (!state.elements.length) return;
    const bounds = getCommonBounds(state.elements);
    const pad = 100;
    const zoom = Math.min(2, Math.max(0.1, Math.min(
      window.innerWidth / (bounds.width + pad * 2),
      window.innerHeight / (bounds.height + pad * 2)
    )));
    state.setCamera({
      zoom,
      offsetX: window.innerWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
      offsetY: window.innerHeight / 2 - (bounds.y + bounds.height / 2) * zoom + 45,
    });
  };

  const useFile = (file: File) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setError("Choose a PNG or JPG diagram.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(String(reader.result));
      setImageName(file.name || "Clipboard image");
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const readClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const item = items.find((entry) => entry.types.some((type) => /^image\/(png|jpeg)$/.test(type)));
      const type = item?.types.find((candidate) => /^image\/(png|jpeg)$/.test(candidate));
      if (!item || !type) throw new Error("No PNG or JPG image found on the clipboard.");
      useFile(new File([await item.getType(type)], "Clipboard image", { type }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read the clipboard.");
    }
  };

  const applyAI = async (operation: "generate" | "refine" | "prettify" | "image") => {
    const state = useStore.getState();
    if (operation === "image" && !image) {
      setError("Add a PNG or JPG diagram first.");
      return;
    }
    if ((operation === "refine" || operation === "generate") && !prompt.trim()) {
      setError("Describe the diagram or the change you want.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const elements = await generateAIScene({
        operation,
        instruction: prompt.trim(),
        currentScene: operation === "generate" || operation === "image" ? undefined : state.elements,
        imageDataUrl: operation === "image" ? image ?? undefined : undefined,
        defaults: state.defaults,
      });
      state.loadScene(elements);
      setPrompt("");
      setTimeout(fitAll, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI could not update the scene.");
    } finally {
      setBusy(false);
    }
  };

  const hasScene = useStore((state) => state.elements.length > 0);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex justify-end bg-gray-950/20 backdrop-blur-[1px]" onMouseDown={onClose}>
      <aside className="flex h-full w-full max-w-[440px] flex-col border-l border-gray-200 bg-[#fbfbfc] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between bg-white px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">AI tools</p>
            <h2 className="mt-1 text-xl font-semibold text-gray-900">Diagram assistant</h2>
            <p className="mt-1 text-sm text-gray-500">Create, import, or refine the canvas.</p>
          </div>
          <button onClick={onClose} title="Close AI tools" aria-label="Close AI tools" className="rounded-md p-2 text-gray-500 hover:bg-gray-100">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto border-t border-gray-200 px-6 py-5">
          {!configured && (
            <div className="mb-5 border-l-4 border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
              Connect a model before using AI.
              <button onClick={onOpenSettings} className="mt-3 block font-semibold text-indigo-700 hover:text-indigo-900">Open AI settings →</button>
            </div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-gray-200/70 p-1">
            <button onClick={() => setMode("prompt")} className={`rounded-md px-3 py-2 text-sm font-medium ${mode === "prompt" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>Describe</button>
            <button onClick={() => setMode("image")} className={`rounded-md px-3 py-2 text-sm font-medium ${mode === "image" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>Import image</button>
          </div>

          {mode === "prompt" ? (
            <section>
              <label className="text-sm font-medium text-gray-800">{hasScene ? "What should change?" : "What should the diagram show?"}</label>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={7}
                placeholder="Create a customer onboarding flow with approval and rejection branches..."
                className="mt-2 w-full resize-none rounded-md border border-gray-300 bg-white p-3 text-sm leading-6 outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200"
              />
              <button
                disabled={busy || !configured}
                onClick={() => applyAI(hasScene ? "refine" : "generate")}
                className="mt-3 w-full rounded-md bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Working..." : hasScene ? "Apply prompt to scene" : "Create diagram"}
              </button>
              {hasScene && (
                <p className="mt-2 text-xs leading-5 text-gray-500">Each additional prompt updates the complete editable scene. Undo restores the previous version.</p>
              )}
            </section>
          ) : (
            <section>
              <div
                tabIndex={0}
                onPaste={(event) => {
                  const file = Array.from(event.clipboardData.files).find((candidate) => candidate.type.startsWith("image/"));
                  if (file) useFile(file);
                }}
                className="flex min-h-52 flex-col items-center justify-center overflow-hidden rounded-md border border-dashed border-gray-300 bg-white p-4 text-center focus:border-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-200"
              >
                {image ? <img src={image} alt="Diagram to reconstruct" className="max-h-48 max-w-full object-contain" /> : <><span className="text-3xl">▧</span><p className="mt-3 text-sm font-semibold text-gray-800">Add a diagram picture</p><p className="mt-1 text-xs text-gray-500">PNG or JPG</p></>}
              </div>
              {imageName && <p className="mt-2 truncate text-xs text-gray-500">{imageName}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => fileRef.current?.click()} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50">Choose file</button>
                <button onClick={readClipboard} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50">Paste image</button>
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) useFile(file); event.target.value = ""; }} />
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="Notes about labels or layout" className="mt-3 w-full resize-none rounded-md border border-gray-300 bg-white p-3 text-sm outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200" />
              <button disabled={busy || !configured} onClick={() => applyAI("image")} className="mt-3 w-full rounded-md bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Analyzing and laying out..." : "Import as editable scene"}</button>
            </section>
          )}

          <section className="mt-7 border-t border-gray-200 pt-6">
            <h3 className="text-sm font-medium text-gray-800">Polish layout</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500">Aligns and distributes shapes, normalizes sizing and type, and shortens awkward connectors while preserving scene content.</p>
            <button disabled={busy || !configured || !hasScene} onClick={() => applyAI("prettify")} className="mt-3 w-full rounded-md border border-gray-300 bg-white py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Polishing..." : "Polish current scene"}</button>
          </section>

          {error && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-700">{error}</div>}
        </div>
        <footer className="flex items-center justify-between border-t border-gray-200 bg-white px-6 py-3 text-xs text-gray-500">
          <span>AI changes are undoable</span>
          <button onClick={onOpenSettings} className="font-medium text-gray-700 hover:text-gray-950">Connection settings</button>
        </footer>
      </aside>
    </div>
  );
}