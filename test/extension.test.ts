import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import piMediaGuardExtension from "../src/extension.js";

// Isolate the global config layer from the developer's real ~/.pi/agent.
// getAgentDir honors this env var; the assertion fails loudly if pi renames it.
const isolatedAgentDir = await mkdtemp(join(tmpdir(), "pi-media-guard-agent-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;
assert.equal(
  getAgentDir(),
  isolatedAgentDir,
  "PI_CODING_AGENT_DIR no longer isolates the global config layer",
);

type AnyHandler = (event: unknown, ctx: unknown) => unknown;

interface RegisteredCommand {
  description: string;
  handler: (args: string, ctx: unknown) => Promise<void> | void;
}

class FakeExtensionHost {
  private readonly handlers = new Map<string, AnyHandler[]>();
  readonly commands = new Map<string, RegisteredCommand>();

  readonly api = {
    on: (event: string, handler: AnyHandler): void => {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    },
    registerCommand: (name: string, command: RegisteredCommand): void => {
      this.commands.set(name, command);
    },
  } as unknown as ExtensionAPI;

  async emit(event: string, payload: unknown, ctx: unknown): Promise<unknown> {
    let result: unknown;
    for (const handler of this.handlers.get(event) ?? []) {
      result = await handler(payload, ctx);
    }
    return result;
  }
}

interface RecordedUi {
  notifications: Array<{ message: string; level: string | undefined }>;
  statuses: Array<{ key: string; value: string | undefined }>;
}

async function createHarness(provider?: string): Promise<{
  host: FakeExtensionHost;
  ctx: ExtensionContext;
  ui: RecordedUi;
}> {
  const host = new FakeExtensionHost();
  piMediaGuardExtension(host.api);
  const ui: RecordedUi = { notifications: [], statuses: [] };
  const cwd = await mkdtemp(join(tmpdir(), "pi-media-guard-project-"));
  const ctx = {
    cwd,
    isProjectTrusted: () => false,
    model: provider ? { provider } : undefined,
    ui: {
      notify: (message: string, level?: string) => {
        ui.notifications.push({ message, level });
      },
      setStatus: (key: string, value: string | undefined) => {
        ui.statuses.push({ key, value });
      },
    },
  } as unknown as ExtensionContext;
  return { host, ctx, ui };
}

function nineImageMessages(): AgentMessage[] {
  return [
    {
      role: "user",
      content: Array.from({ length: 9 }, (_, index) => ({
        type: "image" as const,
        data: Buffer.from(`distinct-image-${index}`).toString("base64"),
        mimeType: "image/png",
      })),
      timestamp: 1,
    },
  ];
}

function evidenceNotes(messages: AgentMessage[]): string[] {
  return messages.flatMap((message) =>
    "content" in message && Array.isArray(message.content)
      ? message.content.flatMap((block) =>
          typeof block === "object" &&
          block !== null &&
          block.type === "text" &&
          block.text.includes("externalized by pi-media-guard")
            ? [block.text]
            : [],
        )
      : [],
  );
}

test("context hook projects overflow media, sets footer status, and warns once", async () => {
  const { host, ctx, ui } = await createHarness("openai-codex");
  await host.emit("session_start", { type: "session_start" }, ctx);

  const messages = nineImageMessages();
  const result = (await host.emit("context", { type: "context", messages }, ctx)) as {
    messages: AgentMessage[];
  };

  assert.equal(evidenceNotes(result.messages).length, 1);
  const status = ui.statuses.at(-1);
  assert.equal(status?.key, "pi-media-guard");
  assert.match(String(status?.value), /^media .* · red$/);
  const warnings = ui.notifications.filter((entry) => entry.level === "warning");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]?.message ?? "", /replaced 1 current image/);

  await host.emit("context", { type: "context", messages }, ctx);
  assert.equal(ui.notifications.filter((entry) => entry.level === "warning").length, 1);
});

test("codex final payload above the declared budget triggers emergency surgery", async () => {
  const { host, ctx, ui } = await createHarness("openai-codex");
  await host.emit("session_start", { type: "session_start" }, ctx);
  await host.emit(
    "context",
    { type: "context", messages: [{ role: "user", content: "hello", timestamp: 1 }] },
    ctx,
  );

  const payload = {
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`,
          },
        ],
      },
    ],
  };
  const projected = (await host.emit(
    "before_provider_request",
    { type: "before_provider_request", payload },
    ctx,
  )) as { input: Array<{ content: Array<{ type?: string }> }> };

  assert.equal(projected.input[0]?.content[0]?.type, "input_text");
  assert.ok(
    ui.notifications.some(
      (entry) => entry.level === "error" && entry.message.includes("final openai-codex payload"),
    ),
  );
});

test("non-codex providers are not audited in the final payload hook", async () => {
  const { host, ctx } = await createHarness("anthropic");
  await host.emit("session_start", { type: "session_start" }, ctx);

  const result = await host.emit(
    "before_provider_request",
    { type: "before_provider_request", payload: { input: [] } },
    ctx,
  );

  assert.equal(result, undefined);
});

test("/media supports status and reload and rejects unknown actions", async () => {
  const { host, ctx, ui } = await createHarness("openai-codex");
  const media = host.commands.get("media");
  assert.ok(media, "expected the media command to be registered");

  await media.handler("", ctx);
  assert.match(ui.notifications.at(-1)?.message ?? "", /waiting for the first model request/);

  await media.handler("reload", ctx);
  assert.match(
    ui.notifications.at(-1)?.message ?? "",
    /configuration reloaded \(built-in defaults\)/,
  );

  await media.handler("bogus", ctx);
  assert.equal(ui.notifications.at(-1)?.message, "Usage: /media [status|ledger|reload]");
  assert.equal(ui.notifications.at(-1)?.level, "warning");

  await host.emit("session_start", { type: "session_start" }, ctx);
  await host.emit("context", { type: "context", messages: nineImageMessages() }, ctx);
  await media.handler("status", ctx);
  assert.match(ui.notifications.at(-1)?.message ?? "", /^Media Guard: red \(protect\)/);
});

test("session_shutdown clears the footer status", async () => {
  const { host, ctx, ui } = await createHarness("openai-codex");
  await host.emit("session_start", { type: "session_start" }, ctx);
  await host.emit("session_shutdown", { type: "session_shutdown" }, ctx);

  assert.deepEqual(ui.statuses.at(-1), { key: "pi-media-guard", value: undefined });
});

test("a failing projection falls back to stripping images instead of throwing", async () => {
  const { host, ctx, ui } = await createHarness("openai-codex");
  await host.emit("session_start", { type: "session_start" }, ctx);

  const poisoned = { role: "user", timestamp: 1 };
  Object.defineProperty(poisoned, "content", {
    enumerable: true,
    get() {
      throw new Error("poisoned message");
    },
  });
  const image = {
    role: "user",
    content: [
      { type: "image", data: Buffer.from("pixels").toString("base64"), mimeType: "image/png" },
      { type: "text", text: "kept" },
    ],
    timestamp: 2,
  };

  const result = (await host.emit(
    "context",
    { type: "context", messages: [poisoned, image] as AgentMessage[] },
    ctx,
  )) as { messages: AgentMessage[] };

  assert.ok(
    ui.notifications.some(
      (entry) => entry.level === "error" && entry.message.includes("projection failed"),
    ),
  );
  const projected = result.messages[1];
  assert.ok(projected && "content" in projected && Array.isArray(projected.content));
  if (!projected || !("content" in projected) || !Array.isArray(projected.content)) return;
  assert.deepEqual(projected.content[1], { type: "text", text: "kept" });
  const stripped = projected.content[0];
  assert.equal(typeof stripped === "object" && stripped !== null ? stripped.type : "", "text");
  assert.match(stripped?.type === "text" ? stripped.text : "", /emergency projection/);
});

test("/media reload applies a changed configuration to the next request", async (t) => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = await mkdtemp(join(tmpdir(), "pi-media-guard-reload-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const { host, ctx, ui } = await createHarness("openai-codex");
  await host.emit("session_start", { type: "session_start" }, ctx);
  await host.emit("context", { type: "context", messages: nineImageMessages() }, ctx);
  assert.equal(evidenceNotes((await lastProjection(host, ctx)).messages).length, 1);

  await writeFile(
    join(agentDir, "pi-media-guard.json"),
    JSON.stringify({ version: 1, enabled: false }),
  );
  const media = host.commands.get("media");
  assert.ok(media);
  await media.handler("reload", ctx);
  assert.match(ui.notifications.at(-1)?.message ?? "", /configuration reloaded \(global\)/);

  const disabled = await lastProjection(host, ctx);
  assert.equal(evidenceNotes(disabled.messages).length, 0);
  assert.equal(ui.statuses.at(-1)?.value, "media guard off");

  await media.handler("status", ctx);
  assert.match(ui.notifications.at(-1)?.message ?? "", /disabled/);
});

async function lastProjection(
  host: FakeExtensionHost,
  ctx: ExtensionContext,
): Promise<{ messages: AgentMessage[] }> {
  return (await host.emit("context", { type: "context", messages: nineImageMessages() }, ctx)) as {
    messages: AgentMessage[];
  };
}

test("/media ledger explains per-image decisions after a projection", async () => {
  const { host, ctx, ui } = await createHarness("openai-codex");
  await host.emit("session_start", { type: "session_start" }, ctx);
  const media = host.commands.get("media");
  assert.ok(media);

  await media.handler("ledger", ctx);
  assert.match(ui.notifications.at(-1)?.message ?? "", /waiting for the first model request/);

  await host.emit("context", { type: "context", messages: nineImageMessages() }, ctx);
  await media.handler("ledger", ctx);
  const ledger = ui.notifications.at(-1)?.message ?? "";
  assert.match(ledger, /^Media Guard ledger \(9 images\):/);
  assert.match(ledger, /keep/);
  assert.match(ledger, /externalize \(aggregate budget\)/);
  assert.match(ledger, /user message/);
});
