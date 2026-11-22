# Drawesome — Product Brief

*A whiteboard that thinks in diagrams — draw a flow, or just describe it, and it snaps together beautifully.*

---

## Executive summary

Every week, engineers and PMs need to explain a flow, an architecture, or a process — and every week the tool gets in the way. Freehand apps produce crooked, embarrassing sketches nobody wants in a doc. "Real" diagramming tools make you fight menus, drag pixel-perfect boxes, and re-route arrows by hand every time something moves. So people stall: they screenshot a whiteboard, paste an ugly sketch, or skip the diagram entirely and hope words are enough.

Drawesome removes that tax. It's a browser-based whiteboard where arrows attach to shapes and follow them, boxes snap into alignment on their own, labels resize to fit, and — when you'd rather not draw at all — you can optionally connect an AI model, type `Login -> Dashboard -> Logout`, and watch it lay itself out. The core whiteboard remains complete and uncluttered without AI. The output looks intentional and hand-crafted, in seconds, with nothing to install.

---

## Press release

**FOR IMMEDIATE RELEASE**

**Stop fighting your diagramming tool. Drawesome makes clear diagrams as fast as thinking out loud.**

Anyone who has tried to sketch a system on a deadline knows the two bad options: a freehand tool that produces a crooked mess, or a heavyweight editor where you spend ten minutes aligning boxes and re-routing arrows instead of explaining the idea. Today we're launching Drawesome to end that trade-off. Drop in shapes and they snap into alignment automatically. Draw an arrow near a shape and it latches on — then follows the shape wherever you drag it, so a small change never explodes into ten minutes of cleanup.

And when drawing itself is the bottleneck, you don't have to. Type a flow like `Order -> Ship, Invoice, Notify` and Drawesome builds the diagram for you. The result reads as polished and hand-crafted, not like a rushed sketch — and it runs entirely in the browser with nothing to install and no account to create.

“The best diagram is the one you actually make. We obsessed over removing every reason to give up halfway,” said the Drawesome team.

Start drawing at `http://localhost:5173`, or self-host the static build. Local development uses this single port and fails clearly if it is already occupied rather than opening the app on a different port.

---

## 1. Problem

Explaining structure is a daily job — a flow in a PR, an architecture in a design review, a process in a spec — but the tools punish you for doing it. The pain shows up in three ways:

- **The crooked-sketch tax.** Freehand tools are fast but ugly. Misaligned boxes and wandering arrows look careless, so you either ship something you're embarrassed by or waste time nudging pixels.
- **The fiddle tax.** Precision editors demand pixel-perfect placement and manual arrow routing. Every time you move one box, you re-route its connectors by hand. A five-second idea becomes a five-minute chore.
- **The blank-page tax.** Heavyweight apps have menus, panels, and a learning curve that kill momentum. By the time you've found the right tool, the thought you wanted to capture is gone.

The cost is quiet but real: diagrams that would have made an idea land never get made. People fall back to walls of text, blurry whiteboard photos, or "I'll draw it later" — and clarity is lost.

**Making a clear diagram should be as fast and forgiving as thinking out loud — the tool should do the aligning, connecting, and formatting, not you.**

---

## 2. Personas

**Maya — Software Engineer**
- Whiteboards system flows in design reviews and PR descriptions, often minutes before the meeting.
- Wants to go from idea to shareable diagram in under a minute.
- **Pain:** she rearranges one box and every connector detaches or crosses — so she avoids editing and ships a diagram she knows is already stale.

**Devin — Product Manager**
- Maps user journeys and process flows for specs and stakeholder decks.
- Wants alignment and polish without learning a design tool.
- **Pain:** he spends more time nudging boxes and fixing arrows than thinking about the flow, and the deck still looks amateur next to Design's.

**Priya — Educator**
- Sketches concepts live while teaching, then shares them afterward.
- Wants a friendly, legible, hand-drawn style that holds attention.
- **Pain:** heavyweight apps stall or distract mid-lesson, and her rushed live sketches are too messy to reuse or hand out.

---

## 3. User stories

- *As Maya,* I draw an arrow from one box to another and it stays connected as I rearrange the layout, so my diagram survives edits without rework.
- *As Devin,* I type `Order -> Ship, Invoice, Notify` and get a laid-out flow instantly, so I can capture a process faster than drawing it.
- *As Priya,* I drag shapes that snap into alignment automatically, so my live sketch looks clean without manual tidying.

---

## 4. What it does

| Capability | What it does | Serves |
| --- | --- | --- |
| Smart connectors | Arrows suggest attachment points and follow shapes when moved | Maya |
| Text-to-diagram | Turns typed flows (`A -> B, C`) into laid-out diagrams | Devin |
| Magnetic guides | Snaps edges/centers into alignment with dotted guides | Priya, Devin |
| Auto-fitting labels | Labels wrap and grow their shape to fit; 9-way alignment | All |
| Quick-node spawning | `Ctrl/Cmd + Arrow` adds a connected shape in a direction | Maya |
| Named frames | Rename frames directly and use their names during presentations | All |
| Sketch / clean themes | Toggle hand-drawn vs. crisp rendering | Priya, Devin |
| Images & links | Insert/paste images; attach hyperlinks to shapes | All |
| Present & export | Presentation mode; export/import scenes as JSON | Devin, Priya |
| Optional accounts & sync | Passwordless sign-in (Google, Microsoft, or an emailed one-time code) keeps drawings in an account and in step across devices | Maya, Priya |

---

## 5. Experience

**Design principles**
- **Fast by default** — no setup, no modes to learn before drawing, and no account needed to start.
- **Accounts are optional and passwordless** — signing in (Google, Microsoft, or a one-time code sent by email) only adds backup and cross-device sync; the browser stays where editing happens, so the app keeps working offline.
- **Tidy without effort** — snapping and auto-fit do the formatting for you.
- **Sticky, forgiving tools** — the chosen tool stays active; full undo/redo.
- **Handmade, not sloppy** — the sketch aesthetic reads as intentional.
- **AI stays optional** — AI prompts and tools appear only after a model is connected; connection settings remain easy to find and disconnect.
- **Learn by doing** — first-run onboarding uses a short four-step walkthrough instead of a dense reference panel, then lets people start drawing immediately or continue into a focused three-step AI connection and usage guide. The guide remains available from Help.

**Key flow**
1. Pick a shape tool (or press its shortcut) and drag to draw — the tool stays active for the next shape.
2. Draw an arrow near another shape; drop the end on a suggested point to connect them.
3. Double-click a shape to add a label that wraps and fits automatically.
4. Rearrange freely — connectors follow and guides keep things aligned.
5. Add and rename frames to organize the canvas and create a clear presentation sequence.
6. Or, after optionally connecting AI, skip drawing entirely: describe a flow in the top bar and ask AI to build it.

---

## 6. Success metrics

**Activation**
- % of new users who create their first shape within 60 seconds of load.
- % who use the in-app guide vs. drawing unaided (lower is better once onboarded).

**Engagement**
- Diagrams created per active session.
- Share of diagrams that use text-to-diagram or smart connectors.

**Quality**
- % of connectors that remain attached through a layout edit.
- Zero-error typecheck/build on every release.

**Retention**
- 7-day return rate for users who created ≥1 diagram.

---

## 7. Impact

- **Speed to clarity** — an idea becomes a shareable diagram in seconds, not minutes of formatting.
- **Edits that hold up** — connected arrows and snapping mean rearranging doesn't break the diagram.
- **Lower barrier** — no install, no accounts, no learning curve; it runs in any browser.
- **Differentiated** — the mix of hand-drawn style *and* text-to-diagram generation is rare in lightweight tools.

---

## 8. Learnings

**Product**
- Removing choices (sticky tools, always-on snapping) made the tool feel faster than adding options would have.
- Text-to-diagram turned "I'll draw it later" into "I'll type it now" for flow-heavy users.

**Technical / UX**
- Auto-fitting labels are better solved by wrapping at the chosen font size and growing the shape than by shrinking text to fit.
- Connector attachment points need to feel magnetic but forgiving — snap when close, never trap the cursor.
- A continuous canvas render loop keeps interactions smooth but demands care so React state and drawing stay in sync.
- A single strict local-development port (`5173`) keeps the active app URL predictable and prevents parallel versions from being served accidentally.

**If continued**
- Real-time collaboration and shareable links.
- Richer text-to-diagram grammar (branches, groups, styling hints).
- Component libraries / reusable stencils for common architectures.
