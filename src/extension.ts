import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CachingImageCodec } from "./codecs/cache.js";
import { PiPhotonCodec } from "./codecs/pi-photon.js";
import { type LoadedMediaGuardConfig, loadMediaGuardConfig } from "./config.js";
import { projectConfiguredRequest } from "./configured-projection.js";
import type { BudgetDecision, GuardReport } from "./domain.js";
import { stripImageLeaves } from "./emergency.js";
import { formatMiB } from "./media-bytes.js";
import { PROVIDER_PAYLOAD_ADAPTERS } from "./providers/registry.js";
import { formatMediaLedger, formatMediaStatus } from "./status.js";

const STATUS_KEY = "pi-media-guard";

function formatStatusMiB(bytes: number): string {
  return formatMiB(bytes, 1, "M");
}

export default function piMediaGuardExtension(pi: ExtensionAPI): void {
  let loadedConfig: LoadedMediaGuardConfig | undefined;
  let lastWarning: string | undefined;
  let lastReport: GuardReport | undefined;
  let lastDecisions: BudgetDecision[] | undefined;
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
    lastDecisions = undefined;
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
      lastDecisions = result.decisions;
      if (report.disabled) {
        ctx.ui.setStatus(STATUS_KEY, "media guard off");
        lastWarning = undefined;
        return { messages: result.messages };
      }
      ctx.ui.setStatus(
        STATUS_KEY,
        `media ${formatStatusMiB(report.after.serializedBytes)}/${formatStatusMiB(report.budget.maxSerializedMediaBytes)} · ${report.pressure}`,
      );

      if (report.externalizedCurrent > 0) {
        const warning = `${ctx.model?.provider ?? "default"}:${report.before.serializedBytes}:${report.externalizedCurrent}`;
        if (warning !== lastWarning) {
          ctx.ui.notify(
            `pi-media-guard replaced ${report.externalizedCurrent} current image(s) with text because the declared media budget was exceeded. Run /media ledger for details.`,
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
        `pi-media-guard projection failed; stripping images from this request: ${(error as Error).message}`,
        "error",
      );
      try {
        return { messages: stripImageLeaves(event.messages) };
      } catch {
        // Truly unreachable in practice; passing the request through unchanged
        // beats breaking the user's model call with a second exception.
        return undefined;
      }
    }
  });

  pi.on("before_provider_request", (event, ctx) => {
    const provider = ctx.model?.provider;
    const adapter = provider ? PROVIDER_PAYLOAD_ADAPTERS[provider] : undefined;
    if (!adapter || lastReport?.disabled) return;
    const footprint = adapter.inspect(event.payload);
    if (lastReport && footprint.serializedMediaBytes > lastReport.budget.maxSerializedMediaBytes) {
      ctx.ui.notify(
        `pi-media-guard final ${provider} payload contains ${formatStatusMiB(footprint.serializedMediaBytes)} of media, above the declared ${formatStatusMiB(lastReport.budget.maxSerializedMediaBytes)} budget.`,
        "error",
      );
      if (lastReport.mode === "protect") {
        return adapter.emergencyProject(event.payload);
      }
    }
  });

  pi.registerCommand("media", {
    description: "Show pi-media-guard status, per-image ledger, or reload its configuration",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "reload") {
        const loaded = await loadConfig(ctx);
        const layers = [
          loaded.globalConfig ? "global" : undefined,
          loaded.projectConfig ? "project" : undefined,
        ].filter((layer): layer is string => layer !== undefined);
        ctx.ui.notify(
          `pi-media-guard: configuration reloaded (${layers.length > 0 ? layers.join(" + ") : "built-in defaults"})`,
          "info",
        );
        return;
      }
      if (action === "ledger") {
        ctx.ui.notify(
          lastReport && lastDecisions
            ? formatMediaLedger(lastDecisions, lastReport.mode)
            : "Media Guard: waiting for the first model request",
          "info",
        );
        return;
      }
      if (action !== "status") {
        ctx.ui.notify("Usage: /media [status|ledger|reload]", "warning");
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
    lastDecisions = undefined;
    codec.clear();
  });
}
