import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import { getStroke } from "perfect-freehand";
import type { DrawElement, Point, Theme } from "../types";

export const FONT_FAMILY = '"Segoe UI", system-ui, -apple-system, sans-serif';

/** Inner padding used when fitting/wrapping a centered shape label. */
export const LABEL_PAD_X = 16;
export const LABEL_PAD_Y = 12;

/** Cache of decoded images keyed by data-URL source. */
const imageCache = new Map<string, HTMLImageElement>();

export function getImage(src: string): HTMLImageElement {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}


function roughOptions(el: DrawElement, theme: Theme) {
  const sketch = theme === "sketch";
  const dash =
    el.strokeStyle === "dashed"
      ? [10, 8]
      : el.strokeStyle === "dotted"
      ? [2, 6]
      : undefined;
  return {
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    roughness: sketch ? 1.1 : 0,
    bowing: sketch ? 1 : 0,
    seed: el.seed || 1,
    disableMultiStroke: !sketch,
    // Keep exact endpoints/corners so bound arrows still touch shape borders
    // in sketch mode (roughness otherwise wanders the endpoints inward).
    preserveVertices: true,
    strokeLineDash: dash,
    fill:
      el.backgroundColor !== "transparent" ? el.backgroundColor : undefined,
    fillStyle: el.fillStyle === "hachure" ? "hachure" : "solid",
    fillWeight: el.strokeWidth / 2,
  };
}

function lines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n");
}

/**
 * Word-wrap `text` so no line exceeds `maxWidth`, honoring explicit newlines.
 * A single word wider than `maxWidth` is kept on its own line (it overflows).
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  maxWidth: number
): string[] {
  ctx.save();
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  const out: string[] = [];
  for (const para of lines(text)) {
    const words = para.split(" ");
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (cur === "" || ctx.measureText(test).width <= maxWidth) {
        cur = test;
      } else {
        out.push(cur);
        cur = w;
      }
    }
    out.push(cur);
  }
  ctx.restore();
  return out;
}

export function measureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number
): { width: number; height: number } {
  ctx.save();
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  const rows = lines(text.length ? text : " ");
  let width = 0;
  for (const r of rows) width = Math.max(width, ctx.measureText(r).width);
  ctx.restore();
  return { width: Math.ceil(width), height: rows.length * fontSize * 1.25 };
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string,
  align: CanvasTextAlign = "left"
) {
  ctx.save();
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  const lh = fontSize * 1.25;
  lines(text).forEach((line, i) => {
    ctx.fillText(line, x, y + i * lh);
  });
  ctx.restore();
}

function drawArrowhead(
  rc: RoughCanvas,
  from: Point,
  to: Point,
  el: DrawElement,
  theme: Theme
) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const size = Math.max(12, el.strokeWidth * 4);
  const a1 = angle + Math.PI - Math.PI / 7;
  const a2 = angle + Math.PI + Math.PI / 7;
  const opts = { ...roughOptions(el, theme), strokeLineDash: undefined };
  rc.line(to[0], to[1], to[0] + size * Math.cos(a1), to[1] + size * Math.sin(a1), opts);
  rc.line(to[0], to[1], to[0] + size * Math.cos(a2), to[1] + size * Math.sin(a2), opts);
}

export function svgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"] as (string | number)[]
  );
  d.push("Z");
  return d.join(" ");
}

export function renderElement(
  rc: RoughCanvas,
  ctx: CanvasRenderingContext2D,
  el: DrawElement,
  theme: Theme
) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity / 100));
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  if (el.angle) {
    ctx.translate(cx, cy);
    ctx.rotate(el.angle);
    ctx.translate(-cx, -cy);
  }
  const opts = roughOptions(el, theme);

  switch (el.type) {
    case "rectangle":
      rc.rectangle(el.x, el.y, el.width, el.height, opts);
      break;
    case "frame": {
      ctx.save();
      if (el.backgroundColor !== "transparent") {
        ctx.fillStyle = el.backgroundColor;
        ctx.fillRect(el.x, el.y, el.width, el.height);
      }
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = "#9aa0b4";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(el.x, el.y, el.width, el.height);
      ctx.restore();
      if (el.name) {
        drawText(ctx, el.name, el.x + 8, el.y + 8, Math.min(24, Math.max(16, el.fontSize)), "#343846");
      }
      break;
    }
    case "diamond": {
      const pts: Point[] = [
        [el.x + el.width / 2, el.y],
        [el.x + el.width, el.y + el.height / 2],
        [el.x + el.width / 2, el.y + el.height],
        [el.x, el.y + el.height / 2],
      ];
      rc.polygon(pts, opts);
      break;
    }
    case "ellipse":
      rc.ellipse(cx, cy, el.width, el.height, opts);
      break;
    case "line":
    case "arrow": {
      const pts = el.points ?? [];
      if (pts.length >= 2) {
        for (let i = 0; i < pts.length - 1; i++) {
          rc.line(
            el.x + pts[i][0],
            el.y + pts[i][1],
            el.x + pts[i + 1][0],
            el.y + pts[i + 1][1],
            opts
          );
        }
        if (el.type === "arrow") {
          const a = pts[pts.length - 2];
          const b = pts[pts.length - 1];
          drawArrowhead(
            rc,
            [el.x + a[0], el.y + a[1]],
            [el.x + b[0], el.y + b[1]],
            el,
            theme
          );
        }
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
      const path = new Path2D(svgPathFromStroke(outline));
      ctx.fillStyle = el.strokeColor;
      ctx.fill(path);
      break;
    }
    case "text": {
      const halign = el.textAlign ?? "center";
      const rows = lines(el.text ?? "");
      const lh = el.fontSize * 1.25;
      const tx =
        halign === "left"
          ? el.x
          : halign === "right"
          ? el.x + el.width
          : el.x + el.width / 2;
      ctx.save();
      ctx.font = `${el.fontSize}px ${FONT_FAMILY}`;
      ctx.fillStyle = el.strokeColor;
      ctx.textBaseline = "top";
      ctx.textAlign = halign;
      rows.forEach((line, i) => ctx.fillText(line, tx, el.y + i * lh));
      ctx.restore();
      break;
    }
    case "image": {
      if (el.src) {
        const img = getImage(el.src);
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, el.x, el.y, el.width, el.height);
        } else {
          ctx.save();
          ctx.fillStyle = "#eef0f5";
          ctx.fillRect(el.x, el.y, el.width, el.height);
          ctx.strokeStyle = "#c3c8d4";
          ctx.strokeRect(el.x, el.y, el.width, el.height);
          ctx.restore();
        }
      }
      break;
    }
    case "table": {
      const rows = el.rows ?? 2;
      const cols = el.cols ?? 2;
      const cw = el.width / cols;
      const ch = el.height / rows;
      if (el.backgroundColor !== "transparent") {
        ctx.fillStyle = el.backgroundColor;
        ctx.fillRect(el.x, el.y, el.width, el.height);
      }
      ctx.save();
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.strokeRect(el.x, el.y, el.width, el.height);
      for (let c = 1; c < cols; c++) {
        ctx.beginPath();
        ctx.moveTo(el.x + c * cw, el.y);
        ctx.lineTo(el.x + c * cw, el.y + el.height);
        ctx.stroke();
      }
      for (let r = 1; r < rows; r++) {
        ctx.beginPath();
        ctx.moveTo(el.x, el.y + r * ch);
        ctx.lineTo(el.x + el.width, el.y + r * ch);
        ctx.stroke();
      }
      ctx.restore();
      const cells = el.cells ?? [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const txt = cells[r]?.[c] ?? "";
          if (txt) {
            drawText(
              ctx,
              txt,
              el.x + c * cw + 6,
              el.y + r * ch + 6,
              Math.min(el.fontSize, ch - 10),
              el.strokeColor
            );
          }
        }
      }
      break;
    }
  }

  // Centered label for shapes/frames — wraps over multiple lines to fit width.
  if (el.label && el.type !== "text" && el.type !== "table") {
    const maxW = Math.max(el.width - LABEL_PAD_X * 2, 8);
    const rows = wrapText(ctx, el.label, el.fontSize, maxW);
    const lh = el.fontSize * 1.25;
    const totalH = rows.length * lh;
    const halign = el.textAlign ?? "center";
    const valign = el.textVAlign ?? "middle";
    ctx.save();
    ctx.font = `${el.fontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = el.strokeColor;
    ctx.textBaseline = "top";
    ctx.textAlign = halign;
    const tx =
      halign === "left"
        ? el.x + LABEL_PAD_X
        : halign === "right"
        ? el.x + el.width - LABEL_PAD_X
        : cx;
    let ly =
      valign === "top"
        ? el.y + LABEL_PAD_Y
        : valign === "bottom"
        ? el.y + el.height - LABEL_PAD_Y - totalH
        : cy - totalH / 2;
    for (const r of rows) {
      ctx.fillText(r, tx, ly);
      ly += lh;
    }
    ctx.restore();
  }

  ctx.restore();
}

export function makeRough(canvas: HTMLCanvasElement): RoughCanvas {
  return rough.canvas(canvas);
}
