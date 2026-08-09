# Drawesome

A fast, browser-based whiteboard for sketching diagrams, flowcharts, and wireframes — with smart connectors, magnetic alignment guides, and text-to-diagram generation. Built with React, TypeScript, and roughjs for that hand-drawn look.

Live app: [anandd512.github.io/drawesome](https://anandd512.github.io/drawesome/)

## Features

- **Shapes & tools** — rectangle, diamond, ellipse, line, arrow, freehand pencil, and tables. Tools stay active so you can draw several in a row.
- **Smart arrows** — arrows suggest connection points near shapes (PowerPoint-style) and stay attached when you move the shape.
- **Magnetic snapping** — dotted alignment guides appear as edges and centers line up with nearby shapes.
- **Auto-fitting labels** — double-click any shape to add a label that wraps across lines; the shape grows to fit. Align text to 9 positions.
- **Quick-node spawning** — `Ctrl/Cmd + Arrow` spawns a connected shape in that direction.
- **Text-to-diagram** — describe a flow (e.g. `Login -> Dashboard -> Logout`) and generate a diagram automatically.
- **Images & hyperlinks** — insert or paste images; attach URLs to shapes.
- **Sketch / clean themes** — toggle between a hand-drawn look and crisp lines.
- **Presentation mode**, export/import scenes as JSON, undo/redo, zoom, and pan.

## Tech stack

| Area | Choice |
| --- | --- |
| UI | React 18 + TypeScript (strict) |
| Build | Vite 5 |
| State | Zustand |
| Rendering | roughjs on `<canvas>` + perfect-freehand |
| Styling | Tailwind CSS |

## Getting started

Prerequisites: Node.js 18+ and npm.

```powershell
npm install       # install dependencies
npm run dev       # start the dev server (http://localhost:5173)
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot reload. |
| `npm run build` | Type-check (`tsc -b`) and build for production into `dist/`. |
| `npm run preview` | Preview the production build locally. |
| `npm run typecheck` | Run the TypeScript compiler with no emit. |

## Project structure

```
src/
  App.tsx            Root component + global keyboard shortcuts
  store.ts           Zustand app state and actions
  types.ts           Shared type definitions
  constants.ts       Style defaults and constants
  components/
    Canvas.tsx       Canvas rendering + all pointer interactions
    Toolbar.tsx      Left-side tool palette
    TopBar.tsx       Top bar: AI generate, zoom, theme, export/import
    StylePanel.tsx   Right-side style controls
    Guide.tsx        In-app help & documentation panel
  lib/               Rendering, geometry, and diagram-parsing helpers
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` | Select tool |
| `R` / `D` / `O` | Rectangle / Diamond / Ellipse |
| `A` / `L` | Arrow / Line |
| `P` | Draw (pencil) |
| `G` | Table |
| `H` or `Space` + drag | Pan |
| Scroll | Zoom to cursor |
| `Ctrl/Cmd + Z` / `+ Shift + Z` | Undo / Redo |
| `Ctrl/Cmd + A` | Select all |
| `Ctrl/Cmd + D` | Duplicate selection |
| `Ctrl/Cmd + Arrow` | Spawn a connected shape |
| `Ctrl/Cmd + V` | Paste image from clipboard |
| `Ctrl/Cmd + click` | Open a shape's hyperlink |
| `Del` / `Backspace` | Delete selection |
| `Esc` | Deselect / cancel |

The in-app **Help** button (bottom-right) opens a full guide with every feature and shortcut.
