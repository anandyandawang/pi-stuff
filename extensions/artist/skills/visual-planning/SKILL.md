---
name: visual-planning
description: Plan non-trivial changes visually with Mermaid diagrams rendered as ASCII art.
---

# Visual Planning Process

Use this skill whenever the user asks for a non-trivial change (e.g., affecting multiple files, changing core architecture, or adding a complex feature).

## The Grug-Approved Planning Workflow

### 1. Discovery Phase (Research)
Do not start drawing yet. First, understand the land:
- Ask clarifying questions to align on what the implementation should look like. Planning is a means of getting alignment — make sure you and the user are thinking about the same thing before you start drawing.
- Use `ls` and `read` to map out all affected files.
- Use `grep` to find all call sites of modified functions.
- **Identify existing patterns in the codebase. Be consistent.** Do not just observe patterns — match them. Code structure, naming, file layout, error handling, test style — all of it. If the codebase does things one way, your change does it that same way. No exceptions without a good reason.
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

### 4. Testing Visual Plan
Before final confirmation, draw one more diagram — but this one is **about tests, not code**.

- Use the `draw_visual_plan` tool to show the **test landscape**.
- Focus on **what cases** are being tested, **what kinds of tests** (unit, integration, e2e), and **how existing tests change** (new tests added, old tests removed, existing tests modified).
- Do NOT draw code structure here. Instead, show:
  - 🪨 New test files / test blocks being added
  - 🔥 Old tests being removed or replaced
  - 📦 Test cases grouped by scenario (happy path, error path, edge case)
  - 🧪 Test type: unit / integration / e2e
- Mark each test group with the scenario it covers (e.g., "valid input", "empty input", "network failure").
- Ask the user: "Do these tests cover the right things? Too many? Too few?"
- Iterate until the user says the test plan is solid.

### 5. Final Confirmation
Once all chunks and the test plan are visually approved, summarize the full sequence and ask for a final "go" before writing any code.

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

## When You Are Done

Grug knows the change is finished when all three things are true:

1. **Plan matched.** Every chunk from the visual plan is implemented. Nothing extra snuck in, nothing important left out.
2. **It compiles.** The application builds without errors. No red squiggles, no "cannot find module."
3. **Tests pass.** All existing tests still green. New tests (from the testing visual plan) are written and passing.
