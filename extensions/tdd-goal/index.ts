import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const CUSTOM_TYPE = "tdd-goal";
const EVENT_TYPE = "tdd-goal-event";

type TDDPhase = "designing" | "running" | "paused" | "complete";

type TDDState = {
  version: 1;
  id: string;
  feature: string;
  testFiles: string[];
  phase: TDDPhase;
  createdAt: number;
  updatedAt: number;
};

let tddState: TDDState | null = null;
let continuationQueued = false;
let cachedSkillBody: string | null = null;

async function loadSkillBody(): Promise<string> {
  if (cachedSkillBody !== null) return cachedSkillBody;
  try {
    const skillPath = path.resolve(fileURLToPath(import.meta.url), "../skills/tdd-design/SKILL.md");
    const raw = await readFile(skillPath, "utf-8");
    cachedSkillBody = raw.replace(/^---[\s\S]*?---\n/, "");
  } catch {
    cachedSkillBody = "";
  }
  return cachedSkillBody;
}

function restoreState(ctx: ExtensionContext): TDDState | null {
  const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as any;
    if (entry.type === "custom" && entry.customType === CUSTOM_TYPE) {
      return entry.data?.state ?? null;
    }
  }
  return null;
}

function persist(pi: ExtensionAPI, ctx: ExtensionContext, next: TDDState | null) {
  tddState = next;
  pi.appendEntry(CUSTOM_TYPE, { state: next });
}

function emitEvent(
  pi: ExtensionAPI,
  kind: "design" | "run" | "continuation" | "paused" | "resumed" | "cleared" | "complete",
  state: TDDState,
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  overrideContent?: string
) {
  let content = overrideContent ?? "";
  if (!overrideContent) {
    switch (kind) {
      case "design":
        content = `TDD Design phase started for: ${state.feature}`;
        break;
      case "run":
        content = `TDD Run phase started for: ${state.feature}`;
        break;
      case "continuation":
        content = `Continue TDD Run phase for: ${state.feature}`;
        break;
      case "paused":
        content = "TDD goal paused.";
        break;
      case "resumed":
        content = `TDD goal resumed for: ${state.feature}`;
        break;
      case "cleared":
        content = "TDD goal cleared.";
        break;
      case "complete":
        content = `TDD goal complete for: ${state.feature}`;
        break;
    }
  }
  pi.sendMessage(
    {
      customType: EVENT_TYPE,
      content,
      display: true,
      details: { kind, state, timestamp: Date.now() },
    },
    options
  );
}

function systemPromptAppendix(state: TDDState): string {
  let appendix = `\n\n## TDD Goal\n- Feature: ${state.feature}`;
  if (state.testFiles.length) {
    appendix += `\n- Test files: ${state.testFiles.join(", ")}`;
  }
  appendix += `\n- Phase: ${state.phase}`;
  if (state.phase === "designing") {
    appendix += `\n\nYou are in the DESIGN phase. Collaborate with the user to design integration tests for the feature above. Ask clarifying questions. Create or modify integration test files. Do not write production code yet. After creating the tests, call register_tdd_tests to record the test file paths.`;
  } else if (state.phase === "running") {
    appendix += `\n\nYou are in the RUN phase. Your goal is to make the integration tests pass. Implement production code. Run the test suite frequently. Do not change the intent of the tests unless they are demonstrably broken. Call update_tdd_goal({status: "complete"}) when all tests pass.`;
  } else if (state.phase === "paused") {
    appendix += `\n\nThe TDD goal is paused. Do not work on it unless the user explicitly asks.`;
  }
  return appendix;
}

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer(EVENT_TYPE, (message, { expanded }, theme) => {
    const details = message.details as { kind?: string; state?: TDDState; timestamp?: number } | undefined;
    const kind = details?.kind ?? "info";
    const state = details?.state ?? null;
    const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
    box.addChild(new Text(theme.fg("customMessageLabel", theme.bold("TDD Goal")), 0, 0));
    box.addChild(new Spacer(1));
    if (!expanded) {
      const label = state ? state.phase : "none";
      box.addChild(new Text(`${theme.fg("customMessageText", kind)} ${theme.fg("dim", `(${label}) ctrl+o to expand`)}`, 0, 0));
      return box;
    }
    const lines: string[] = [];
    lines.push(`${theme.fg("dim", "Phase:")} ${theme.fg("customMessageText", state?.phase ?? "none")}`);
    if (state) {
      lines.push(`${theme.fg("dim", "Feature:")} ${theme.fg("customMessageText", state.feature)}`);
      if (state.testFiles.length) {
        lines.push(`${theme.fg("dim", "Tests:")} ${theme.fg("customMessageText", state.testFiles.join(", "))}`);
      }
    }
    box.addChild(new Text(lines.join("\n"), 0, 0));
    return box;
  });

  pi.registerTool({
    name: "get_tdd_goal",
    label: "Get TDD Goal",
    description: "Read the current TDD goal state.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: JSON.stringify(tddState, null, 2) }],
        details: { goal: tddState },
      };
    },
  });

  pi.registerTool({
    name: "register_tdd_tests",
    label: "Register TDD Tests",
    description: "Register the integration test file paths for the current TDD goal.",
    parameters: Type.Object({
      test_files: Type.Array(Type.String({ description: "Relative paths to integration test files" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!tddState) {
        return { content: [{ type: "text", text: "No active TDD goal." }], isError: true };
      }
      const next: TDDState = { ...tddState, testFiles: params.test_files, updatedAt: Date.now() };
      persist(pi, ctx, next);
      return {
        content: [{ type: "text", text: `Registered test files: ${next.testFiles.join(", ")}` }],
        details: { testFiles: next.testFiles },
      };
    },
  });

  pi.registerTool({
    name: "update_tdd_goal",
    label: "Update TDD Goal",
    description: "Mark the current TDD goal as complete. Only call this when all integration tests pass.",
    parameters: Type.Object({
      status: StringEnum(["complete"] as const),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!tddState) {
        return { content: [{ type: "text", text: "No active TDD goal." }], isError: true };
      }
      if (tddState.phase !== "running") {
        return { content: [{ type: "text", text: "Goal is not in running phase." }], isError: true };
      }
      const next: TDDState = { ...tddState, phase: "complete", updatedAt: Date.now() };
      persist(pi, ctx, next);
      emitEvent(pi, "complete", next);
      return {
        content: [{ type: "text", text: "TDD goal marked complete." }],
        details: { goal: next },
      };
    },
  });

  pi.registerCommand("tdd", {
    description: "TDD goal: design tests, then run them",
    getArgumentCompletions: (prefix) => {
      const values = ["run", "pause", "resume", "clear", "status"];
      const filtered = values.filter((v) => v.startsWith(prefix));
      return filtered.length ? filtered.map((v) => ({ value: v, label: v })) : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const now = Date.now();

      if (trimmed === "status") {
        if (!tddState) {
          ctx.ui.notify("No TDD goal set. Usage: /tdd <feature description>", "info");
        } else {
          ctx.ui.notify(
            `Phase: ${tddState.phase}\nFeature: ${tddState.feature}\nTests: ${tddState.testFiles.join(", ") || "none"}`,
            "info"
          );
        }
        return;
      }

      if (trimmed === "clear") {
        if (!tddState) {
          ctx.ui.notify("No TDD goal to clear.", "info");
          return;
        }
        const prev = tddState;
        persist(pi, ctx, null);
        emitEvent(pi, "cleared", prev);
        return;
      }

      if (trimmed === "pause") {
        if (!tddState) {
          ctx.ui.notify("No TDD goal to pause.", "warning");
          return;
        }
        if (tddState.phase === "paused" || tddState.phase === "complete") {
          ctx.ui.notify(`Already ${tddState.phase}.`, "info");
          return;
        }
        const next: TDDState = { ...tddState, phase: "paused", updatedAt: now };
        persist(pi, ctx, next);
        emitEvent(pi, "paused", next);
        return;
      }

      if (trimmed === "resume") {
        if (!tddState) {
          ctx.ui.notify("No TDD goal to resume.", "warning");
          return;
        }
        if (tddState.phase !== "paused") {
          ctx.ui.notify(`Cannot resume from ${tddState.phase}.`, "warning");
          return;
        }
        const next: TDDState = { ...tddState, phase: "running", updatedAt: now };
        persist(pi, ctx, next);
        emitEvent(pi, "resumed", next, { triggerTurn: ctx.isIdle() });
        return;
      }

      if (trimmed === "run") {
        if (!tddState) {
          ctx.ui.notify("No TDD goal. Start one with /tdd <feature description>", "warning");
          return;
        }
        if (tddState.phase === "complete") {
          ctx.ui.notify("Goal is already complete.", "info");
          return;
        }
        const next: TDDState = { ...tddState, phase: "running", updatedAt: now };
        persist(pi, ctx, next);
        emitEvent(pi, "run", next, { triggerTurn: ctx.isIdle() });
        return;
      }

      if (!trimmed) {
        ctx.ui.notify("Usage: /tdd <feature description>  or  /tdd run|pause|resume|clear|status", "info");
        return;
      }

      // Start a new design goal
      if (tddState && tddState.phase !== "complete") {
        const ok = await ctx.ui.confirm("Replace TDD goal?", `Current: ${tddState.feature}\n\nNew: ${trimmed}`);
        if (!ok) return;
      }

      const next: TDDState = {
        version: 1,
        id: `${now}-${Math.random().toString(16).slice(2)}`,
        feature: trimmed,
        testFiles: [],
        phase: "designing",
        createdAt: now,
        updatedAt: now,
      };
      persist(pi, ctx, next);

      const skillBody = await loadSkillBody();
      const designContent = skillBody
        ? `TDD Design phase started for: ${next.feature}\n\nGuidelines:\n${skillBody}`
        : `TDD Design phase started for: ${next.feature}`;

      emitEvent(pi, "design", next, { triggerTurn: ctx.isIdle() }, designContent);
    },
  });

  pi.on("session_start", (event, ctx) => {
    const restored = restoreState(ctx);
    tddState = restored;
    continuationQueued = false;
    if (restored?.phase === "running" && event.reason === "reload") {
      const next: TDDState = { ...restored, phase: "paused", updatedAt: Date.now() };
      tddState = next;
      persist(pi, ctx, next);
      ctx.ui.notify(`TDD goal paused after reload: ${next.feature}\nUse /tdd resume to continue.`, "info");
      return;
    }
    if (restored) {
      ctx.ui.notify(`TDD goal restored: ${restored.feature} (${restored.phase})`, "info");
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!tddState) return;
    return { systemPrompt: event.systemPrompt + systemPromptAppendix(tddState) };
  });

  pi.on("agent_end", (_event, ctx) => {
    if (!tddState || tddState.phase !== "running" || ctx.hasPendingMessages()) return;
    if (continuationQueued) return;
    continuationQueued = true;
    queueMicrotask(() => {
      continuationQueued = false;
      if (!tddState || tddState.phase !== "running") return;
      emitEvent(pi, "continuation", tddState, { triggerTurn: true, deliverAs: "followUp" });
    });
  });
}
