import { useStore } from "../store";
import type { Tool } from "../types";

interface ToolDef {
  tool: Tool;
  label: string;
  icon: string;
  key: string;
  size?: string;
}

const TOOLS: ToolDef[] = [
  { tool: "select", label: "Select", icon: "🖱", key: "V" },
  { tool: "rectangle", label: "Rectangle", icon: "▭", key: "R" },
  { tool: "diamond", label: "Diamond", icon: "◇", key: "D", size: "1.5rem" },
  { tool: "ellipse", label: "Ellipse", icon: "◯", key: "O" },
  { tool: "arrow", label: "Arrow", icon: "↗", key: "A", size: "1.45rem" },
  { tool: "line", label: "Line", icon: "／", key: "L" },
  { tool: "draw", label: "Draw", icon: "✎", key: "P" },
  { tool: "table", label: "Table", icon: "▦", key: "G" },
  { tool: "frame", label: "Frame", icon: "▣", key: "F" },
  { tool: "pan", label: "Pan", icon: "✋", key: "H" },
];

export default function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-gray-200 bg-white/95 px-2 py-1.5 shadow-md backdrop-blur">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          title={`${t.label} (${t.key})`}
          onClick={() => setTool(t.tool)}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none transition ${
            tool === t.tool
              ? "bg-indigo-600 text-white shadow"
              : "text-gray-700 hover:bg-gray-100"
          }`}
          style={t.size ? { fontSize: t.size } : undefined}
        >
          {t.icon}
        </button>
      ))}
      <div className="mx-1 h-6 w-px bg-gray-200" />
      <button
        title="Insert image"
        onClick={() =>
          window.dispatchEvent(new CustomEvent("drawesome:insert-image"))
        }
        className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-gray-700 transition hover:bg-gray-100"
      >
        🖼
      </button>
    </div>
  );
}
