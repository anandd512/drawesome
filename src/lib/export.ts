import rough from "roughjs";
import { getStroke } from "perfect-freehand";
import type { DrawElement, Theme } from "../types";
import { getCommonBounds } from "./geometry";
import { renderElement, svgPathFromStroke, FONT_FAMILY } from "./render";

const PAD = 24;

function download(filename: string, href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function exportJSON(elements: DrawElement[], name?: string) {
  const data = JSON.stringify(
    { type: "drawesome", version: 1, name: name ?? "Untitled", elements },
    null,
    2
  );
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const safe = (name ?? "drawesome").replace(/[^\w.-]+/g, "_") || "drawesome";
  download(`${safe}.json`, url);
  URL.revokeObjectURL(url);
}

export function parseJSON(text: string): DrawElement[] | null {
  try {
    const data = JSON.parse(text);
    if (data && Array.isArray(data.elements)) return data.elements;
    if (Array.isArray(data)) return data;
    return null;
  } catch {
    return null;
  }
}

export function exportPNG(elements: DrawElement[], theme: Theme) {
  if (elements.length === 0) return;
  const b = getCommonBounds(elements);
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((b.width + PAD * 2) * scale));
  canvas.height = Math.max(1, Math.ceil((b.height + PAD * 2) * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-b.x + PAD, -b.y + PAD);
  const rc = rough.canvas(canvas);
  for (const el of elements) renderElement(rc, ctx, el, theme);
  download("drawesome.png", canvas.toDataURL("image/png"));
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textNode(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string,
  anchor: string
): string {
  const lh = fontSize * 1.25;
  const spans = text
    .replace(/\r/g, "")
    .split("\n")
    .map(
      (line, i) =>
        `<tspan x="${x}" dy="${i === 0 ? fontSize : lh}">${esc(line)}</tspan>`
    )
    .join("");
  return `<text x="${x}" y="${y}" font-family='${FONT_FAMILY}' font-size="${fontSize}" fill="${color}" text-anchor="${anchor}">${spans}</text>`;
}

function elementToSvg(el: DrawElement, theme: Theme): string {
  const dash =
    el.strokeStyle === "dashed"
      ? '10 8'
      : el.strokeStyle === "dotted"
      ? '2 6'
      : undefined;
  const sketch = theme === "sketch";
  const generator = rough.generator({ options: { seed: el.seed || 1 } });
  const opts = {
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    roughness: sketch ? 1.1 : 0,
    bowing: sketch ? 1 : 0,
    seed: el.seed || 1,
    preserveVertices: true,
    fill:
      el.backgroundColor !== "transparent" ? el.backgroundColor : undefined,
    fillStyle: el.fillStyle === "hachure" ? "hachure" : "solid",
    strokeLineDash: dash ? dash.split(" ").map(Number) : undefined,
  };

  const parts: string[] = [];
  const roughToPaths = (drawable: ReturnType<typeof generator.rectangle>) => {
    const info = generator.toPaths(drawable);
    for (const p of info) {
      parts.push(
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill || "none"}"${
          dash ? ` stroke-dasharray="${dash}"` : ""
        } />`
      );
    }
  };

  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;

  switch (el.type) {
    case "rectangle":
      roughToPaths(generator.rectangle(el.x, el.y, el.width, el.height, opts));
      break;
    case "diamond":
      roughToPaths(
        generator.polygon(
          [
            [el.x + el.width / 2, el.y],
            [el.x + el.width, el.y + el.height / 2],
            [el.x + el.width / 2, el.y + el.height],
            [el.x, el.y + el.height / 2],
          ],
          opts
        )
      );
      break;
    case "ellipse":
      roughToPaths(generator.ellipse(cx, cy, el.width, el.height, opts));
      break;
    case "line":
    case "arrow": {
      const pts = el.points ?? [];
      for (let i = 0; i < pts.length - 1; i++) {
        roughToPaths(
          generator.line(
            el.x + pts[i][0],
            el.y + pts[i][1],
            el.x + pts[i + 1][0],
            el.y + pts[i + 1][1],
            opts
          )
        );
      }
      if (el.type === "arrow" && pts.length >= 2) {
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const size = Math.max(12, el.strokeWidth * 4);
        const tipX = el.x + b[0];
        const tipY = el.y + b[1];
        const noDash = { ...opts, strokeLineDash: undefined };
        roughToPaths(
          generator.line(
            tipX,
            tipY,
            tipX + size * Math.cos(angle + Math.PI - Math.PI / 7),
            tipY + size * Math.sin(angle + Math.PI - Math.PI / 7),
            noDash
          )
        );
        roughToPaths(
          generator.line(
            tipX,
            tipY,
            tipX + size * Math.cos(angle + Math.PI + Math.PI / 7),
            tipY + size * Math.sin(angle + Math.PI + Math.PI / 7),
            noDash
          )
        );
      }
      break;
    }
    case "draw": {
      const pts = (el.points ?? []).map(
        (p) => [el.x + p[0], el.y + p[1]] as number[]
      );
      const outline = getStroke(pts, {
        size: el.strokeWidth * 2.5,
        thinning: 0.6,
        smoothing: 0.5,
        streamline: 0.5,
      });
      parts.push(
        `<path d="${svgPathFromStroke(outline)}" fill="${el.strokeColor}" />`
      );
      break;
    }
    case "text":
      parts.push(
        textNode(el.text ?? "", el.x, el.y + el.fontSize, el.fontSize, el.strokeColor, "start")
      );
      break;
    case "image":
      if (el.src) {
        parts.push(
          `<image x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" href="${el.src}" preserveAspectRatio="none" />`
        );
      }
      break;
    case "frame":
      parts.push(
        `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="none" stroke="#9aa0b4" stroke-width="1.5" stroke-dasharray="8 6" />`
      );
      parts.push(textNode(el.name ?? "Frame", el.x, el.y - 6, 14, "#6b7080", "start"));
      break;
    case "table": {
      const rows = el.rows ?? 2;
      const cols = el.cols ?? 2;
      const cw = el.width / cols;
      const ch = el.height / rows;
      if (el.backgroundColor !== "transparent") {
        parts.push(
          `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${el.backgroundColor}" />`
        );
      }
      parts.push(
        `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="none" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" />`
      );
      for (let c = 1; c < cols; c++)
        parts.push(
          `<line x1="${el.x + c * cw}" y1="${el.y}" x2="${el.x + c * cw}" y2="${el.y + el.height}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" />`
        );
      for (let r = 1; r < rows; r++)
        parts.push(
          `<line x1="${el.x}" y1="${el.y + r * ch}" x2="${el.x + el.width}" y2="${el.y + r * ch}" stroke="${el.strokeColor}" stroke-width="${el.strokeWidth}" />`
        );
      const cells = el.cells ?? [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const t = cells[r]?.[c] ?? "";
          if (t)
            parts.push(
              textNode(t, el.x + c * cw + 6, el.y + r * ch + 6 + el.fontSize, Math.min(el.fontSize, ch - 10), el.strokeColor, "start")
            );
        }
      break;
    }
  }

  if (el.label && el.type !== "text" && el.type !== "table") {
    parts.push(textNode(el.label, cx, cy, el.fontSize, el.strokeColor, "middle"));
  }

  const transform = el.angle
    ? ` transform="rotate(${(el.angle * 180) / Math.PI} ${cx} ${cy})"`
    : "";
  const opacity = el.opacity < 100 ? ` opacity="${el.opacity / 100}"` : "";
  return `<g${transform}${opacity}>${parts.join("")}</g>`;
}

export function exportSVG(elements: DrawElement[], theme: Theme) {
  if (elements.length === 0) return;
  const b = getCommonBounds(elements);
  const w = Math.ceil(b.width + PAD * 2);
  const h = Math.ceil(b.height + PAD * 2);
  const body = elements.map((el) => elementToSvg(el, theme)).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${
    b.x - PAD
  } ${b.y - PAD} ${w} ${h}"><rect x="${b.x - PAD}" y="${
    b.y - PAD
  }" width="${w}" height="${h}" fill="#ffffff" />\n${body}\n</svg>`;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  download("drawesome.svg", url);
  URL.revokeObjectURL(url);
}
