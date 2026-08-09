import { useStore } from "../store";
import { STROKE_COLORS, FILL_COLORS } from "../constants";
import type { DrawElement, FillStyle, StrokeStyle } from "../types";

function Swatch({
  color,
  active,
  onClick,
}: {
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  const transparent = color === "transparent";
  return (
    <button
      onClick={onClick}
      title={color}
      className={`h-6 w-6 rounded-md border ${
        active ? "ring-2 ring-indigo-500 ring-offset-1" : "border-gray-300"
      }`}
      style={
        transparent
          ? {
              backgroundImage:
                "linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)",
              backgroundSize: "8px 8px",
              backgroundPosition: "0 0,0 4px,4px -4px,-4px 0",
            }
          : { background: color }
      }
    />
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </div>
      {children}
    </div>
  );
}

export default function StylePanel() {
  const tool = useStore((s) => s.tool);
  const elements = useStore((s) => s.elements);
  const selectedIds = useStore((s) => s.selectedIds);
  const defaults = useStore((s) => s.defaults);
  const apply = useStore((s) => s.applyStyleToSelected);

  const selected = elements.filter((e) => selectedIds.includes(e.id));
  const single = selected.length === 1 ? selected[0] : null;
  const current = single ?? (defaults as unknown as DrawElement);

  const isDrawing = tool !== "select" && tool !== "pan";
  if (!isDrawing && selected.length === 0) return null;

  const fillable =
    tool === "rectangle" ||
    tool === "diamond" ||
    tool === "ellipse" ||
    tool === "table" ||
    selected.some((e) =>
      ["rectangle", "diamond", "ellipse", "table"].includes(e.type)
    );
  const showFont =
    tool === "text" ||
    (!!single && single.type === "text");
  const textTypes = ["rectangle", "diamond", "ellipse", "text", "line", "arrow", "image"];
  const showAlign =
    ["text", "rectangle", "diamond", "ellipse", "arrow", "line"].includes(tool) ||
    (!!single && textTypes.includes(single.type));

  const modifyTable = (fn: (el: DrawElement) => Partial<DrawElement>) => {
    const st = useStore.getState();
    if (!single || single.type !== "table") return;
    st.pushHistory();
    st.updateElements([single.id], fn(single));
  };

  const renameFrame = (name: string) => {
    const st = useStore.getState();
    if (!single || single.type !== "frame") return;
    const nextName = name.trim() || "Frame";
    if (nextName === single.name) return;
    st.pushHistory();
    st.updateElements([single.id], { name: nextName });
  };

  const addRow = () =>
    modifyTable((t) => {
      const cells = (t.cells ?? []).map((r) => [...r]);
      cells.push(new Array(t.cols ?? 1).fill(""));
      return { cells, rows: (t.rows ?? 1) + 1, height: t.height + t.height / (t.rows ?? 1) };
    });
  const removeRow = () =>
    modifyTable((t) => {
      if ((t.rows ?? 1) <= 1) return {};
      const cells = (t.cells ?? []).slice(0, -1).map((r) => [...r]);
      return { cells, rows: (t.rows ?? 1) - 1, height: t.height - t.height / (t.rows ?? 1) };
    });
  const addCol = () =>
    modifyTable((t) => {
      const cells = (t.cells ?? []).map((r) => [...r, ""]);
      return { cells, cols: (t.cols ?? 1) + 1, width: t.width + t.width / (t.cols ?? 1) };
    });
  const removeCol = () =>
    modifyTable((t) => {
      if ((t.cols ?? 1) <= 1) return {};
      const cells = (t.cells ?? []).map((r) => r.slice(0, -1));
      return { cells, cols: (t.cols ?? 1) - 1, width: t.width - t.width / (t.cols ?? 1) };
    });

  return (
    <div className="pointer-events-auto w-56 space-y-4 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-md backdrop-blur">
      {single?.type === "frame" && (
        <Section title="Frame name">
          <input
            key={`${single.id}:${single.name}`}
            defaultValue={single.name ?? "Frame"}
            onBlur={(event) => renameFrame(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="Frame name"
            className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm font-medium text-gray-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </Section>
      )}

      <Section title="Stroke">
        <div className="flex flex-wrap items-center gap-1.5">
          {STROKE_COLORS.map((c) => (
            <Swatch
              key={c}
              color={c}
              active={current.strokeColor === c}
              onClick={() => apply({ strokeColor: c })}
            />
          ))}
          <input
            type="color"
            value={current.strokeColor}
            onChange={(e) => apply({ strokeColor: e.target.value })}
            className="h-6 w-6 cursor-pointer rounded-md border border-gray-300 bg-white p-0"
            title="Custom color"
          />
        </div>
      </Section>

      {fillable && (
        <Section title="Background">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILL_COLORS.map((c) => (
              <Swatch
                key={c}
                color={c}
                active={current.backgroundColor === c}
                onClick={() => apply({ backgroundColor: c })}
              />
            ))}
            <input
              type="color"
              value={
                current.backgroundColor === "transparent"
                  ? "#ffffff"
                  : current.backgroundColor
              }
              onChange={(e) => apply({ backgroundColor: e.target.value })}
              className="h-6 w-6 cursor-pointer rounded-md border border-gray-300 bg-white p-0"
              title="Custom fill"
            />
          </div>
          {current.backgroundColor !== "transparent" && (
            <div className="mt-1 flex gap-1">
              {(["solid", "hachure"] as FillStyle[]).map((f) => (
                <button
                  key={f}
                  onClick={() => apply({ fillStyle: f })}
                  className={`flex-1 rounded-md border px-2 py-1 text-xs capitalize ${
                    current.fillStyle === f
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="Stroke width">
        <div className="flex gap-1">
          {[1, 2, 4].map((w, i) => (
            <button
              key={w}
              onClick={() => apply({ strokeWidth: w })}
              className={`flex-1 rounded-md border py-1 text-xs ${
                current.strokeWidth === w
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {["Thin", "Bold", "Extra"][i]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Stroke style">
        <div className="flex gap-1">
          {(["solid", "dashed", "dotted"] as StrokeStyle[]).map((s) => (
            <button
              key={s}
              onClick={() => apply({ strokeStyle: s })}
              className={`flex-1 rounded-md border py-1 text-xs capitalize ${
                current.strokeStyle === s
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </Section>

      {showFont && (
        <Section title="Font size">
          <input
            type="range"
            min={12}
            max={64}
            value={current.fontSize}
            onChange={(e) => apply({ fontSize: Number(e.target.value) })}
            className="w-full accent-indigo-600"
          />
        </Section>
      )}

      {showAlign && (
        <Section title="Text align">
          <div className="grid grid-cols-3 gap-1">
            {(["top", "middle", "bottom"] as const).map((v) =>
              (["left", "center", "right"] as const).map((h) => {
                const active =
                  (current.textAlign ?? "center") === h &&
                  (current.textVAlign ?? "middle") === v;
                const justify =
                  v === "top" ? "flex-start" : v === "bottom" ? "flex-end" : "center";
                const items =
                  h === "left" ? "flex-start" : h === "right" ? "flex-end" : "center";
                return (
                  <button
                    key={`${v}-${h}`}
                    title={`${h} ${v}`}
                    onClick={() => apply({ textAlign: h, textVAlign: v })}
                    className={`flex h-8 items-center justify-center rounded-md border ${
                      active
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className="flex h-5 w-5 flex-col gap-[2px]"
                      style={{ justifyContent: justify, alignItems: items }}
                    >
                      <span className="h-[2px] w-4 rounded bg-current" />
                      <span className="h-[2px] w-2.5 rounded bg-current" />
                      <span className="h-[2px] w-4 rounded bg-current" />
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </Section>
      )}

      <Section title="Opacity">
        <input
          type="range"
          min={10}
          max={100}
          value={current.opacity}
          onChange={(e) => apply({ opacity: Number(e.target.value) })}
          className="w-full accent-indigo-600"
        />
      </Section>

      {single?.type === "table" && (
        <Section title="Table">
          <div className="grid grid-cols-2 gap-1">
            <button className="rounded-md border border-gray-200 py-1 text-xs hover:bg-gray-50" onClick={addRow}>
              + Row
            </button>
            <button className="rounded-md border border-gray-200 py-1 text-xs hover:bg-gray-50" onClick={removeRow}>
              − Row
            </button>
            <button className="rounded-md border border-gray-200 py-1 text-xs hover:bg-gray-50" onClick={addCol}>
              + Col
            </button>
            <button className="rounded-md border border-gray-200 py-1 text-xs hover:bg-gray-50" onClick={removeCol}>
              − Col
            </button>
          </div>
        </Section>
      )}

      {single && single.type !== "line" && single.type !== "arrow" && single.type !== "draw" && (
        <Section title="Link">
          <input
            type="url"
            placeholder="https://example.com"
            defaultValue={single.link ?? ""}
            key={single.id}
            onChange={(e) =>
              useStore.getState().updateElements([single.id], {
                link: e.target.value || undefined,
              })
            }
            className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:border-indigo-400"
          />
          <p className="mt-1 text-[10px] text-gray-400">
            Alt+click the shape (or click its badge) to open.
          </p>
        </Section>
      )}
    </div>
  );
}
