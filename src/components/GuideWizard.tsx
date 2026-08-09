import { useEffect, useState } from "react";

const SEEN_KEY = "drawesome:guide-seen";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-gray-700 shadow-sm">
      {children}
    </kbd>
  );
}

const CORE_STEPS = [
  {
    eyebrow: "Welcome to Drawesome",
    title: "Start with a shape",
    description: "Choose a tool, then drag anywhere on the canvas. Select a shape to move, resize, rotate, or style it.",
    visual: (
      <div className="flex items-center justify-center gap-5" aria-hidden="true">
        <div className="flex h-12 w-12 items-center justify-center rounded-md border-2 border-gray-700 bg-white text-lg">▭</div>
        <span className="text-xl text-gray-400">→</span>
        <div className="flex h-20 w-32 items-center justify-center rounded-md border-2 border-gray-800 bg-blue-50 text-sm font-medium text-gray-700">Your idea</div>
      </div>
    ),
    tip: <>Press <Kbd>R</Kbd> for a rectangle, or double-click empty space to add text.</>,
  },
  {
    eyebrow: "Build a flow",
    title: "Connect ideas naturally",
    description: "Draw an arrow near a shape and drop it on a suggested point. The arrow stays attached when either shape moves.",
    visual: (
      <div className="flex items-center justify-center gap-3" aria-hidden="true">
        <div className="rounded-md border-2 border-gray-700 bg-white px-5 py-3 text-sm font-medium">Start</div>
        <div className="text-2xl text-gray-500">⟶</div>
        <div className="rounded-full border-2 border-gray-700 bg-emerald-50 px-5 py-3 text-sm font-medium">Done</div>
      </div>
    ),
    tip: <>Double-click a shape to name it. Labels wrap and resize automatically.</>,
  },
  {
    eyebrow: "Keep it tidy",
    title: "Organize without the busywork",
    description: "Magnetic guides align nearby shapes as you move them. Use named frames to group sections and present them in order.",
    visual: (
      <div className="mx-auto w-64 rounded-md border border-dashed border-gray-400 bg-white p-3" aria-hidden="true">
        <div className="mb-3 text-left text-xs font-semibold text-gray-600">Customer journey</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-10 rounded border border-gray-500 bg-amber-50" />
          <div className="h-10 rounded border border-gray-500 bg-blue-50" />
        </div>
      </div>
    ),
    tip: <>Double-click a frame title to rename it. Scroll to zoom and hold <Kbd>Space</Kbd> to pan.</>,
  },
  {
    eyebrow: "You’re ready",
    title: "A few shortcuts go a long way",
    description: "Everything is available from the toolbar. These essentials make repeat work faster when you need them.",
    visual: (
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div className="flex items-center justify-between gap-3"><span className="text-gray-600">Select</span><Kbd>V</Kbd></div>
        <div className="flex items-center justify-between gap-3"><span className="text-gray-600">Arrow</span><Kbd>A</Kbd></div>
        <div className="flex items-center justify-between gap-3"><span className="text-gray-600">Undo</span><Kbd>Ctrl Z</Kbd></div>
        <div className="flex items-center justify-between gap-3"><span className="text-gray-600">Frame</span><Kbd>F</Kbd></div>
      </div>
    ),
    tip: <>Select a shape and press <Kbd>Ctrl</Kbd> + an arrow key to create a connected step.</>,
  },
];

const AI_STEPS = [
  {
    eyebrow: "AI guide · Connect",
    title: "Bring your own model",
    description: "Choose Connect AI in the top bar, then add an OpenAI-compatible model, endpoint, and API key. Your settings stay in this browser.",
    visual: (
      <div className="w-full max-w-xs space-y-2" aria-hidden="true">
        <div className="h-8 rounded border border-gray-300 bg-white px-3 py-2 text-left text-[10px] text-gray-400">Model name</div>
        <div className="h-8 rounded border border-gray-300 bg-white px-3 py-2 text-left text-[10px] text-gray-400">Endpoint URL</div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-gray-500">Not connected</span>
          <span className="rounded bg-gray-900 px-3 py-1.5 text-[10px] font-semibold text-white">Save connection</span>
        </div>
      </div>
    ),
    tip: <>Use a restricted API key and a model with vision support if you want to import diagram images.</>,
  },
  {
    eyebrow: "AI guide · Create",
    title: "Describe what you need",
    description: "Once connected, Ask AI appears in the top bar. Describe a new diagram or explain how the current canvas should change.",
    visual: (
      <div className="flex w-full max-w-sm items-center gap-2 rounded-md border border-gray-300 bg-white p-2" aria-hidden="true">
        <span className="text-gray-500">✦</span>
        <span className="flex-1 text-left text-xs text-gray-400">Create an onboarding flow with two outcomes</span>
        <span className="rounded bg-gray-900 px-3 py-1.5 text-[10px] font-semibold text-white">Ask AI</span>
      </div>
    ),
    tip: <>AI returns normal editable shapes, arrows, labels, and frames. Undo works exactly as it does for manual changes.</>,
  },
  {
    eyebrow: "AI guide · Refine",
    title: "Import, refine, and polish",
    description: "Open AI tools to rebuild a diagram from an image, apply a focused change, or polish the layout for presentation.",
    visual: (
      <div className="w-full max-w-xs" aria-hidden="true">
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-md bg-gray-200 p-1 text-[10px]">
          <span className="rounded bg-white px-2 py-1.5 font-medium shadow-sm">Describe</span>
          <span className="px-2 py-1.5 text-gray-500">Import image</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-600">
          <span className="rounded border border-gray-300 bg-white px-3 py-2">Refine scene</span>
          <span className="rounded border border-gray-300 bg-white px-3 py-2">Polish layout</span>
        </div>
      </div>
    ),
    tip: <>You stay in control: disconnect at any time and the full drawing experience remains available.</>,
  },
];

export default function GuideWizard() {
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState<"core" | "ai">("core");
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
  }, []);

  const close = () => {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const steps = track === "core" ? CORE_STEPS : AI_STEPS;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight" && step < steps.length - 1) setStep((current) => current + 1);
      if (event.key === "ArrowLeft" && step > 0) setStep((current) => current - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, step, track]);

  const openGuide = () => {
    setTrack("core");
    setStep(0);
    setOpen(true);
  };

  const steps = track === "core" ? CORE_STEPS : AI_STEPS;
  const current = steps[step];
  const isLast = step === steps.length - 1;

  const goBack = () => {
    if (track === "ai" && step === 0) {
      setTrack("core");
      setStep(CORE_STEPS.length - 1);
      return;
    }
    setStep((currentStep) => currentStep - 1);
  };

  const exploreAI = () => {
    setTrack("ai");
    setStep(0);
  };

  return (
    <>
      {!open && (
        <button title="Open quick guide" aria-label="Open quick guide" onClick={openGuide} className="pointer-events-auto fixed bottom-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-md hover:bg-gray-50">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
      )}

      {open && (
        <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-gray-950/20 p-4 backdrop-blur-[1px]">
          <section role="dialog" aria-modal="true" aria-labelledby="guide-title" className="flex min-h-[470px] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gray-200 bg-[#fbfbfc] shadow-2xl">
            <header className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
              <span className="text-sm font-semibold text-gray-800">{track === "core" ? "Quick guide" : "AI guide"}</span>
              <button onClick={close} title="Close guide" aria-label="Close guide" className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800">✕</button>
            </header>

            <div className="flex flex-1 flex-col px-6 py-6 sm:px-8">
              <div className="mb-6 flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
                {steps.map((item, index) => (
                  <button key={item.title} onClick={() => setStep(index)} aria-label={`Go to step ${index + 1}: ${item.title}`} className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-gray-800" : "bg-gray-200"}`} />
                ))}
              </div>

              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">{current.eyebrow}</p>
              <h2 id="guide-title" className="mt-2 text-2xl font-semibold text-gray-950">{current.title}</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">{current.description}</p>

              <div className="my-6 flex min-h-32 items-center justify-center rounded-md border border-gray-200 bg-gray-50 p-5">
                {current.visual}
              </div>

              <div className="mt-auto rounded-md bg-gray-100 px-3 py-2.5 text-xs leading-5 text-gray-600">{current.tip}</div>
            </div>

            <footer className="flex items-center justify-between border-t border-gray-200 bg-white px-5 py-4">
              <span className="text-xs text-gray-500">{step + 1} of {steps.length}</span>
              <div className="flex items-center gap-2">
                {(step > 0 || track === "ai") && (
                  <button onClick={goBack} className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Back</button>
                )}
                {track === "core" && isLast ? (
                  <>
                    <button onClick={close} className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Start drawing</button>
                    <button onClick={exploreAI} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">Explore AI →</button>
                  </>
                ) : (
                  <button onClick={() => isLast ? close() : setStep((currentStep) => currentStep + 1)} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
                    {isLast ? "Start drawing" : "Next →"}
                  </button>
                )}
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}