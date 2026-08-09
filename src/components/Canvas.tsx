import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import {
  GRID_SIZE,
  HANDLE_SCREEN_SIZE,
  HIT_THRESHOLD,
  MIN_SIZE,
} from "../constants";
import {
  borderPoint,
  elementCenter,
  getCommonBounds,
  getHandlePoints,
  hitTest,
  rotatePoint,
  screenToWorld,
  worldToScreen,
  anchorToWorld,
  connectionPoints,
  isBindable,
  type HandleName,
} from "../lib/geometry";
import { makeRough, measureText, renderElement, wrapText, LABEL_PAD_X, LABEL_PAD_Y } from "../lib/render";
import type { DrawElement, Point } from "../types";

type Interaction =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; ox: number; oy: number }
  | {
      kind: "move";
      startWorld: Point;
      originals: Record<string, DrawElement>;
    }
  | {
      kind: "resize";
      handle: HandleName;
      original: DrawElement;
    }
  | { kind: "rotate"; original: DrawElement }
  | { kind: "draw-shape"; id: string; startWorld: Point }
  | { kind: "freehand"; id: string }
  | { kind: "endpoint"; id: string; end: "start" | "end" }
  | { kind: "select-box"; startWorld: Point };

interface Editing {
  id: string;
  field: "text" | "label" | "name" | "cell";
  row?: number;
  col?: number;
}

/** Recompute bound arrow endpoints so arrows follow their shapes. */
function reconcileBindings(
  elements: DrawElement[],
  skip: Set<string>
): DrawElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  return elements.map((el) => {
    if (el.type !== "arrow" || skip.has(el.id)) return el;
    const pts = el.points;
    if (!pts || pts.length < 2) return el;
    let start: Point = [el.x + pts[0][0], el.y + pts[0][1]];
    let end: Point = [
      el.x + pts[pts.length - 1][0],
      el.y + pts[pts.length - 1][1],
    ];
    const startEl = el.startBinding ? byId.get(el.startBinding) : undefined;
    const endEl = el.endBinding ? byId.get(el.endBinding) : undefined;
    if (!startEl && !endEl) return el;
    if (startEl)
      start = el.startAnchor
        ? anchorToWorld(startEl, el.startAnchor)
        : borderPoint(startEl, end[0], end[1]);
    if (endEl)
      end = el.endAnchor
        ? anchorToWorld(endEl, el.endAnchor)
        : borderPoint(endEl, start[0], start[1]);
    return {
      ...el,
      x: start[0],
      y: start[1],
      width: end[0] - start[0],
      height: end[1] - start[1],
      points: [
        [0, 0],
        [end[0] - start[0], end[1] - start[1]],
      ],
    };
  });
}

/** Shape element types that can contain a standalone text label on top. */
const CONTAINER_TYPES = new Set(["rectangle", "diamond", "ellipse", "image", "table"]);

/**
 * Expand a selection so that any standalone text element sitting inside a
 * selected shape is grouped with it (so it moves and is selected together).
 */
function withContainedText(elements: DrawElement[], ids: string[]): string[] {
  const idSet = new Set(ids);
  const shapes = elements.filter((e) => idSet.has(e.id) && CONTAINER_TYPES.has(e.type));
  if (shapes.length === 0) return ids;
  const result = [...ids];
  for (const t of elements) {
    if (t.type !== "text" || idSet.has(t.id)) continue;
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    for (const s of shapes) {
      if (cx >= s.x && cx <= s.x + s.width && cy >= s.y && cy <= s.y + s.height) {
        result.push(t.id);
        idSet.add(t.id);
        break;
      }
    }
  }
  return result;
}

export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roughRef = useRef<ReturnType<typeof makeRough> | null>(null);
  const interaction = useRef<Interaction>({ kind: "none" });
  const spaceDown = useRef(false);
  const selectBox = useRef<{ a: Point; b: Point } | null>(null);
  const guides = useRef<Array<[Point, Point]>>([]);
  const anchorHints = useRef<Point[]>([]);
  const snapAnchor = useRef<Point | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const pushedRef = useRef(false);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  const camera = useStore((s) => s.camera);
  const elements = useStore((s) => s.elements);

  // Measure text with the live canvas context.
  const measure = (text: string, fontSize: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return { width: 100, height: fontSize * 1.25 };
    return measureText(ctx, text, fontSize);
  };

  // ---- Rendering loop ----
  useEffect(() => {
    const canvas = canvasRef.current!;
    roughRef.current = makeRough(canvas);
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      sizeRef.current = { w, h };
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const render = () => {
      const st = useStore.getState();
      const cam = st.camera;
      const ctx = canvas.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(
        dpr * cam.zoom,
        0,
        0,
        dpr * cam.zoom,
        cam.offsetX * dpr,
        cam.offsetY * dpr
      );

      const { w, h } = sizeRef.current;
      if (st.gridEnabled && !st.presenting && cam.zoom > 0.35) {
        const tl = screenToWorld(0, 0, cam);
        const br = screenToWorld(w, h, cam);
        ctx.fillStyle = "#dcdce6";
        const r = 1 / cam.zoom;
        for (
          let gx = Math.floor(tl.x / GRID_SIZE) * GRID_SIZE;
          gx < br.x;
          gx += GRID_SIZE
        ) {
          for (
            let gy = Math.floor(tl.y / GRID_SIZE) * GRID_SIZE;
            gy < br.y;
            gy += GRID_SIZE
          ) {
            ctx.beginPath();
            ctx.arc(gx, gy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      const rc = roughRef.current!;
      for (const el of st.elements) {
        if (editing && editing.id === el.id && editing.field !== "cell") {
          // Skip drawing text/label being edited so the overlay is clean.
          const cloneEl = { ...el, text: "", label: "" };
          renderElement(rc, ctx, cloneEl, st.theme);
        } else {
          renderElement(rc, ctx, el, st.theme);
        }
      }

      if (!st.presenting) {
        // Link badges.
        for (const el of st.elements) {
          if (el.link) drawLinkBadge(ctx, el, cam);
        }
        drawSelection(ctx, st.elements, st.selectedIds, cam);
        // Alignment guides (dotted, magnetic).
        ctx.save();
        ctx.strokeStyle = "#e03131";
        ctx.lineWidth = 1 / cam.zoom;
        ctx.setLineDash([6 / cam.zoom, 6 / cam.zoom]);
        for (const [a, b] of guides.current) {
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
        ctx.restore();
        // Arrow connection-point suggestions.
        if (anchorHints.current.length) {
          const r = 4.5 / cam.zoom;
          ctx.save();
          ctx.lineWidth = 1.5 / cam.zoom;
          for (const p of anchorHints.current) {
            ctx.beginPath();
            ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#6965db";
            ctx.fill();
            ctx.stroke();
          }
          if (snapAnchor.current) {
            ctx.beginPath();
            ctx.arc(snapAnchor.current[0], snapAnchor.current[1], r * 1.6, 0, Math.PI * 2);
            ctx.fillStyle = "#6965db";
            ctx.fill();
          }
          ctx.restore();
        }
        // Rubber-band selection box.
        if (selectBox.current) {
          const { a, b } = selectBox.current;
          ctx.save();
          ctx.fillStyle = "rgba(105,101,219,0.08)";
          ctx.strokeStyle = "#6965db";
          ctx.lineWidth = 1 / cam.zoom;
          ctx.fillRect(
            Math.min(a[0], b[0]),
            Math.min(a[1], b[1]),
            Math.abs(b[0] - a[0]),
            Math.abs(b[1] - a[1])
          );
          ctx.strokeRect(
            Math.min(a[0], b[0]),
            Math.min(a[1], b[1]),
            Math.abs(b[0] - a[0]),
            Math.abs(b[1] - a[1])
          );
          ctx.restore();
        }
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function drawSelection(
    ctx: CanvasRenderingContext2D,
    els: DrawElement[],
    ids: string[],
    cam: typeof camera
  ) {
    const sel = els.filter((e) => ids.includes(e.id));
    if (sel.length === 0) return;
    ctx.save();
    ctx.strokeStyle = "#6965db";
    ctx.lineWidth = 1 / cam.zoom;

    if (sel.length === 1) {
      const el = sel[0];
      if (el.type === "line" || el.type === "arrow") {
        const pts = el.points ?? [[0, 0], [el.width, el.height]];
        const s: Point = [el.x + pts[0][0], el.y + pts[0][1]];
        const en: Point = [
          el.x + pts[pts.length - 1][0],
          el.y + pts[pts.length - 1][1],
        ];
        const r = (HANDLE_SCREEN_SIZE / 1.4) / cam.zoom;
        ctx.fillStyle = "#ffffff";
        for (const p of [s, en]) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
        return;
      }
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(el.angle);
      ctx.translate(-cx, -cy);
      const pad = 4 / cam.zoom;
      ctx.strokeRect(
        el.x - pad,
        el.y - pad,
        el.width + pad * 2,
        el.height + pad * 2
      );
      ctx.restore();

      const handles = getHandlePoints(
        { x: el.x - pad, y: el.y - pad, width: el.width + pad * 2, height: el.height + pad * 2 },
        el.angle
      );
      const hs = HANDLE_SCREEN_SIZE / cam.zoom;
      ctx.fillStyle = "#ffffff";
      (Object.keys(handles) as HandleName[]).forEach((k) => {
        const [hx, hy] = handles[k];
        if (k === "rotate") {
          ctx.beginPath();
          ctx.arc(hx, hy, hs / 1.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
          ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
        }
      });
    } else {
      const b = getCommonBounds(sel);
      ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
      ctx.strokeRect(b.x, b.y, b.width, b.height);
    }
    ctx.restore();
  }

  // ---- Pointer helpers ----
  const getPointer = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const handleAtScreen = (
    el: DrawElement,
    sx: number,
    sy: number,
    cam: typeof camera
  ): HandleName | null => {
    const pad = 4 / cam.zoom;
    const handles = getHandlePoints(
      { x: el.x - pad, y: el.y - pad, width: el.width + pad * 2, height: el.height + pad * 2 },
      el.angle
    );
    const radius = HANDLE_SCREEN_SIZE + 3;
    const isLine = el.type === "line" || el.type === "arrow";
    for (const k of Object.keys(handles) as HandleName[]) {
      if (isLine && k !== "nw" && k !== "se") continue;
      if (k === "rotate" && isLine) continue;
      const p = worldToScreen(handles[k][0], handles[k][1], cam);
      if (Math.hypot(p.x - sx, p.y - sy) <= radius) return k;
    }
    return null;
  };

  const arrowEnds = (el: DrawElement): { s: Point; en: Point } => {
    const pts = el.points ?? [[0, 0], [el.width, el.height]];
    return {
      s: [el.x + pts[0][0], el.y + pts[0][1]],
      en: [el.x + pts[pts.length - 1][0], el.y + pts[pts.length - 1][1]],
    };
  };

  const endpointAtScreen = (
    el: DrawElement,
    sx: number,
    sy: number,
    cam: typeof camera
  ): "start" | "end" | null => {
    const { s, en } = arrowEnds(el);
    const radius = HANDLE_SCREEN_SIZE + 4;
    const sp = worldToScreen(s[0], s[1], cam);
    const ep = worldToScreen(en[0], en[1], cam);
    if (Math.hypot(sp.x - sx, sp.y - sy) <= radius) return "start";
    if (Math.hypot(ep.x - sx, ep.y - sy) <= radius) return "end";
    return null;
  };

  /** Find a bindable shape near a world point and its nearest connection point. */
  const anchorScan = (p: Point, excludeId: string) => {
    const st = useStore.getState();
    const zoom = st.camera.zoom;
    const showPad = 28 / zoom;
    const snapDist = 16 / zoom;
    for (let i = st.elements.length - 1; i >= 0; i--) {
      const el = st.elements[i];
      if (el.id === excludeId || !isBindable(el)) continue;
      if (
        p[0] < el.x - showPad ||
        p[0] > el.x + el.width + showPad ||
        p[1] < el.y - showPad ||
        p[1] > el.y + el.height + showPad
      )
        continue;
      const cps = connectionPoints(el);
      let best = cps[0];
      let bd = Infinity;
      for (const cp of cps) {
        const d = Math.hypot(cp.point[0] - p[0], cp.point[1] - p[1]);
        if (d < bd) {
          bd = d;
          best = cp;
        }
      }
      return { el, cps, best, snap: bd <= snapDist };
    }
    return null;
  };

  /** Draw a clickable hyperlink badge at a shape's top-right corner. */
  function drawLinkBadge(
    ctx: CanvasRenderingContext2D,
    el: DrawElement,
    cam: typeof camera
  ) {
    const r = 10 / cam.zoom;
    const bx = el.x + el.width;
    const by = el.y;
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = "#4f46e5";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `${11 / cam.zoom}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u{1F517}", bx, by + 0.5 / cam.zoom);
    ctx.restore();
  }

  const linkBadgeAt = (sx: number, sy: number, cam: typeof camera): string | null => {
    const st = useStore.getState();
    for (let i = st.elements.length - 1; i >= 0; i--) {
      const el = st.elements[i];
      if (!el.link) continue;
      const p = worldToScreen(el.x + el.width, el.y, cam);
      if (Math.hypot(p.x - sx, p.y - sy) <= 12) return el.link;
    }
    return null;
  };

  /** Insert an image element centered in the current viewport. */
  const addImageAtCenter = (dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const st = useStore.getState();
      const { w, h } = sizeRef.current;
      const center = screenToWorld(w / 2, h / 2, st.camera);
      const maxDim = 480;
      let iw = img.naturalWidth || 240;
      let ih = img.naturalHeight || 160;
      const scale = Math.min(1, maxDim / Math.max(iw, ih));
      iw *= scale;
      ih *= scale;
      const el = st.makeElement("image", center.x - iw / 2, center.y - ih / 2);
      el.src = dataUrl;
      el.width = iw;
      el.height = ih;
      st.pushHistory();
      st.addElement(el);
      st.setSelection([el.id]);
      st.setTool("select");
    };
    img.src = dataUrl;
  };

  const elementAt = (wx: number, wy: number): DrawElement | null => {
    const st = useStore.getState();
    const t = HIT_THRESHOLD / st.camera.zoom;
    for (let i = st.elements.length - 1; i >= 0; i--) {
      if (hitTest(st.elements[i], wx, wy, t)) return st.elements[i];
    }
    return null;
  };

  /**
   * Topmost rectangle/diamond/ellipse whose (rotation-aware) box contains the
   * point — even when it has no fill. Used so double-clicking anywhere inside a
   * shape edits its label.
   */
  const containerAt = (wx: number, wy: number): DrawElement | null => {
    const st = useStore.getState();
    for (let i = st.elements.length - 1; i >= 0; i--) {
      const el = st.elements[i];
      if (el.type !== "rectangle" && el.type !== "diamond" && el.type !== "ellipse")
        continue;
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const local = rotatePoint(wx, wy, cx, cy, -el.angle);
      if (
        local[0] >= el.x &&
        local[0] <= el.x + el.width &&
        local[1] >= el.y &&
        local[1] <= el.y + el.height
      )
        return el;
    }
    return null;
  };

  // ---- Pointer down ----
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1) e.preventDefault();
    commitEdit();
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const st = useStore.getState();
    const cam = st.camera;
    const { sx, sy } = getPointer(e);
    const world = screenToWorld(sx, sy, cam);
    const wp: Point = [world.x, world.y];

    // Open hyperlinks via their badge or Alt+click; Ctrl/Cmd+click is reserved
    // for toggling individual elements in a multi-selection.
    if (e.button === 0) {
      const badgeLink = linkBadgeAt(sx, sy, cam);
      if (badgeLink) {
        window.open(badgeLink, "_blank", "noopener,noreferrer");
        return;
      }
      if (e.altKey) {
        const hit = elementAt(world.x, world.y);
        if (hit?.link) {
          window.open(hit.link, "_blank", "noopener,noreferrer");
          return;
        }
      }
    }

    const wantPan =
      st.tool === "pan" || e.button === 1 || (e.button === 0 && spaceDown.current);
    if (wantPan) {
      canvas.style.cursor = "grabbing";
      interaction.current = {
        kind: "pan",
        startX: sx,
        startY: sy,
        ox: cam.offsetX,
        oy: cam.offsetY,
      };
      return;
    }

    if (st.tool === "select") {
      const toggleSelection = e.shiftKey || e.ctrlKey || e.metaKey;
      // Handle grab (single selection).
      if (!toggleSelection && st.selectedIds.length === 1) {
        const el = st.elements.find((x) => x.id === st.selectedIds[0]);
        if (el) {
          if (el.type === "line" || el.type === "arrow") {
            const ep = endpointAtScreen(el, sx, sy, cam);
            if (ep) {
              pushedRef.current = false;
              interaction.current = { kind: "endpoint", id: el.id, end: ep };
              return;
            }
          } else {
            const h = handleAtScreen(el, sx, sy, cam);
            if (h === "rotate") {
              pushedRef.current = false;
              interaction.current = { kind: "rotate", original: el };
              return;
            }
            if (h) {
              pushedRef.current = false;
              interaction.current = { kind: "resize", handle: h, original: el };
              return;
            }
          }
        }
      }
      const hit = elementAt(world.x, world.y);
      if (hit) {
        let ids = st.selectedIds;
        if (toggleSelection) {
          ids = ids.includes(hit.id)
            ? ids.filter((x) => x !== hit.id)
            : [...ids, hit.id];
        } else if (!ids.includes(hit.id)) {
          ids = [hit.id];
        }
        // Group standalone text sitting inside a selected shape so it moves
        // (and is selected) together with the shape.
        ids = withContainedText(st.elements, ids);
        st.setSelection(ids);
        if (toggleSelection) {
          interaction.current = { kind: "none" };
          return;
        }
        pushedRef.current = false;
        const originals: Record<string, DrawElement> = {};
        for (const el of st.elements)
          if (ids.includes(el.id)) originals[el.id] = { ...el };
        interaction.current = { kind: "move", startWorld: wp, originals };
      } else {
        if (e.ctrlKey || e.metaKey) return;
        if (!e.shiftKey) st.setSelection([]);
        selectBox.current = { a: wp, b: wp };
        interaction.current = { kind: "select-box", startWorld: wp };
      }
      return;
    }

    if (st.tool === "draw") {
      const el = st.makeElement("draw", world.x, world.y);
      el.points = [[0, 0]];
      st.pushHistory();
      st.addElement(el);
      interaction.current = { kind: "freehand", id: el.id };
      return;
    }

    // Shape / line / arrow / frame / table creation.
    const el = st.makeElement(st.tool as DrawElement["type"], world.x, world.y);
    let startWorld = wp;
    if (el.type === "arrow") {
      const scan = anchorScan(wp, el.id);
      if (scan && scan.snap) {
        startWorld = scan.best.point;
        el.x = scan.best.point[0];
        el.y = scan.best.point[1];
        el.startBinding = scan.el.id;
        el.startAnchor = scan.best.anchor;
      }
    }
    st.pushHistory();
    st.addElement(el);
    st.setSelection([el.id]);
    interaction.current = { kind: "draw-shape", id: el.id, startWorld };
  };

  // ---- Pointer move ----
  const onPointerMove = (e: React.PointerEvent) => {
    const st = useStore.getState();
    const cam = st.camera;
    const { sx, sy } = getPointer(e);
    const world = screenToWorld(sx, sy, cam);
    const act = interaction.current;

    if (act.kind === "none") {
      updateCursor(sx, sy);
      return;
    }

    if (act.kind === "pan") {
      st.setCamera({
        offsetX: act.ox + (sx - act.startX),
        offsetY: act.oy + (sy - act.startY),
      });
      return;
    }

    if (act.kind === "select-box") {
      selectBox.current = { a: act.startWorld, b: [world.x, world.y] };
      const x1 = Math.min(act.startWorld[0], world.x);
      const y1 = Math.min(act.startWorld[1], world.y);
      const x2 = Math.max(act.startWorld[0], world.x);
      const y2 = Math.max(act.startWorld[1], world.y);
      const ids = st.elements
        .filter((el) => {
          const c = elementCenter(el);
          return c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2;
        })
        .map((el) => el.id);
      st.setSelection(ids);
      return;
    }

    if (act.kind === "freehand") {
      const el = st.elements.find((x) => x.id === act.id);
      if (!el) return;
      const pts = [...(el.points ?? []), [world.x - el.x, world.y - el.y] as Point];
      st.updateElements([el.id], { points: pts });
      return;
    }

    if (act.kind === "draw-shape") {
      const el = st.elements.find((x) => x.id === act.id);
      if (!el) return;
      const [sxw, syw] = act.startWorld;
      let ex = world.x;
      let ey = world.y;
      if (e.shiftKey && (el.type === "line" || el.type === "arrow")) {
        // constrain to horizontal/vertical
        if (Math.abs(ex - sxw) > Math.abs(ey - syw)) ey = syw;
        else ex = sxw;
      }
      if (el.type === "line" || el.type === "arrow") {
        let endBinding: string | null = null;
        let endAnchor: Point | null = null;
        if (el.type === "arrow") {
          const scan = anchorScan([ex, ey], el.id);
          anchorHints.current = scan ? scan.cps.map((c) => c.point) : [];
          snapAnchor.current = scan && scan.snap ? scan.best.point : null;
          if (scan && scan.snap) {
            ex = scan.best.point[0];
            ey = scan.best.point[1];
            endBinding = scan.el.id;
            endAnchor = scan.best.anchor;
          }
        }
        st.updateElements([el.id], {
          x: sxw,
          y: syw,
          width: ex - sxw,
          height: ey - syw,
          points: [
            [0, 0],
            [ex - sxw, ey - syw],
          ],
          endBinding,
          endAnchor,
        });
      } else {
        let w = ex - sxw;
        let hgt = ey - syw;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(hgt));
          w = Math.sign(w || 1) * m;
          hgt = Math.sign(hgt || 1) * m;
        }
        st.updateElements([el.id], {
          x: Math.min(sxw, sxw + w),
          y: Math.min(syw, syw + hgt),
          width: Math.abs(w),
          height: Math.abs(hgt),
        });
      }
      return;
    }

    if (act.kind === "endpoint") {
      const el = st.elements.find((x) => x.id === act.id);
      if (!el) return;
      if (!pushedRef.current) {
        st.pushHistory();
        pushedRef.current = true;
      }
      const { s, en } = arrowEnds(el);
      let moving: Point = [world.x, world.y];
      const fixed: Point = act.end === "start" ? en : s;
      const patch: Partial<DrawElement> = {};
      const scan = anchorScan(moving, el.id);
      anchorHints.current = scan ? scan.cps.map((c) => c.point) : [];
      snapAnchor.current = scan && scan.snap ? scan.best.point : null;
      if (scan && scan.snap) {
        moving = scan.best.point;
        if (act.end === "start") {
          patch.startBinding = scan.el.id;
          patch.startAnchor = scan.best.anchor;
        } else {
          patch.endBinding = scan.el.id;
          patch.endAnchor = scan.best.anchor;
        }
      } else {
        if (act.end === "start") {
          patch.startBinding = null;
          patch.startAnchor = null;
        } else {
          patch.endBinding = null;
          patch.endAnchor = null;
        }
      }
      const s2: Point = act.end === "start" ? moving : fixed;
      const e2: Point = act.end === "start" ? fixed : moving;
      patch.x = s2[0];
      patch.y = s2[1];
      patch.width = e2[0] - s2[0];
      patch.height = e2[1] - s2[1];
      patch.points = [
        [0, 0],
        [e2[0] - s2[0], e2[1] - s2[1]],
      ];
      st.updateElements([el.id], patch);
      return;
    }

    if (act.kind === "move") {
      let dx = world.x - act.startWorld[0];
      let dy = world.y - act.startWorld[1];
      if (!pushedRef.current && (dx !== 0 || dy !== 0)) {
        st.pushHistory();
        pushedRef.current = true;
      }
      const ids = Object.keys(act.originals);
      const snapped = computeSnap(act.originals, ids, dx, dy);
      dx = snapped.dx;
      dy = snapped.dy;
      guides.current = snapped.guides;
      const idSet = new Set(ids);
      let next = st.elements.map((el) => {
        if (!idSet.has(el.id)) return el;
        const o = act.originals[el.id];
        return { ...el, x: o.x + dx, y: o.y + dy };
      });
      next = reconcileBindings(next, idSet);
      st.setElements(next);
      return;
    }

    if (act.kind === "rotate") {
      const o = act.original;
      if (!pushedRef.current) {
        st.pushHistory();
        pushedRef.current = true;
      }
      const cx = o.x + o.width / 2;
      const cy = o.y + o.height / 2;
      let ang = Math.atan2(world.y - cy, world.x - cx) + Math.PI / 2;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      st.updateElements([o.id], { angle: ang });
      return;
    }

    if (act.kind === "resize") {
      if (!pushedRef.current) {
        st.pushHistory();
        pushedRef.current = true;
      }
      resizeElement(act.original, act.handle, world.x, world.y, e.shiftKey, e.altKey);
      return;
    }
  };

  // ---- Pointer up ----
  const onPointerUp = (e: React.PointerEvent) => {
    const st = useStore.getState();
    const act = interaction.current;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (act.kind === "draw-shape") {
      const el = st.elements.find((x) => x.id === act.id);
      if (el) {
        const isLine = el.type === "line" || el.type === "arrow";
        const isClick = isLine
          ? Math.hypot(el.width, el.height) < 4
          : el.width < 2 && el.height < 2;
        if (isClick) {
          // A click without a drag leaves no usable shape: discard the stub
          // but keep the current tool active for the next draw.
          st.setElements(st.elements.filter((x) => x.id !== el.id));
          st.setSelection([]);
        } else {
          // A real drag: switch back to select so the new shape can be
          // adjusted immediately.
          st.setSelection([el.id]);
          st.setTool("select");
        }
      }
    }

    if (act.kind === "freehand") {
      const el = st.elements.find((x) => x.id === act.id);
      if (el && (el.points?.length ?? 0) < 2) {
        // A click without a stroke leaves no usable line: discard the stub
        // but keep the pencil active.
        st.setElements(st.elements.filter((x) => x.id !== el.id));
        st.setSelection([]);
      } else if (el) {
        normalizeFreehand(el.id);
        // Switch back to select once the stroke is complete.
        st.setSelection([el.id]);
        st.setTool("select");
      }
    }

    selectBox.current = null;
    guides.current = [];
    anchorHints.current = [];
    snapAnchor.current = null;
    interaction.current = { kind: "none" };
  };

  const onDoubleClick = (e: React.PointerEvent) => {
    const st = useStore.getState();
    const cam = st.camera;
    const { sx, sy } = getPointer(e);
    const world = screenToWorld(sx, sy, cam);
    const hit = elementAt(world.x, world.y) ?? containerAt(world.x, world.y);
    if (hit && st.selectedIds.length > 1 && st.selectedIds.includes(hit.id)) {
      return;
    }
    if (!hit) {
      const el = st.makeElement("text", world.x, world.y);
      st.pushHistory();
      st.addElement(el);
      st.setSelection([el.id]);
      startEdit(el.id, "text");
      return;
    }
    if (hit.type === "text") {
      st.setSelection([hit.id]);
      startEdit(hit.id, "text");
    } else if (hit.type === "table") {
      const cw = hit.width / (hit.cols ?? 1);
      const ch = hit.height / (hit.rows ?? 1);
      const local = rotatePoint(
        world.x,
        world.y,
        hit.x + hit.width / 2,
        hit.y + hit.height / 2,
        -hit.angle
      );
      const col = Math.min(
        (hit.cols ?? 1) - 1,
        Math.max(0, Math.floor((local[0] - hit.x) / cw))
      );
      const row = Math.min(
        (hit.rows ?? 1) - 1,
        Math.max(0, Math.floor((local[1] - hit.y) / ch))
      );
      st.setSelection([hit.id]);
      startEdit(hit.id, "cell", row, col);
    } else {
      // Edge-to-add: double-click near a bindable shape's edge spawns a
      // connected shape in that direction; interior edits the label.
      if (isBindable(hit) && hit.type !== "frame") {
        const local = rotatePoint(
          world.x,
          world.y,
          hit.x + hit.width / 2,
          hit.y + hit.height / 2,
          -hit.angle
        );
        const band = Math.min(24 / cam.zoom, Math.min(hit.width, hit.height) * 0.3);
        const dLeft = local[0] - hit.x;
        const dRight = hit.x + hit.width - local[0];
        const dTop = local[1] - hit.y;
        const dBottom = hit.y + hit.height - local[1];
        const minEdge = Math.min(dLeft, dRight, dTop, dBottom);
        if (minEdge <= band) {
          let dir: "left" | "right" | "up" | "down" = "right";
          if (minEdge === dRight) dir = "right";
          else if (minEdge === dLeft) dir = "left";
          else if (minEdge === dBottom) dir = "down";
          else dir = "up";
          const newId = st.spawnConnected(hit.id, dir);
          if (newId) startEdit(newId, "label");
          return;
        }
      }
      st.setSelection([hit.id]);
      startEdit(hit.id, hit.type === "frame" ? "name" : "label");
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const st = useStore.getState();
    const cam = st.camera;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      // zoom to cursor
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newZoom = Math.min(30, Math.max(0.1, cam.zoom * factor));
      const wx = (sx - cam.offsetX) / cam.zoom;
      const wy = (sy - cam.offsetY) / cam.zoom;
      st.setCamera({
        zoom: newZoom,
        offsetX: sx - wx * newZoom,
        offsetY: sy - wy * newZoom,
      });
    } else {
      st.setCamera({ offsetX: cam.offsetX - e.deltaX, offsetY: cam.offsetY - e.deltaY });
    }
  };

  // ---- Interaction sub-routines ----
  function resizeElement(
    o: DrawElement,
    handle: HandleName,
    wx: number,
    wy: number,
    keepRatio: boolean,
    fromCenter: boolean
  ) {
    const st = useStore.getState();
    const cx = o.x + o.width / 2;
    const cy = o.y + o.height / 2;
    const pu = rotatePoint(wx, wy, cx, cy, -o.angle); // pointer in unrotated frame

    let nx: number;
    let ny: number;
    let nw: number;
    let nh: number;

    if (fromCenter) {
      // Resize symmetrically about the element center.
      nw = o.width;
      nh = o.height;
      if (handle.includes("e") || handle.includes("w"))
        nw = Math.max(MIN_SIZE, 2 * Math.abs(pu[0] - cx));
      if (handle.includes("s") || handle.includes("n"))
        nh = Math.max(MIN_SIZE, 2 * Math.abs(pu[1] - cy));

      if (keepRatio && o.width && o.height) {
        const ratio = o.width / o.height;
        if (nw / nh > ratio) nw = nh * ratio;
        else nh = nw / ratio;
      }
      // Center stays fixed (world center already at cx,cy).
      nx = cx - nw / 2;
      ny = cy - nh / 2;
    } else {
      let left = o.x;
      let right = o.x + o.width;
      let top = o.y;
      let bottom = o.y + o.height;
      if (handle.includes("e")) right = pu[0];
      if (handle.includes("w")) left = pu[0];
      if (handle.includes("s")) bottom = pu[1];
      if (handle.includes("n")) top = pu[1];

      nx = Math.min(left, right);
      ny = Math.min(top, bottom);
      nw = Math.max(MIN_SIZE, Math.abs(right - left));
      nh = Math.max(MIN_SIZE, Math.abs(bottom - top));

      if (keepRatio && o.width && o.height) {
        const ratio = o.width / o.height;
        if (nw / nh > ratio) nw = nh * ratio;
        else nh = nw / ratio;
      }

      // New center in unrotated frame, mapped back to world.
      const cu: Point = [nx + nw / 2, ny + nh / 2];
      const cw = rotatePoint(cu[0], cu[1], cx, cy, o.angle);
      nx = cw[0] - nw / 2;
      ny = cw[1] - nh / 2;
    }

    const patch: Partial<DrawElement> = { x: nx, y: ny, width: nw, height: nh };
    if (o.points && (o.type === "line" || o.type === "arrow" || o.type === "draw")) {
      const sxr = o.width ? nw / o.width : 1;
      const syr = o.height ? nh / o.height : 1;
      patch.points = o.points.map((p) => [p[0] * sxr, p[1] * syr] as Point);
    }
    let next = st.elements.map((el) => (el.id === o.id ? { ...el, ...patch } : el));
    next = reconcileBindings(next, new Set([o.id]));
    st.setElements(next);
  }

  function computeSnap(
    originals: Record<string, DrawElement>,
    ids: string[],
    dx: number,
    dy: number
  ): { dx: number; dy: number; guides: Array<[Point, Point]> } {
    const st = useStore.getState();
    if (!st.snapEnabled) return { dx, dy, guides: [] };
    const moved = ids.map((id) => {
      const o = originals[id];
      return { ...o, x: o.x + dx, y: o.y + dy };
    });
    const mb = getCommonBounds(moved);
    const movingXs = [mb.x, mb.x + mb.width / 2, mb.x + mb.width];
    const movingYs = [mb.y, mb.y + mb.height / 2, mb.y + mb.height];
    const threshold = 6 / st.camera.zoom;
    const idSet = new Set(ids);
    const targets = st.elements.filter((e) => !idSet.has(e.id));

    let bestX: { delta: number; line: number } | null = null;
    let bestY: { delta: number; line: number } | null = null;
    for (const t of targets) {
      const txs = [t.x, t.x + t.width / 2, t.x + t.width];
      const tys = [t.y, t.y + t.height / 2, t.y + t.height];
      for (const mx of movingXs)
        for (const tx of txs) {
          const d = tx - mx;
          if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.delta)))
            bestX = { delta: d, line: tx };
        }
      for (const my of movingYs)
        for (const ty of tys) {
          const d = ty - my;
          if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.delta)))
            bestY = { delta: d, line: ty };
        }
    }
    const g: Array<[Point, Point]> = [];
    let ndx = dx;
    let ndy = dy;
    if (bestX) {
      ndx += bestX.delta;
      g.push([
        [bestX.line, mb.y - 40],
        [bestX.line, mb.y + mb.height + 40],
      ]);
    }
    if (bestY) {
      ndy += bestY.delta;
      g.push([
        [mb.x - 40, bestY.line],
        [mb.x + mb.width + 40, bestY.line],
      ]);
    }
    return { dx: ndx, dy: ndy, guides: g };
  }

  function normalizeFreehand(id: string) {
    const st = useStore.getState();
    const el = st.elements.find((x) => x.id === id);
    if (!el || !el.points) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of el.points) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    const pts = el.points.map((p) => [p[0] - minX, p[1] - minY] as Point);
    st.updateElements([id], {
      x: el.x + minX,
      y: el.y + minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      points: pts,
    });
  }

  function updateCursor(sx: number, sy: number) {
    const canvas = canvasRef.current!;
    const st = useStore.getState();
    if (st.tool === "pan" || spaceDown.current) {
      canvas.style.cursor = "grab";
      return;
    }
    if (st.tool !== "select") {
      canvas.style.cursor = "crosshair";
      return;
    }
    if (st.selectedIds.length === 1) {
      const el = st.elements.find((x) => x.id === st.selectedIds[0]);
      if (el) {
        const h = handleAtScreen(el, sx, sy, st.camera);
        if (h === "rotate") {
          canvas.style.cursor = "grab";
          return;
        }
        if (h) {
          const map: Record<string, string> = {
            n: "ns-resize",
            s: "ns-resize",
            e: "ew-resize",
            w: "ew-resize",
            ne: "nesw-resize",
            sw: "nesw-resize",
            nw: "nwse-resize",
            se: "nwse-resize",
          };
          canvas.style.cursor = map[h] ?? "default";
          return;
        }
      }
    }
    const world = screenToWorld(sx, sy, st.camera);
    canvas.style.cursor = elementAt(world.x, world.y) ? "move" : "default";
  }

  // ---- Text editing ----
  function startEdit(id: string, field: Editing["field"], row?: number, col?: number) {
    const st = useStore.getState();
    const el = st.elements.find((x) => x.id === id);
    if (!el) return;
    st.pushHistory();
    let value = "";
    if (field === "text") value = el.text ?? "";
    else if (field === "label") value = el.label ?? "";
    else if (field === "name") value = el.name ?? "Frame";
    else value = el.cells?.[row!]?.[col!] ?? "";
    setEditValue(value);
    setEditing({ id, field, row, col });
  }

  function commitEdit() {
    const ed = editing;
    if (!ed) return;
    const st = useStore.getState();
    const el = st.elements.find((x) => x.id === ed.id);
    setEditing(null);
    if (!el) return;
    const value = editValue;
    if (ed.field === "text") {
      if (value.trim() === "") {
        st.setElements(st.elements.filter((x) => x.id !== ed.id));
        return;
      }
      const m = measure(value, el.fontSize);
      st.updateElements([ed.id], { text: value, width: m.width, height: m.height });
    } else if (ed.field === "name") {
      st.updateElements([ed.id], { name: value.trim() || "Frame" });
    } else if (ed.field === "label") {
      if (value.trim() === "") {
        st.updateElements([ed.id], { label: "" });
        return;
      }
      // Shrink the font to fit the shape; if it hits the minimum size, grow
      // the shape (keeping it centered) so the text still fits.
      const fit = fitLabel(el, value);
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const patch: Partial<DrawElement> = {
        label: value,
        fontSize: fit.fontSize,
        width: fit.width,
        height: fit.height,
        x: cx - fit.width / 2,
        y: cy - fit.height / 2,
      };
      let next = st.elements.map((x) => (x.id === ed.id ? { ...x, ...patch } : x));
      next = reconcileBindings(next, new Set());
      st.setElements(next);
    } else {
      const cells = (el.cells ?? []).map((r) => [...r]);
      if (cells[ed.row!]) cells[ed.row!][ed.col!] = value;
      st.updateElements([ed.id], { cells });
    }
  }

  /**
   * Keep the shape's font size and wrap the label over multiple lines to fit
   * the width. If a single word is wider than the shape, widen the shape; then
   * grow the height so all wrapped lines fit. The font is never shrunk.
   */
  function fitLabel(el: DrawElement, label: string) {
    const padX = LABEL_PAD_X;
    const padY = LABEL_PAD_Y;
    const fs = el.fontSize;
    const ctx = canvasRef.current?.getContext("2d");
    const maxW = Math.max(el.width - padX * 2, 8);
    let rows = ctx ? wrapText(ctx, label, fs, maxW) : label.split("\n");
    // Widen the shape if any (unbreakable) line overflows the current width.
    let longest = 0;
    for (const r of rows) longest = Math.max(longest, measure(r, fs).width);
    const width = Math.max(el.width, longest + padX * 2);
    // Re-wrap using the possibly-widened width, then size the height to fit.
    rows = ctx ? wrapText(ctx, label, fs, width - padX * 2) : rows;
    const height = Math.max(el.height, rows.length * fs * 1.25 + padY * 2);
    return { fontSize: fs, width, height };
  }

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  // Space-to-pan tracking.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Paste images from the clipboard and respond to the insert-image button.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = () => addImageAtCenter(reader.result as string);
            reader.readAsDataURL(file);
          }
          return;
        }
      }
    };
    const onInsert = () => fileInputRef.current?.click();
    window.addEventListener("paste", onPaste);
    window.addEventListener("drawesome:insert-image", onInsert as EventListener);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("drawesome:insert-image", onInsert as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => addImageAtCenter(reader.result as string);
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  // ---- Editing overlay position ----
  let overlay: React.ReactNode = null;
  if (editing) {
    const el = elements.find((x) => x.id === editing.id);
    if (el) {
      let wx = el.x;
      let wy = el.y;
      let fontSize = el.fontSize;
      if (editing.field === "name") {
        wx = el.x + 8;
        wy = el.y + 8;
        fontSize = Math.min(24, Math.max(16, el.fontSize));
      } else if (editing.field === "label") {
        const m = measure(editValue || " ", el.fontSize);
        wx = el.x + el.width / 2 - m.width / 2;
        wy = el.y + el.height / 2 - m.height / 2;
      } else if (editing.field === "cell") {
        const cw = el.width / (el.cols ?? 1);
        const ch = el.height / (el.rows ?? 1);
        wx = el.x + (editing.col ?? 0) * cw + 6;
        wy = el.y + (editing.row ?? 0) * ch + 6;
        fontSize = Math.min(el.fontSize, ch - 10);
      }
      const p = worldToScreen(wx, wy, camera);
      overlay = (
        <textarea
          ref={editRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              commitEdit();
            }
            if (e.key === "Enter" && (editing.field === "cell" || e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commitEdit();
            }
            e.stopPropagation();
          }}
          className="absolute z-20 resize-none overflow-hidden border-none bg-transparent p-0 leading-tight outline-none"
          style={{
            left: p.x,
            top: p.y,
            fontSize: fontSize * camera.zoom,
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            color: el.strokeColor,
            minWidth: 40,
            width: Math.max(40, (el.width || 120) * camera.zoom),
            height: Math.max(fontSize * camera.zoom * 1.4, (editing.field === "text" ? 0 : 0) + fontSize * camera.zoom * 1.4),
            lineHeight: 1.25,
            textAlign: editing.field === "cell" ? "left" : el.textAlign ?? "center",
          }}
        />
      );
    }
  }

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick as unknown as React.MouseEventHandler}
        onWheel={onWheel}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
      />
      {overlay}
    </div>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}
