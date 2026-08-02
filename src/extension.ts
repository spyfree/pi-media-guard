import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadMediaGuardConfig, type LoadedMediaGuardConfig } from "./config.js";
import { projectConfiguredRequest } from "./configured-projection.js";
import { CachingImageCodec } from "./codecs/cache.js";
import { PiPhotonCodec } from "./codecs/pi-photon.js";
import type { GuardReport } from "./domain.js";
import { createMediaGuard } from "./media-guard.js";
import {
  emergencyProjectOpenAIResponsesPayload,
  inspectOpenAIResponsesPayload,
} from "./providers/openai-responses.js";
import { formatMediaStatus } from "./status.js";

const STATUS_KEY = "pi-media-guard";
const NO_MEDIA_BUDGET = Object.freeze({
  maxMediaBlocks: 0,
  maxSerializedMediaBytes: 0,
  maxDecodedMediaBytes: 0,
  maxSerializedBytesPerImage: 0,
});

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

export default function piMediaGuardExtension(pi: ExtensionAPI): void {
  let loadedConfig: LoadedMediaGuardConfig | undefined;
  let lastWarning: string | undefined;
  let lastReport: GuardReport | undefined;
  const codec = new CachingImageCodec(new PiPhotonCodec());

  async function loadConfig(ctx: ExtensionContext): Promise<LoadedMediaGuardConfig> {
    const loaded = await loadMediaGuardConfig({
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
    });
    loadedConfig = loaded;
    for (const diagnostic of loaded.diagnostics) {
      ctx.ui.notify(`pi-media-guard: ${diagnostic}`, "warning");
    }
    return loaded;
  }

  pi.on("session_start", async (_event, ctx) => {
    lastWarning = undefined;
    lastReport = undefined;
    await loadConfig(ctx);
  });

  pi.on("context", async (event, ctx) => {
    const config = loadedConfig ?? (await loadConfig(ctx));
    try {
      const result = await projectConfiguredRequest(event.messages, {
        provider: ctx.model?.provider,
        loadedConfig: config,
        codec,
      });
      const { report } = result;
      lastReport = report;
      ctx.ui.setStatus(
        STATUS_KEY,
        `media ${formatMiB(report.after.serializedBytes)}/${formatMiB(report.budget.maxSerializedMediaBytes)} · ${report.pressure}`,
      );

      if (report.externalizedCurrent > 0) {
        const warning = `${ctx.model?.provider ?? "default"}:${report.before.serializedBytes}:${report.externalizedCurrent}`;
        if (warning !== lastWarning) {
          ctx.ui.notify(
            `pi-media-guard replaced ${report.externalizedCurrent} current image(s) with text because the declared media budget was exceeded.`,
            "warning",
          );
          lastWarning = warning;
        }
      } else {
        lastWarning = undefined;
      }
      return { messages: result.messages };
    } catch (error) {
      ctx.ui.notify(
        `pi-media-guard projection failed; sending a text-only emergency projection: ${(error as Error).message}`,
        "error",
      );
      const emergency = await createMediaGuard().project(event.messages, {
        budgetProfile: "emergency-text-only",
        budget: NO_MEDIA_BUDGET,
      });
      return { messages: emergency.messages };
    }
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== "openai-codex") return;
    const footprint = inspectOpenAIResponsesPayload(event.payload);
    if (
      lastReport &&
      footprint.serializedMediaBytes > lastReport.budget.maxSerializedMediaBytes
    ) {
      ctx.ui.notify(
        `pi-media-guard final Codex payload contains ${formatMiB(footprint.serializedMediaBytes)} of media, above the declared ${formatMiB(lastReport.budget.maxSerializedMediaBytes)} budget.`,
        "error",
      );
      if (lastReport.mode === "protect") {
        return emergencyProjectOpenAIResponsesPayload(event.payload);
      }
    }
  });

  pi.registerCommand("media", {
    description: "Show pi-media-guard status",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action !== "status") {
        ctx.ui.notify("Usage: /media [status]", "warning");
        return;
      }
      ctx.ui.notify(
        lastReport
          ? formatMediaStatus(lastReport)
          : "Media Guard: waiting for the first model request",
        "info",
      );
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    loadedConfig = undefined;
    lastWarning = undefined;
    lastReport = undefined;
    codec.clear();
  });
}
