import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as bm from "beautiful-mermaid";
import { truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Artist Extension
 * 
 * Uses beautiful-mermaid to turn Mermaid diagrams into ASCII art.
 */
export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const planningGuideline = `
Whenever the user requests a non-trivial change (affecting multiple files or complex logic), you MUST use the **Visual Planning Process** defined in the 'visual-planning' skill. 
1. Research first (read/ls/grep).
2. Break the plan into sequential 'Visual Chunks'.
3. Use \`draw_visual_plan\` to present and approve each chunk one-by-one before writing a single line of code.
`;
    return {
      systemPrompt: event.systemPrompt + "\n" + planningGuideline,
    };
  });

  pi.registerTool({
    name: "draw_visual_plan",
    label: "Draw Visual Plan",
    description: "Generate a visual diagram using Mermaid syntax. The extension will convert this Mermaid code into high-quality Unicode/ASCII art for the TUI. Use flowcharts, sequence diagrams, or class diagrams. Keep it simple and Grug-friendly.",
    parameters: Type.Object({
      mermaid_code: Type.String({ description: "The Mermaid.js syntax for the diagram" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { mermaid_code } = params;

      return {
        content: [
          { type: "text", text: "Grug render visual plan! 🎨" },
        ],
        details: { mermaid_code },
      };
    },
    renderResult(result, _options, theme, _context) {
      const details = result.details as { mermaid_code: string } | undefined;
      if (!details?.mermaid_code) {
        return null;
      }

      return {
        render(width: number): string[] {
          try {
            const padding = width > 120 ? 5 : width > 80 ? 3 : 1;
            const asciiArt = bm.renderMermaidASCII(details.mermaid_code, {
              paddingX: padding,
              paddingY: padding,
              useAscii: false,
            });

            const lines = asciiArt.split("\n");
            return lines.map((line) => truncateToWidth(line, width));
          } catch (error: any) {
            return [`Failed to render diagram: ${error.message}`];
          }
        },
        invalidate() {},
      };
    },
  });

  pi.registerCommand("artist-plan", {
    description: "Start a visual planning session",
    handler: async (_args, ctx) => {
      await pi.sendUserMessage(
        "I want to plan a feature visually. Please start by describing the goal and then use the `draw_visual_plan` tool. Use Mermaid syntax for the diagrams. The extension will convert them to ASCII art for Grug. Keep them simple and clear!",
        { deliverAs: "steer" }
      );
      ctx.ui.notify("Visual planning mode engaged! 🎨 Artist ready for Mermaid!", "info");
    },
  });
}
