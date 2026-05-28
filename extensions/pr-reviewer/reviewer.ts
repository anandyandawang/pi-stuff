/**
 * Subagent fan-out. One `pi -p --mode json --model <id>` child process per
 * model. Results aggregated as markdown.
 *
 * Mirrors the official examples/extensions/subagent pattern: spawn pi in
 * print + JSON mode, parse JSONL stdout, pull the final assistant text,
 * cap output per task.
 */

import { spawn } from "node:child_process";

const PER_TASK_OUTPUT_CAP = 50 * 1024;
const PER_TASK_TIMEOUT_MS = 5 * 60 * 1000;

export type ModelReview = {
  model: string;
  ok: boolean;
  text: string;
  errorTail?: string;
};

type JsonEvent = {
  type?: string;
  message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
  text?: string;
};

function extractAssistantText(events: JsonEvent[]): string {
  const chunks: string[] = [];
  for (const e of events) {
    if (e.type === "message_end" || e.type === "message_update" || e.type === "message_start") {
      const role = e.message?.role;
      if (role && role !== "assistant") continue;
      const content = e.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "text" && typeof c.text === "string") chunks.push(c.text);
        }
      }
    } else if (e.type === "assistant_text" && typeof e.text === "string") {
      chunks.push(e.text);
    }
  }
  return chunks.join("").trim();
}

function runOne(
  model: string,
  prompt: string,
  cwd: string,
  signal: AbortSignal,
): Promise<ModelReview> {
  return new Promise((resolve) => {
    const args = [
      "-p",
      prompt,
      "--mode",
      "json",
      "--model",
      model,
      "--no-extensions",
      "--no-tools",
    ];
    const child = spawn("pi", args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutBuf = "";
    const stderrTail: string[] = [];
    const events: JsonEvent[] = [];
    let settled = false;

    const finish = (review: ModelReview) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGTERM");
      } catch {}
      resolve(review);
    };

    const timer = setTimeout(() => {
      finish({
        model,
        ok: false,
        text: "",
        errorTail: `[timed out after ${PER_TASK_TIMEOUT_MS / 1000}s]`,
      });
    }, PER_TASK_TIMEOUT_MS);

    const abortHandler = () => {
      finish({ model, ok: false, text: "", errorTail: "[aborted]" });
    };
    if (signal.aborted) {
      abortHandler();
      return;
    }
    signal.addEventListener("abort", abortHandler, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > PER_TASK_OUTPUT_CAP) {
        finish({
          model,
          ok: false,
          text: extractAssistantText(events),
          errorTail: `[output exceeded ${PER_TASK_OUTPUT_CAP} bytes]`,
        });
        return;
      }
      stdoutBuf += chunk.toString("utf8");
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          // Ignore unparseable lines (pi may emit non-JSON banners).
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      stderrTail.push(chunk.toString("utf8"));
      if (stderrBytes > 8 * 1024) {
        // Keep only the trailing 8 KB.
        const joined = stderrTail.join("");
        stderrTail.length = 0;
        stderrTail.push(joined.slice(-8 * 1024));
        stderrBytes = stderrTail[0].length;
      }
    });

    child.on("error", (err) => {
      finish({
        model,
        ok: false,
        text: "",
        errorTail: `[spawn failed: ${err.message}]`,
      });
    });

    child.on("close", (code) => {
      const text = extractAssistantText(events);
      if (code === 0 && text) {
        finish({ model, ok: true, text });
      } else {
        finish({
          model,
          ok: false,
          text,
          errorTail: stderrTail.join("").trim() || `[exit ${code}]`,
        });
      }
    });
  });
}

export async function runReviews(
  models: string[],
  prompt: string,
  cwd: string,
  signal: AbortSignal,
): Promise<ModelReview[]> {
  return Promise.all(models.map((m) => runOne(m, prompt, cwd, signal)));
}

export function aggregateMarkdown(reviews: ModelReview[], prTitle: string, prUrl: string): string {
  const header = `# Multi-model review: ${prTitle}\n\n${prUrl}\n\n`;
  const body = reviews
    .map((r) => {
      if (r.ok) {
        return `## ${r.model} ✅\n\n${r.text}\n`;
      }
      const text = r.text ? `${r.text}\n\n` : "";
      return `## ${r.model} ❌\n\n${text}\`\`\`\n${r.errorTail ?? "[no output]"}\n\`\`\`\n`;
    })
    .join("\n---\n\n");
  return header + body;
}
