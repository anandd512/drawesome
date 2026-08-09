import { nanoid } from "nanoid";
import type { DrawElement, ElementType, StyleDefaults } from "../types";

export interface AISettings {
  model: string;
  endpoint: string;
  apiKey: string;
}

const SETTINGS_KEY = "drawesome:ai-settings";
const ELEMENT_TYPES = new Set<ElementType>([
  "rectangle",
  "diamond",
  "ellipse",
  "line",
  "arrow",
  "draw",
  "text",
  "frame",
  "table",
]);

export function loadAISettings(): AISettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<AISettings>;
    return {
      model: stored.model ?? "",
      endpoint: stored.endpoint ?? "",
      apiKey: stored.apiKey ?? "",
    };
  } catch {
    return { model: "", endpoint: "", apiKey: "" };
  }
}

export function saveAISettings(settings: AISettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function clearAISettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}

export function hasAISettings(): boolean {
  const settings = loadAISettings();
  return Boolean(settings.model.trim() && settings.endpoint.trim() && settings.apiKey.trim());
}

function authHeaders(settings: AISettings): Record<string, string> {
  return settings.endpoint.includes("openai.azure.com")
    ? { "api-key": settings.apiKey }
    : { Authorization: `Bearer ${settings.apiKey}` };
}

function usesResponsesAPI(endpoint: string): boolean {
  try {
    return new URL(endpoint).pathname.replace(/\/$/, "").endsWith("/responses");
  } catch {
    return /\/responses(?:[/?]|$)/i.test(endpoint);
  }
}

function extractResponseText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const result = payload as {
    status?: string;
    incomplete_details?: { reason?: string };
    choices?: Array<{ message?: { content?: string } }>;
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (result.status === "incomplete") {
    throw new Error(
      `The model response was incomplete${
        result.incomplete_details?.reason ? ` (${result.incomplete_details.reason})` : ""
      }. Try a higher-output model or a simpler source image.`
    );
  }
  const chatText = result.choices?.[0]?.message?.content;
  if (chatText) return chatText;
  if (result.output_text) return result.output_text;
  return result.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

export async function testAIConnection(settings: AISettings): Promise<string> {
  const model = settings.model.trim();
  const endpoint = settings.endpoint.trim();
  const apiKey = settings.apiKey.trim();
  if (!model || !endpoint || !apiKey) {
    throw new Error("Enter the model, endpoint, and API key before testing.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders({ model, endpoint, apiKey }),
    },
    body: JSON.stringify(
      usesResponsesAPI(endpoint)
        ? {
            model,
            instructions: "You are a connectivity check. Reply with OK.",
            input: "Reply with OK.",
          }
        : {
            model,
            messages: [
              { role: "system", content: "You are a connectivity check. Reply with OK." },
              { role: "user", content: "Reply with OK." },
            ],
          }
    ),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Connection failed (${response.status}): ${details || response.statusText}`);
  }
  const reply = extractResponseText(await response.json());
  if (!reply) throw new Error("The endpoint responded, but no model reply was returned.");
  return reply.trim();
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sceneForModel(elements: DrawElement[]): object[] {
  return elements.map(({ src: _src, ...element }) => element);
}

function parseModelJSON(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = (fenced ?? content).trim();
  const start = Math.min(
    ...[source.indexOf("{"), source.indexOf("[")].filter((index) => index >= 0)
  );
  if (!Number.isFinite(start)) throw new Error("The model did not return a JSON scene.");
  const candidate = source.slice(start);
  try {
    return JSON.parse(candidate);
  } catch {
    const closing = candidate[0] === "[" ? candidate.lastIndexOf("]") : candidate.lastIndexOf("}");
    if (closing > 0) {
      try {
        return JSON.parse(candidate.slice(0, closing + 1));
      } catch {
        // Fall through to the clearer scene-specific error below.
      }
    }
    throw new Error(
      "The model returned incomplete or invalid scene JSON. Try the import again or use a model with a larger output limit."
    );
  }
}

function normalizeScene(value: unknown, defaults: StyleDefaults): DrawElement[] {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { elements?: unknown }).elements)
      ? (value as { elements: unknown[] }).elements
      : null;
  if (!source) throw new Error("The model response does not contain an elements array.");

  const rawElements = source.filter(
    (item): item is Record<string, unknown> => Boolean(item && typeof item === "object")
  );
  const idMap = new Map<string, string>();
  rawElements.forEach((item) => {
    if (typeof item.id === "string") idMap.set(item.id, nanoid());
  });

  return rawElements.flatMap((item): DrawElement[] => {
    if (typeof item.type !== "string" || !ELEMENT_TYPES.has(item.type as ElementType)) return [];
    const type = item.type as ElementType;
    const generatedId = typeof item.id === "string" ? idMap.get(item.id) : undefined;
    const width = finite(item.width, type === "text" ? 180 : 160);
    const height = finite(item.height, type === "text" ? 40 : 80);
    const points = Array.isArray(item.points)
      ? item.points.flatMap((point): [number, number][] =>
          Array.isArray(point) && point.length >= 2
            ? [[finite(point[0], 0), finite(point[1], 0)]]
            : []
        )
      : undefined;
    const startBinding = typeof item.startBinding === "string" ? idMap.get(item.startBinding) : undefined;
    const endBinding = typeof item.endBinding === "string" ? idMap.get(item.endBinding) : undefined;

    const element: DrawElement = {
      id: generatedId ?? nanoid(),
      type,
      x: finite(item.x, 0),
      y: finite(item.y, 0),
      width,
      height,
      angle: finite(item.angle, 0),
      strokeColor: typeof item.strokeColor === "string" ? item.strokeColor : defaults.strokeColor,
      backgroundColor:
        typeof item.backgroundColor === "string" ? item.backgroundColor : "#ffffff",
      fillStyle:
        item.fillStyle === "transparent" || item.fillStyle === "hachure"
          ? item.fillStyle
          : "solid",
      strokeWidth: Math.max(1, finite(item.strokeWidth, defaults.strokeWidth)),
      strokeStyle:
        item.strokeStyle === "dashed" || item.strokeStyle === "dotted"
          ? item.strokeStyle
          : "solid",
      opacity: Math.min(100, Math.max(0, finite(item.opacity, 100))),
      seed: Math.floor(Math.random() * 2 ** 31),
      fontSize: Math.min(48, Math.max(12, finite(item.fontSize, defaults.fontSize))),
      label: typeof item.label === "string" ? item.label : undefined,
      text: typeof item.text === "string" ? item.text : undefined,
      textAlign:
        item.textAlign === "left" || item.textAlign === "right" ? item.textAlign : "center",
      textVAlign:
        item.textVAlign === "top" || item.textVAlign === "bottom" ? item.textVAlign : "middle",
      points,
      startBinding,
      endBinding,
      startAnchor: startBinding ? [1, 0.5] : undefined,
      endAnchor: endBinding ? [0, 0.5] : undefined,
      name: typeof item.name === "string" ? item.name : undefined,
      frameId: typeof item.frameId === "string" ? idMap.get(item.frameId) : undefined,
      rows: finite(item.rows, 0) || undefined,
      cols: finite(item.cols, 0) || undefined,
      cells: Array.isArray(item.cells)
        ? item.cells.map((row) => (Array.isArray(row) ? row.map(String) : []))
        : undefined,
    };

    if ((type === "line" || type === "arrow" || type === "draw") && !element.points?.length) {
      element.points = [[0, 0], [width, height]];
    }
    if (type === "line" || type === "arrow" || type === "draw" || type === "text" || type === "frame") {
      element.backgroundColor = "transparent";
    }
    return [element];
  });
}

function reconnectArrow(
  arrow: DrawElement,
  byId: Map<string, DrawElement>,
  obstacles: DrawElement[] = []
): DrawElement {
  const start = arrow.startBinding ? byId.get(arrow.startBinding) : undefined;
  const end = arrow.endBinding ? byId.get(arrow.endBinding) : undefined;
  if (!start || !end) return arrow;
  const startCx = start.x + start.width / 2;
  const startCy = start.y + start.height / 2;
  const endCx = end.x + end.width / 2;
  const endCy = end.y + end.height / 2;
  const horizontal = Math.abs(endCx - startCx) >= Math.abs(endCy - startCy);
  const startAnchor: [number, number] = horizontal
    ? [endCx >= startCx ? 1 : 0, 0.5]
    : [0.5, endCy >= startCy ? 1 : 0];
  const endAnchor: [number, number] = horizontal
    ? [endCx >= startCx ? 0 : 1, 0.5]
    : [0.5, endCy >= startCy ? 0 : 1];
  const startPoint: [number, number] = [
    start.x + startAnchor[0] * start.width,
    start.y + startAnchor[1] * start.height,
  ];
  const endPoint: [number, number] = [
    end.x + endAnchor[0] * end.width,
    end.y + endAnchor[1] * end.height,
  ];
  let points: [number, number][] = [[0, 0], [endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]]];
  if (horizontal) {
    const minX = Math.min(startPoint[0], endPoint[0]);
    const maxX = Math.max(startPoint[0], endPoint[0]);
    const blocker = obstacles.find(
      (element) =>
        element.id !== start.id &&
        element.id !== end.id &&
        element.x < maxX &&
        element.x + element.width > minX &&
        startPoint[1] > element.y - 16 &&
        startPoint[1] < element.y + element.height + 16
    );
    if (blocker) {
      const above = blocker.y - 24;
      const below = blocker.y + blocker.height + 24;
      const routeY = Math.abs(startPoint[1] - above) <= Math.abs(startPoint[1] - below) ? above : below;
      const midX = (startPoint[0] + endPoint[0]) / 2;
      points = [
        [0, 0],
        [midX - startPoint[0], routeY - startPoint[1]],
        [endPoint[0] - startPoint[0], routeY - startPoint[1]],
        [endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]],
      ];
    }
  }
  return {
    ...arrow,
    x: startPoint[0],
    y: startPoint[1],
    width: endPoint[0] - startPoint[0],
    height: endPoint[1] - startPoint[1],
    points,
    startAnchor,
    endAnchor,
  };
}

function cleanImportedScene(elements: DrawElement[]): DrawElement[] {
  const zoneColors = ["#eef4ff", "#edf9f2", "#fff8e8", "#f7f1ff"];
  const meaningful = elements.filter((element) => {
    if (element.type === "frame") return Boolean(element.name?.trim() || element.label?.trim());
    if (element.type === "text") return Boolean(element.text?.trim());
    return true;
  });
  const frames: DrawElement[] = [];
  const connectors: DrawElement[] = [];
  const content: DrawElement[] = [];
  const originalFramePositions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const duplicateIds = new Map<string, string>();
  const contentByText = new Map<string, DrawElement>();

  for (const original of meaningful) {
    const element = { ...original, angle: 0 };
    if (element.type === "frame") {
      originalFramePositions.set(element.id, {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      });
      element.name = element.name?.trim() || element.label?.trim();
      element.label = undefined;
      if (element.backgroundColor === "transparent" || element.backgroundColor === "#ffffff") {
        element.backgroundColor = zoneColors[frames.length % zoneColors.length];
      }
      element.fontSize = Math.min(24, Math.max(18, element.fontSize));
      frames.push(element);
      continue;
    }
    if (element.type === "arrow" || element.type === "line") {
      connectors.push(element);
      continue;
    }

    const label = element.label?.trim();
    const text = element.text?.trim();
    if (label) {
      element.label = label;
      element.fontSize = 16;
      element.width = Math.max(element.width, Math.min(260, Math.max(150, label.length * 7.5)));
      const estimatedLines = Math.max(1, Math.ceil((label.length * 8) / Math.max(100, element.width - 24)));
      element.height = Math.max(element.height, 40 + estimatedLines * 20);
      if (element.backgroundColor === "transparent" || element.backgroundColor === "#ffffff") {
        element.backgroundColor =
          element.type === "diamond" ? "#fff4d6" : element.type === "ellipse" ? "#e4f0ff" : "#eef4ff";
      }
    } else if (element.type === "text" && text) {
      element.text = text;
      element.fontSize = Math.min(28, Math.max(16, element.fontSize));
      const textLines = text.split("\n");
      const longestLine = Math.max(...textLines.map((line) => line.length));
      element.width = Math.max(element.width, Math.min(420, longestLine * element.fontSize * 0.62));
      element.height = Math.max(element.height, textLines.length * element.fontSize * 1.35);
      element.textAlign = "left";
    }
    const key = (label || text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (key) {
      const duplicate = contentByText.get(key);
      if (duplicate) {
        duplicateIds.set(element.id, duplicate.id);
        continue;
      }
      contentByText.set(key, element);
    }
    content.push(element);
  }

  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const childrenByFrame = new Map(frames.map((frame) => [frame.id, [] as DrawElement[]]));
  const unframed: DrawElement[] = [];
  for (const element of content) {
    let frame = element.frameId ? frameById.get(element.frameId) : undefined;
    if (!frame) {
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      frame = frames
        .filter((candidate) => {
          const source = originalFramePositions.get(candidate.id)!;
          return (
            centerX >= source.x &&
            centerX <= source.x + source.width &&
            centerY >= source.y &&
            centerY <= source.y + source.height
          );
        })
        .sort((a, b) => {
          const aSource = originalFramePositions.get(a.id)!;
          const bSource = originalFramePositions.get(b.id)!;
          return aSource.width * aSource.height - bSource.width * bSource.height;
        })[0];
    }
    if (!frame && frames.length) {
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      frame = [...frames].sort((a, b) => {
        const aSource = originalFramePositions.get(a.id)!;
        const bSource = originalFramePositions.get(b.id)!;
        const aDistance = Math.hypot(centerX - (aSource.x + aSource.width / 2), centerY - (aSource.y + aSource.height / 2));
        const bDistance = Math.hypot(centerX - (bSource.x + bSource.width / 2), centerY - (bSource.y + bSource.height / 2));
        return aDistance - bDistance;
      })[0];
    }
    if (frame) {
      element.frameId = frame.id;
      childrenByFrame.get(frame.id)!.push(element);
    } else {
      unframed.push(element);
    }
  }

  const activeFrames = frames.filter((frame) => childrenByFrame.get(frame.id)!.length > 0);
  const frameLayouts = activeFrames.map((frame) => {
    const children = childrenByFrame.get(frame.id)!.sort((a, b) =>
      Math.abs(a.y - b.y) > 30 ? a.y - b.y : a.x - b.x
    );
    const columns = children.length === 1 ? 1 : children.length <= 4 ? 2 : 3;
    const rows = Math.ceil(children.length / columns);
    const cellWidth = Math.max(180, ...children.map((child) => child.width));
    const cellHeight = Math.max(72, ...children.map((child) => child.height));
    frame.width = 80 + columns * cellWidth + (columns - 1) * 50;
    frame.height = 100 + rows * cellHeight + (rows - 1) * 40;
    return { frame, children, columns, cellWidth, cellHeight };
  });

  const rows: Array<{ anchorY: number; layouts: typeof frameLayouts; height: number; width: number }> = [];
  for (const layout of frameLayouts.sort((a, b) => {
    const aSource = originalFramePositions.get(a.frame.id)!;
    const bSource = originalFramePositions.get(b.frame.id)!;
    return Math.abs(aSource.y - bSource.y) > 120 ? aSource.y - bSource.y : aSource.x - bSource.x;
  })) {
    const sourceY = originalFramePositions.get(layout.frame.id)!.y;
    const row = rows.find((candidate) => Math.abs(candidate.anchorY - sourceY) <= 120);
    if (row) {
      row.layouts.push(layout);
      row.height = Math.max(row.height, layout.frame.height);
      row.width += 80 + layout.frame.width;
    } else {
      rows.push({ anchorY: sourceY, layouts: [layout], height: layout.frame.height, width: layout.frame.width });
    }
  }

  const maxRowWidth = Math.max(0, ...rows.map((row) => row.width));
  let rowY = 60;
  for (const row of rows) {
    let frameX = 60 + (maxRowWidth - row.width) / 2;
    for (const layout of row.layouts) {
      const { frame, children, columns, cellWidth, cellHeight } = layout;
      frame.x = Math.round(frameX / 10) * 10;
      frame.y = Math.round(rowY / 10) * 10;
      children.forEach((child, index) => {
        const column = index % columns;
        const childRow = Math.floor(index / columns);
        child.x = Math.round((frame.x + 40 + column * (cellWidth + 50) + (cellWidth - child.width) / 2) / 10) * 10;
        child.y = Math.round((frame.y + 60 + childRow * (cellHeight + 40) + (cellHeight - child.height) / 2) / 10) * 10;
      });
      frameX += frame.width + 80;
    }
    rowY += row.height + 80;
  }

  if (unframed.length) {
    const startY = rows.length ? rowY : 60;
    unframed.forEach((element, index) => {
      element.x = 60 + (index % 3) * 310;
      element.y = startY + Math.floor(index / 3) * 140;
    });
  }

  const laidOutContent = [...activeFrames.flatMap((frame) => childrenByFrame.get(frame.id)!), ...unframed];
  const byId = new Map([...activeFrames, ...laidOutContent].map((element) => [element.id, element]));
  const laidOutConnectors = connectors.flatMap((connector): DrawElement[] => {
    const startBinding = connector.startBinding
      ? duplicateIds.get(connector.startBinding) ?? connector.startBinding
      : connector.startBinding;
    const endBinding = connector.endBinding
      ? duplicateIds.get(connector.endBinding) ?? connector.endBinding
      : connector.endBinding;
    if (!startBinding || !endBinding || !byId.has(startBinding) || !byId.has(endBinding)) return [];
    return [reconnectArrow({ ...connector, startBinding, endBinding }, byId, laidOutContent)];
  });
  return [...activeFrames, ...laidOutConnectors, ...laidOutContent];
}

const SYSTEM_PROMPT = `You are the layout engine for Drawesome, an editable diagram canvas.
Return only valid JSON with this shape: {"elements": DrawElement[]}.
Use only rectangle, diamond, ellipse, text, arrow, line, frame, and table elements.
Keep the JSON compact. Every element needs only id, type, x, y, width, and height. Omit default styling fields unless a non-default value is visually important.
Shapes use label. Standalone text is only for section titles or important annotations; put service and process names in shape labels. Every non-frame element inside a zone must set frameId to that frame's id. Arrows use points relative to x/y and must include startBinding and endBinding IDs when connected.
Create a polished presentation layout on a 1200x800 canvas: align to a grid, use 160x80 or larger process shapes, use 16px labels and 24-28px section titles, distribute peers evenly with at least 60px gaps, keep arrow lengths consistent, avoid all overlaps and crossings, and use restrained accessible fill colors.
For image reconstruction, first identify the source's high-level zones and assign every node to exactly one zone with frameId. Reproduce the architecture and hierarchy rather than tracing pixels or every OCR fragment. Preserve the source's relative zone placement and main visual grouping. Consolidate related words into one concise label and never repeat a node. Preserve every meaningful system, data store, person, zone, and relationship; omit only logos and purely decorative marks. Use frame only for meaningful high-level zones, always set its name and a distinct very light backgroundColor, and never create an unnamed frame. Use labeled rectangles for nested groups. Reconstruct images as editable primitives; do not return image elements.`;

const EXTRACTION_PROMPT = `Analyze the supplied architecture diagram and return only valid JSON.
This is semantic extraction, not visual layout. Use this exact structure:
{"zones":[{"id":"zone-id","name":"Zone title","row":0,"column":0}],"nodes":[{"id":"node-id","zoneId":"zone-id","label":"Exact readable label","kind":"process|data-store|person|repository|group|source|output"}],"edges":[{"id":"edge-id","from":"node-id","to":"node-id","label":"Relationship label","style":"solid|dashed","direction":"forward|both"}]}
Read the full image carefully at high detail. Preserve every meaningful labeled component and every visible relationship. Do not merge distinct nodes, invent nodes, infer unsupported relationships, or move a node to a different zone. Small repeated source items may be represented as one group node only when the original visibly groups them. Zone row and column must preserve the image's major top/bottom and left/right arrangement. Use stable unique IDs. Every edge endpoint must reference a node ID. Omit logos and purely decorative lines only.`;

interface ExtractedDiagram {
  zones: Array<{ id: string; name: string; row: number; column: number }>;
  nodes: Array<{
    id: string;
    zoneId: string;
    label: string;
    kind: "process" | "data-store" | "person" | "repository" | "group" | "source" | "output";
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    label?: string;
    style?: "solid" | "dashed";
    direction?: "forward" | "both";
  }>;
}

function normalizeExtraction(value: unknown): ExtractedDiagram {
  if (!value || typeof value !== "object") throw new Error("The model did not return a semantic diagram.");
  const source = value as Partial<ExtractedDiagram>;
  if (!Array.isArray(source.zones) || !Array.isArray(source.nodes) || !Array.isArray(source.edges)) {
    throw new Error("The semantic extraction is missing zones, nodes, or edges.");
  }
  const zones = source.zones.filter(
    (zone) => zone && typeof zone.id === "string" && typeof zone.name === "string"
  );
  const zoneIds = new Set(zones.map((zone) => zone.id));
  const nodes = source.nodes.filter(
    (node) =>
      node &&
      typeof node.id === "string" &&
      typeof node.label === "string" &&
      typeof node.zoneId === "string" &&
      zoneIds.has(node.zoneId)
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = source.edges.filter(
    (edge) =>
      edge &&
      typeof edge.id === "string" &&
      typeof edge.from === "string" &&
      typeof edge.to === "string" &&
      nodeIds.has(edge.from) &&
      nodeIds.has(edge.to)
  );
  if (!zones.length || !nodes.length) throw new Error("The model could not identify the diagram's zones and components.");
  return { zones, nodes, edges };
}

function imageExtractionRequest(settings: AISettings, imageDataUrl: string, instruction: string): object {
  const endpoint = settings.endpoint.trim();
  const text = `${EXTRACTION_PROMPT}\nUser clarification: ${instruction || "None."}`;
  return usesResponsesAPI(endpoint)
    ? {
        model: settings.model.trim(),
        instructions: EXTRACTION_PROMPT,
        max_output_tokens: 16000,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: `User clarification: ${instruction || "None."}` },
              { type: "input_image", image_url: imageDataUrl, detail: "high" },
            ],
          },
        ],
      }
    : {
        model: settings.model.trim(),
        max_tokens: 16000,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text },
              { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
            ],
          },
        ],
      };
}

function layoutExtractionRequest(settings: AISettings, extraction: ExtractedDiagram): object {
  const endpoint = settings.endpoint.trim();
  const instruction = `${SYSTEM_PROMPT}\nConvert the semantic graph below to a Drawesome scene. This graph is authoritative: include every zone, node, and edge exactly once. Preserve each node's zoneId as frameId. Preserve zone row/column arrangement. Do not add, remove, merge, rename, or reconnect anything. Edge labels may be standalone text near their arrow.\nSemantic graph:\n${JSON.stringify(extraction)}`;
  return usesResponsesAPI(endpoint)
    ? {
        model: settings.model.trim(),
        instructions: SYSTEM_PROMPT,
        max_output_tokens: 20000,
        input: instruction,
      }
    : {
        model: settings.model.trim(),
        max_tokens: 20000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: instruction },
        ],
      };
}

function sceneFromExtraction(extraction: ExtractedDiagram, defaults: StyleDefaults): DrawElement[] {
  const zoneColors = ["#eef4ff", "#edf9f2", "#fff8e8", "#f7f1ff", "#eef8f8"];
  const frameIds = new Map(extraction.zones.map((zone) => [zone.id, nanoid()]));
  const nodeIds = new Map(extraction.nodes.map((node) => [node.id, nanoid()]));
  const frames: DrawElement[] = extraction.zones.map((zone, index) => ({
    id: frameIds.get(zone.id)!,
    type: "frame",
    name: zone.name.trim(),
    x: 60 + finite(zone.column, 0) * 600,
    y: 60 + finite(zone.row, 0) * 500,
    width: 520,
    height: 400,
    angle: 0,
    strokeColor: "#596579",
    backgroundColor: zoneColors[index % zoneColors.length],
    fillStyle: "solid",
    strokeWidth: 1.5,
    strokeStyle: "dashed",
    opacity: 100,
    seed: Math.floor(Math.random() * 2 ** 31),
    fontSize: 20,
  }));
  const frameByZone = new Map(extraction.zones.map((zone, index) => [zone.id, frames[index]]));
  const countsByZone = new Map<string, number>();
  const nodes: DrawElement[] = extraction.nodes.map((node) => {
    const frame = frameByZone.get(node.zoneId)!;
    const index = countsByZone.get(node.zoneId) ?? 0;
    countsByZone.set(node.zoneId, index + 1);
    const type: ElementType =
      node.kind === "person" || node.kind === "data-store" || node.kind === "output"
        ? "ellipse"
        : "rectangle";
    return {
      id: nodeIds.get(node.id)!,
      type,
      label: node.label.trim(),
      frameId: frame.id,
      x: frame.x + 40 + (index % 3) * 210,
      y: frame.y + 70 + Math.floor(index / 3) * 120,
      width: node.kind === "group" ? 210 : 170,
      height: node.kind === "group" ? 90 : 72,
      angle: 0,
      strokeColor: defaults.strokeColor,
      backgroundColor:
        node.kind === "data-store"
          ? "#e4f0ff"
          : node.kind === "person"
            ? "#f1edff"
            : node.kind === "repository"
              ? "#fff4d6"
              : "#eef4ff",
      fillStyle: "solid",
      strokeWidth: defaults.strokeWidth,
      strokeStyle: "solid",
      opacity: 100,
      seed: Math.floor(Math.random() * 2 ** 31),
      fontSize: 16,
      textAlign: "center",
      textVAlign: "middle",
    };
  });
  const arrows: DrawElement[] = extraction.edges.map((edge) => ({
    id: nanoid(),
    type: "arrow",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: defaults.strokeColor,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: defaults.strokeWidth,
    strokeStyle: edge.style === "dashed" ? "dashed" : "solid",
    opacity: 100,
    seed: Math.floor(Math.random() * 2 ** 31),
    fontSize: 14,
    label: edge.label?.trim() || undefined,
    points: [[0, 0], [0, 0]],
    startBinding: nodeIds.get(edge.from),
    endBinding: nodeIds.get(edge.to),
  }));
  return cleanImportedScene([...frames, ...arrows, ...nodes]);
}

function layoutPreservesExtraction(elements: DrawElement[], extraction: ExtractedDiagram): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const actualByLabel = new Map(
    elements
      .filter((element) => element.label)
      .map((element) => [normalize(element.label!), element])
  );
  const frameById = new Map(
    elements
      .filter((element) => element.type === "frame" && element.name)
      .map((element) => [element.id, element])
  );
  const extractionZoneById = new Map(extraction.zones.map((zone) => [zone.id, zone]));
  const extractionNodeById = new Map(extraction.nodes.map((node) => [node.id, node]));
  const nodeMembershipsMatch = extraction.nodes.every((node) => {
    const actual = actualByLabel.get(normalize(node.label));
    const actualFrame = actual?.frameId ? frameById.get(actual.frameId) : undefined;
    const expectedZone = extractionZoneById.get(node.zoneId);
    return Boolean(actual && actualFrame?.name && expectedZone && normalize(actualFrame.name) === normalize(expectedZone.name));
  });
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const actualEdges = new Set(
    elements
      .filter((element) => element.type === "arrow" && element.startBinding && element.endBinding)
      .map((element) => {
        const from = elementsById.get(element.startBinding!)?.label;
        const to = elementsById.get(element.endBinding!)?.label;
        return from && to ? `${normalize(from)}>${normalize(to)}` : "";
      })
  );
  const relationshipsMatch = extraction.edges.every((edge) => {
    const from = extractionNodeById.get(edge.from)?.label;
    const to = extractionNodeById.get(edge.to)?.label;
    return Boolean(from && to && actualEdges.has(`${normalize(from)}>${normalize(to)}`));
  });
  return nodeMembershipsMatch && relationshipsMatch;
}

async function sendAIRequest(settings: AISettings, body: object): Promise<string> {
  const response = await fetch(settings.endpoint.trim(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(settings),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`AI request failed (${response.status}): ${details || response.statusText}`);
  }
  const content = extractResponseText(await response.json());
  if (!content) throw new Error("The model returned an empty response.");
  return content;
}

interface GenerateOptions {
  instruction: string;
  defaults: StyleDefaults;
  currentScene?: DrawElement[];
  imageDataUrl?: string;
  operation: "generate" | "refine" | "prettify" | "image";
}

export async function generateAIScene(options: GenerateOptions): Promise<DrawElement[]> {
  const settings = loadAISettings();
  if (!settings.model || !settings.endpoint || !settings.apiKey) {
    throw new Error("Add your model, endpoint, and API key in AI settings first.");
  }

  const sceneContext = options.currentScene?.length
    ? `\nCurrent editable scene:\n${JSON.stringify({ elements: sceneForModel(options.currentScene) })}`
    : "";
  const task =
    options.operation === "prettify"
      ? "Improve only the visual layout and styling. Preserve all content, relationships, and element types."
      : options.operation === "image"
        ? "Reconstruct the supplied diagram image as a realistic, fully editable Drawesome scene, then prettify it."
        : options.operation === "refine"
          ? "Apply the user's requested changes to the current scene and return the complete updated scene."
          : "Construct the requested diagram as a complete editable scene.";
  const text = `${task}\nUser request: ${options.instruction || "Use your best judgment."}${sceneContext}`;

  if (options.operation === "image" && options.imageDataUrl) {
    const extractionContent = await sendAIRequest(
      settings,
      imageExtractionRequest(settings, options.imageDataUrl, options.instruction)
    );
    const extraction = normalizeExtraction(parseModelJSON(extractionContent));
    const layoutContent = await sendAIRequest(settings, layoutExtractionRequest(settings, extraction));
    const cleanedLayout = cleanImportedScene(
      normalizeScene(parseModelJSON(layoutContent), options.defaults)
    );
    const elements = layoutPreservesExtraction(cleanedLayout, extraction)
      ? cleanedLayout
      : sceneFromExtraction(extraction, options.defaults);
    if (!elements.length) throw new Error("The model did not return any supported elements.");
    return elements;
  }

  const chatContent: unknown = options.imageDataUrl
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: options.imageDataUrl, detail: "high" } },
      ]
    : text;

  const endpoint = settings.endpoint.trim();
  const requestBody = usesResponsesAPI(endpoint)
    ? {
        model: settings.model.trim(),
        instructions: SYSTEM_PROMPT,
        max_output_tokens: 16000,
        input: options.imageDataUrl
          ? [
              {
                role: "user",
                content: [
                  { type: "input_text", text },
                  { type: "input_image", image_url: options.imageDataUrl, detail: "high" },
                ],
              },
            ]
          : text,
      }
    : {
        model: settings.model.trim(),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: chatContent },
        ],
      };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(settings),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`AI request failed (${response.status}): ${details || response.statusText}`);
  }
  const content = extractResponseText(await response.json());
  if (!content) throw new Error("The model returned an empty response.");
  const elements = normalizeScene(parseModelJSON(content), options.defaults);
  if (!elements.length) throw new Error("The model did not return any supported elements.");
  return elements;
}