import { nanoid } from "nanoid";
import type { DrawElement, StyleDefaults } from "../types";

const BOX_W = 150;
const BOX_H = 72;
const GAP_X = 70;
const GAP_Y = 130;

function baseProps(defaults: StyleDefaults) {
  return {
    angle: 0,
    strokeColor: defaults.strokeColor,
    backgroundColor: "#ffffff",
    fillStyle: defaults.fillStyle,
    strokeWidth: defaults.strokeWidth,
    strokeStyle: defaults.strokeStyle,
    opacity: defaults.opacity,
    fontSize: defaults.fontSize,
  };
}

function makeBox(
  label: string,
  x: number,
  y: number,
  defaults: StyleDefaults
): DrawElement {
  return {
    id: nanoid(),
    type: "rectangle",
    x,
    y,
    width: BOX_W,
    height: BOX_H,
    seed: Math.floor(Math.random() * 2 ** 31),
    label: label.trim(),
    ...baseProps(defaults),
  };
}

function makeArrow(
  from: DrawElement,
  to: DrawElement,
  defaults: StyleDefaults
): DrawElement {
  const fromCx = from.x + from.width / 2;
  const fromCy = from.y + from.height / 2;
  const toCx = to.x + to.width / 2;
  const toCy = to.y + to.height / 2;
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;
  let start: number[];
  let end: number[];
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      start = [from.x + from.width, fromCy];
      end = [to.x, toCy];
    } else {
      start = [from.x, fromCy];
      end = [to.x + to.width, toCy];
    }
  } else {
    if (dy >= 0) {
      start = [fromCx, from.y + from.height];
      end = [toCx, to.y];
    } else {
      start = [fromCx, from.y];
      end = [toCx, to.y + to.height];
    }
  }
  return {
    id: nanoid(),
    type: "arrow",
    x: start[0],
    y: start[1],
    width: end[0] - start[0],
    height: end[1] - start[1],
    seed: Math.floor(Math.random() * 2 ** 31),
    points: [
      [0, 0],
      [end[0] - start[0], end[1] - start[1]],
    ],
    startBinding: from.id,
    endBinding: to.id,
    ...baseProps(defaults),
    backgroundColor: "transparent",
  };
}

/** Split a line into ordered stages; each stage holds comma-separated labels. */
function stagesFromLine(line: string): string[][] {
  const arrowSplit = line
    .split(/\s*(?:->|→|=>|➜)\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);

  if (arrowSplit.length <= 1) {
    const stepMatch = line.match(/(\d+)\s*[-\s]?\s*step/i);
    if (stepMatch) {
      const n = Math.min(8, Math.max(1, parseInt(stepMatch[1], 10)));
      return Array.from({ length: n }, (_, i) => [`Step ${i + 1}`]);
    }
    return [[line.trim()]];
  }

  return arrowSplit.map((seg) =>
    seg
      .split(/\s*,\s*/g)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Turn a natural-language description into shapes + arrows.
 * Supports linear chains, one-to-many / many-to-one / many-to-many
 * (comma-separated labels per stage), "N-step flow", and a trailing branch.
 */
export function generateDiagram(
  text: string,
  originX: number,
  originY: number,
  defaults: StyleDefaults
): DrawElement[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  const rawLines = cleaned
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const lines = rawLines.length ? rawLines : [cleaned];

  const VGAP = 34;
  const out: DrawElement[] = [];
  let bandTop = originY;

  lines.forEach((line) => {
    const wantsBranch = /\bbranch\b/i.test(line);
    const branchLabel = line.match(/(\w+)\s+branch/i)?.[1] ?? "Success";
    const cleanLine = line.replace(/\s*with a[n]?\s+\w+\s+branch/i, "");

    const stages = stagesFromLine(cleanLine);
    const maxCount = Math.max(...stages.map((s) => s.length));
    const bandHeight = maxCount * BOX_H + (maxCount - 1) * VGAP;
    const bandCenter = bandTop + bandHeight / 2;

    let prevStage: DrawElement[] = [];
    stages.forEach((labels, stageIndex) => {
      const x = originX + stageIndex * (BOX_W + GAP_X);
      const stageHeight = labels.length * BOX_H + (labels.length - 1) * VGAP;
      const top = bandCenter - stageHeight / 2;
      const boxes = labels.map((label, i) => {
        const box = makeBox(label, x, top + i * (BOX_H + VGAP), defaults);
        out.push(box);
        return box;
      });
      // Connect every previous-stage box to every current-stage box.
      for (const p of prevStage) {
        for (const c of boxes) out.push(makeArrow(p, c, defaults));
      }
      prevStage = boxes;
    });

    if (wantsBranch && prevStage.length) {
      const last = prevStage[prevStage.length - 1];
      const branch = makeBox(branchLabel, last.x, bandTop + bandHeight + 60, defaults);
      branch.backgroundColor = "#e7f7ec";
      out.push(branch);
      out.push(makeArrow(last, branch, defaults));
    }

    bandTop += bandHeight + GAP_Y;
  });

  return out;
}
