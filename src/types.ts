export type Tool =
  | "select"
  | "pan"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "line"
  | "arrow"
  | "draw"
  | "text"
  | "frame"
  | "table"
  | "image";

export type ElementType =
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "line"
  | "arrow"
  | "draw"
  | "text"
  | "frame"
  | "table"
  | "image";

export type StrokeStyle = "solid" | "dashed" | "dotted";
export type FillStyle = "transparent" | "solid" | "hachure";
export type Theme = "sketch" | "clean";

export type Point = [number, number];

/** A single drawable element. All geometry is in world coordinates. */
export interface DrawElement {
  id: string;
  type: ElementType;
  /** Bounding-box top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in radians, around the bounding-box center. */
  angle: number;

  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number; // 0..100
  seed: number;

  /** Points relative to (x, y) for line / arrow / draw elements. */
  points?: Point[];

  /** Optional centered label for shapes/frames. */
  label?: string;
  fontSize: number;
  /** Horizontal text alignment for labels / text. */
  textAlign?: "left" | "center" | "right";
  /** Vertical text alignment for labels within a shape. */
  textVAlign?: "top" | "middle" | "bottom";

  /** Text content for standalone text elements. */
  text?: string;

  /** Arrow endpoint bindings (element ids). */
  startBinding?: string | null;
  endBinding?: string | null;
  /** Normalized (0..1) anchor point on the bound shape for each end. */
  startAnchor?: Point | null;
  endAnchor?: Point | null;

  /** Table data. */
  rows?: number;
  cols?: number;
  cells?: string[][];

  /** Frame name (for presentation mode). */
  name?: string;
  /** Optional owning frame for AI-imported architecture layout. */
  frameId?: string;

  /** Optional hyperlink opened on Alt+click. */
  link?: string;

  /** Image source (data URL) for image elements. */
  src?: string;
}

export interface Camera {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface StyleDefaults {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  fontSize: number;
  textAlign: "left" | "center" | "right";
  textVAlign: "top" | "middle" | "bottom";
}
