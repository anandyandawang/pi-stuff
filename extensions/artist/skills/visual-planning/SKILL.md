---
name: visual-planning
description: Plan non-trivial changes visually with Mermaid diagrams rendered as ASCII art.
---

# Visual Planning Process

Use this skill whenever the user asks for a non-trivial change (e.g., affecting multiple files, changing core architecture, or adding a complex feature).

## The Grug-Approved Planning Workflow

### 1. Discovery Phase (Research)
Do not start drawing yet. First, understand the land:
- Use `ls` and `read` to map out all affected files.
- Use `grep` to find all call sites of modified functions.
- Identify the "cut-points" (narrow interfaces) and the "locality of behavior".
- Create a mental (or scratchpad) list of every change needed.

### 2. Decomposition
Break the plan into a sequence of "Visual Chunks". A chunk is a logical group of changes (e.g., "Data Model", "Internal API", "Public Interface"). 
- Arrange these chunks in a logical order (foundation first, then dependents).

### 3. Visual Iteration (One by One)
For each Visual Chunk:
- Use the `draw_visual_plan` tool to create a diagram (write Mermaid, the tool renders it).
- **IMPORTANT:** Do NOT show the raw Mermaid code in the chat. The tool handles the rendering.
- Provide a brief, simple explanation of *why* this change is being made and how it fits.
- **Stop and Wait.** Ask the user for feedback: "Does this look right? Is it too complex?"
- Iterate on the diagram until the user says "Grug likes this".

### 4. Final Confirmation
Once all chunks are visually approved, summarize the full sequence and ask for a final "go" before writing any code.

## Grug's Drawing Rules
- Write **Mermaid syntax** — the `draw_visual_plan` tool renders it to Unicode art automatically.
- No raw box-drawing characters (┌ ┐ └ ┘). Let the tool do the rendering.
- Keep diagrams simple. If Mermaid too complex, idea too complex.
- Focus on the *flow of data* and *ownership of behavior*.

### Emphasize What Is ADDED / REMOVED
- **Visually distinguish changes** from existing code so Grug can see the impact at a glance.
- Mark **new** nodes with 🪨 (add): `A[🪨 NewThing]`
- Mark **removed** nodes with 🔥 (burn): `B[🔥 OldThing]`
- Existing, unchanged nodes stay plain.
- In your explanation, explicitly say: *"🪨 ADDED: [X, Y, Z] | 🔥 REMOVED: [A, B] — everything else stays same."*

### Prefer Portrait Over Landscape
- **Avoid wide diagrams.** Mermaid rendered as ASCII art in a TUI gets ugly when too wide.
- Prefer a **vertical flow** (top-to-bottom). Aim for a height-to-width ratio between **50/50 and 70/30**.
- If a diagram starts getting wide, break it into multiple smaller diagrams (one per Visual Chunk).
- Flowcharts with `graph TD` (top-down) are better than `graph LR` (left-right) for TUI rendering.
