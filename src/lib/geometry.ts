import type { Camera, DrawElement, Point } from "../types";

/** Convert a screen (pixel) point to world coordinates. */
export function screenToWorld(
  sx: number,
  sy: number,
  cam: Camera
): { x: number; y: number } {
  return {
    x: (sx - cam.offsetX) / cam.zoom,
    y: (sy - cam.offsetY) / cam.zoom,
  };
}

/** Convert a world point to screen (pixel) coordinates. */
export function worldToScreen(
  wx: number,
  wy: number,
  cam: Camera
): { x: number; y: number } {
  return {
    x: wx * cam.zoom + cam.offsetX,
    y: wy * cam.zoom + cam.offsetY,
  };
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Center of an element's bounding box in world coordinates. */
export function elementCenter(el: DrawElement): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

/** Rotate point (px,py) around center (cx,cy) by angle radians. */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angle: number
): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Bounding box that wraps a set of elements. */
export function getCommonBounds(elements: DrawElement[]): Bounds {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    // Account for rotation by testing the 4 rotated corners.
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const corners: Point[] = [
      [el.x, el.y],
      [el.x + el.width, el.y],
      [el.x + el.width, el.y + el.height],
      [el.x, el.y + el.height],
    ];
    for (const [px, py] of corners) {
      const [rx, ry] = rotatePoint(px, py, cx, cy, el.angle);
      minX = Math.min(minX, rx);
      minY = Math.min(minY, ry);
      maxX = Math.max(maxX, rx);
      maxY = Math.max(maxY, ry);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Distance from a point to a segment. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Hit test an element with a world point. `threshold` is in world units
 * (already scaled for zoom by the caller).
 */
export function hitTest(
  el: DrawElement,
  wx: number,
  wy: number,
  threshold: number
): boolean {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  // Transform the point into the element's local (unrotated) space.
  const [lx, ly] = rotatePoint(wx, wy, cx, cy, -el.angle);

  if (el.type === "line" || el.type === "arrow" || el.type === "draw") {
    const pts = el.points ?? [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (
        distanceToSegment(
          lx,
          ly,
          el.x + a[0],
          el.y + a[1],
          el.x + b[0],
          el.y + b[1]
        ) <= threshold
      ) {
        return true;
      }
    }
    return false;
  }

  const left = el.x;
  const top = el.y;
  const right = el.x + el.width;
  const bottom = el.y + el.height;
  const filled =
    el.backgroundColor !== "transparent" ||
    el.type === "text" ||
    el.type === "table" ||
    el.type === "image" ||
    !!el.label;

  if (el.type === "ellipse") {
    const rx = el.width / 2 || 1;
    const ry = el.height / 2 || 1;
    const norm = ((lx - cx) / rx) ** 2 + ((ly - cy) / ry) ** 2;
    if (filled) return norm <= 1 + threshold / Math.min(rx, ry);
    return Math.abs(norm - 1) <= (threshold / Math.min(rx, ry)) * 2;
  }

  if (filled) {
    return (
      lx >= left - threshold &&
      lx <= right + threshold &&
      ly >= top - threshold &&
      ly <= bottom + threshold
    );
  }
  // Outline-only rectangle/diamond/frame: hit near the border.
  const nearLeft = Math.abs(lx - left) <= threshold && ly >= top - threshold && ly <= bottom + threshold;
  const nearRight = Math.abs(lx - right) <= threshold && ly >= top - threshold && ly <= bottom + threshold;
  const nearTop = Math.abs(ly - top) <= threshold && lx >= left - threshold && lx <= right + threshold;
  const nearBottom = Math.abs(ly - bottom) <= threshold && lx >= left - threshold && lx <= right + threshold;
  const inside = lx >= left && lx <= right && ly >= top && ly <= bottom;
  if (el.type === "frame") return inside; // frames select from anywhere inside
  return nearLeft || nearRight || nearTop || nearBottom;
}

export type HandleName =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "rotate";

/** Return handle centers in world coordinates (already rotated). */
export function getHandlePoints(
  bounds: Bounds,
  angle: number
): Record<HandleName, Point> {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const raw: Record<HandleName, Point> = {
    nw: [x, y],
    n: [x + width / 2, y],
    ne: [x + width, y],
    e: [x + width, y + height / 2],
    se: [x + width, y + height],
    s: [x + width / 2, y + height],
    sw: [x, y + height],
    w: [x, y + height / 2],
    rotate: [x + width / 2, y - 30],
  };
  const out = {} as Record<HandleName, Point>;
  (Object.keys(raw) as HandleName[]).forEach((k) => {
    out[k] = rotatePoint(raw[k][0], raw[k][1], cx, cy, angle);
  });
  return out;
}

/** Intersection of a ray (from a point toward center) with a box border. */
export function borderPoint(
  el: DrawElement,
  fromX: number,
  fromY: number
): Point {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const dx = fromX - cx;
  const dy = fromY - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = el.width / 2;
  const hh = el.height / 2;
  const scale =
    1 /
    Math.max(Math.abs(dx) / (hw || 1), Math.abs(dy) / (hh || 1));
  return [cx + dx * scale, cy + dy * scale];
}

/** Normalized (0..1) connection points on a shape: corners + edge midpoints. */
export const ANCHOR_POINTS: Point[] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/** World coordinate of a normalized anchor on an element (rotation-aware). */
export function anchorToWorld(el: DrawElement, anchor: Point): Point {
  const px = el.x + anchor[0] * el.width;
  const py = el.y + anchor[1] * el.height;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return rotatePoint(px, py, cx, cy, el.angle);
}

/** All world-space connection points for an element. */
export function connectionPoints(
  el: DrawElement
): Array<{ anchor: Point; point: Point }> {
  return ANCHOR_POINTS.map((a) => ({ anchor: a, point: anchorToWorld(el, a) }));
}

/** Shapes that arrows can bind to. */
export function isBindable(el: DrawElement): boolean {
  return (
    el.type === "rectangle" ||
    el.type === "diamond" ||
    el.type === "ellipse" ||
    el.type === "table" ||
    el.type === "image" ||
    el.type === "frame"
  );
}

