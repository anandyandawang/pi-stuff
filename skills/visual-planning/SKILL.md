---
name: visual-planning
description: A rigorous process for planning non-trivial changes visually using Unicode diagrams.
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
- Use the `draw_visual_plan` tool to create a simple Unicode diagram.
- **IMPORTANT:** Do NOT show the raw Mermaid code in the chat. The tool handles the rendering.
- Provide a brief, simple explanation of *why* this change is being made and how it fits.
- **Stop and Wait.** Ask the user for feedback: "Does this look right? Is it too complex?"
- Iterate on the diagram until the user says "Grug likes this".

### 4. Final Confirmation
Once all chunks are visually approved, summarize the full sequence and ask for a final "go" before writing any code.

## Grug's Drawing Rules
- Use ┌ ┐ └ ┘ ─ │ ├ ┤ ┬ ┴ ┼ and arrows (→, ↓).
- No "over-engineering" the ASCII art. If it takes too long to draw, it's too complex.
- Focus on the *flow of data* and *ownership of behavior*.
