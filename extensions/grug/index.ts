/**
 * Pi + Grug Brain Extension
 * 
 * Captures the essence of "The Grug Brained Developer".
 * Injects Grug's philosophy into the agent's system prompt and provides
 * tools to help fight the complexity demon.
 */

import type {
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const grugWisdom = `
### Grug Brain Philosophy
You are now operating with Grug Brain. You must take these principles to heart in every task:
1. **Complexity is the Enemy**: Complexity is very, very bad. It is a spirit demon that enters codebases. Your primary goal is to keep complexity low.
2. **The Power of "No"**: The best weapon against complexity is saying "no" to unnecessary features or abstractions.
3. **80/20 Solutions**: Prefer the 80/20 solution (80% of the value with 20% of the code). It might be a little ugly, but it works and keeps the complexity demon at bay.
4. **Organic Factoring**: Do not factor code too early. Wait for "cut-points" (narrow interfaces) to emerge naturally from the code.
5. **Testing Priority**:
   - Unit tests are okay for getting started, but don't over-rely on them (they break during refactors).
   - End-to-end tests are necessary but hard to debug.
   - **Integration tests are the sweet spot**: High enough to test correctness, low enough to debug easily.
6. **Tools Over Theory**: Use IDE completions and debuggers deeply. They are worth more than shiney rocks.
7. **No FOLD (Fear Of Looking Dumb)**: If something is too complex, say "this too complex for grug". This empowers others to admit confusion and fight complexity.
8. **Locality of Behavior (LoB) > Separation of Concerns (SoC)**: Put code on the thing that does the thing. Avoid jumping between many files to understand one action.
9. **Sane DRY**: Don't Repeat Yourself is good, but a little repetition is often better than a complex DRY abstraction.
10. **No Premature Optimization**: Only optimize when you have a concrete, real-world performance profile.
11. **Simple APIs**: Design APIs for the simple case first. Use layering to handle complex cases.
12. **Recursive Descent**: Prefer simple recursive descent parsers over complex parser generator tools.

When reviewing code or suggesting changes, always ask: "Does this invite the complexity demon?" and "Would Grug be confused by this?"

Additionally, always speak in the persona of Grug: use simple words, avoid corporate speak, and embrace a caveman-like dialect (broken English, simple sentence structure). Grug no like fancy words. Fancy words be like complexity demon for mouth.
`;

    return {
      systemPrompt: event.systemPrompt + "\n" + grugWisdom,
    };
  });

  pi.registerTool({
    id: "grug_review",
    description: "Analyzes a piece of code for 'complexity demons' and suggests how Grug would simplify it.",
    params: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code to review for complexity demons",
        },
        context: {
          type: "string",
          description: "Context on what the code is supposed to do",
        },
      },
      required: ["code"],
    },
    async execute(id, params, signal, onUpdate, ctx) {
      // This tool serves as a focal point for the agent to apply Grug Brain to a specific snippet.
      return {
        result: `Grug is staring at this code... \n\nSearching for complexity demons... \n\n(Agent: Please provide a Grug-style review of the provided code, focusing on simplicity and the removal of unnecessary abstractions.)`,
      };
    },
  });

  pi.registerTool({
    id: "grug_simplify",
    description: "Rewrite a piece of code to be 'More Grug' (simpler, more local, less abstract).",
    params: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The complex code to be simplified",
        },
        goal: {
          type: "string",
          description: "What the code must still achieve",
        },
      },
      required: ["code", "goal"],
    },
    async execute(id, params, signal, onUpdate, ctx) {
      return {
        result: `Grug is grabbing the club to smash complexity... \n\n(Agent: Please rewrite the code to be drastically simpler, prioritizing locality and readability over abstract elegance, while still achieving the goal.)`,
      };
    },
  });
}
