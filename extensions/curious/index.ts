import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // Encourage asking questions in the system prompt
  pi.on("before_agent_start", async (event, _ctx) => {
    return {
      systemPrompt: event.systemPrompt + "\n\nGuidelines for curiosity:\n- Embrace curiosity. If a requirement is vague or an assumption is being made, use the `ask_user` tool to clarify.\n- The goal is a perfect implementation; a few targeted questions now save a hundred lines of wrong code later.",
    };
  });

  // Register the tool that triggers a TUI input prompt
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: "Ask the user a question and wait for their response.",
    promptGuidelines: [
      "Use ask_user when you need specific information from the user to proceed correctly.",
      "Prefer asking a targeted question over making an assumption about the user's intent.",
    ],
    parameters: Type.Object({
      question: Type.String({ description: "The question to ask the user" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // This triggers a blocking input dialog in the TUI
      const answer = await ctx.ui.input(params.question);
      
      return {
        content: [{ type: "text", text: `Question: ${params.question}\nAnswer: ${answer || "(User provided no answer)"}` }],
        details: { question: params.question, answer },
      };
    },
  });
}
