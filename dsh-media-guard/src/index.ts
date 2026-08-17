/**
 * dsh-media-guard: deterministic aggregate media budgets and safe request
 * projections for DeepSeek Harness.
 *
 * The plugin listens on the `llm/stream` waterfall and acts ONLY on requests
 * assembled by the agent loop (`isAgentLoopRequest`). Hand-built calls —
 * vision bridges' VLM calls, compaction, replay fixtures, and this plugin's
 * own re-dispatch — pass through untouched, which both terminates recursion
 * and keeps the guard out of other plugins' internal traffic. A loop-built
 * request is never mutated (it arrives deep-frozen); when the projection
 * changes anything, a fresh projected request is dispatched instead and the
 * durable session log keeps the originals.
 *
 * @module dsh-media-guard
 */

import type { Context } from "@deepseek-ai/cordis";
import { isAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { GuardReport, GuardResult, MediaGuard } from "./domain.js";
import { stripImageLeaves } from "./emergency.js";
import { createMediaGuard } from "./media-guard.js";
import type { Config, ResolvedGuardConfig } from "./config.js";
import { resolveGuardConfig } from "./config.js";
import { formatReportSummary } from "./status.js";

export type {
  BudgetDecision,
  BudgetPlan,
  GuardEnvironment,
  GuardMode,
  GuardReport,
  GuardResult,
  ImageCodec,
  ImageTarget,
  MediaBudget,
  MediaBudgetOverride,
  MediaBudgetProfiles,
  MediaFootprint,
  MediaGuard,
  MediaLedgerItem,
  PressureLevel,
  ProjectionReason,
  ResolvedMediaBudget,
} from "./domain.js";
export { stripImageLeaves } from "./emergency.js";
export { createEvidenceNote, REASON_LABELS } from "./evidence-note.js";
export { buildMediaLedger, mediaFootprint, walkImages } from "./ledger.js";
export { base64BytesForBinary } from "./media-bytes.js";
export {
  createMediaGuard,
  DEFAULT_COMPRESSION_TIMEOUT_MS,
  type CreateMediaGuardOptions,
} from "./media-guard.js";
export {
  BUILTIN_MEDIA_PROFILES,
  DEFAULT_MEDIA_BUDGET,
  planMediaBudget,
  resolveMediaBudget,
} from "./policy.js";
export { resolveGuardConfig } from "./config.js";
export type { Config, GuardConfigResolution, ResolvedGuardConfig } from "./config.js";
export { formatReportSummary } from "./status.js";

declare module "@deepseek-ai/cordis" {
  interface Events {
    /**
     * Emitted after each guarded projection with the applied (or observed)
     * outcome. Reports carry metadata only — never image bytes.
     * @mode emit
     */
    "media-guard/report"(report: GuardReport): void;
  }
}

export const name = "media-guard";
export const inject = ["llm"];

/** The context surface the listener actually uses, for embedding and tests. */
export interface GuardContext {
  llm: { stream(options: GenerateOptions): AsyncIterable<StreamChunk> };
  emit(event: "media-guard/report", report: GuardReport): void;
}

function warn(message: string): void {
  // One line, no media data and no payload contents — ever.
  console.warn(`[dsh-media-guard] ${message}`);
}

function emitReport(ctx: GuardContext, config: ResolvedGuardConfig, report: GuardReport): void {
  try {
    ctx.emit("media-guard/report", report);
  } catch {
    // Reporting must never break the request path.
  }
  if (config.log) warn(formatReportSummary(report));
}

function emergencyStream(
  ctx: GuardContext,
  config: ResolvedGuardConfig,
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>,
  error: unknown,
): AsyncIterable<StreamChunk> {
  return (async function* () {
    warn(`projection failed (${error instanceof Error ? error.message : String(error)})`);
    if (config.mode !== "protect") {
      yield* next();
      return;
    }
    // Never silently fall back to the oversized original: strip every image
    // leaf with the deliberately simpler second path. If even that fails,
    // passing the request through unchanged is the lesser evil.
    let stripped: ReturnType<typeof stripImageLeaves>;
    try {
      stripped = stripImageLeaves(options.messages);
    } catch {
      yield* next();
      return;
    }
    if (stripped.stripped === 0) {
      yield* next();
      return;
    }
    warn(`emergency projection removed ${stripped.stripped} image(s) from the request view`);
    yield* ctx.llm.stream({ ...options, messages: stripped.messages });
  })();
}

/**
 * Build the `llm/stream` waterfall listener. Exposed for embedders and tests;
 * `apply` wires it with the real context and a default guard.
 */
export function createLlmStreamListener(
  ctx: GuardContext,
  guard: MediaGuard,
  config: ResolvedGuardConfig,
): (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk> {
  return (options, next) => {
    if (!isAgentLoopRequest(options)) return next();
    return (async function* () {
      let result: GuardResult;
      try {
        result = await guard.project(options.messages, {
          provider: options.provider,
          mode: config.mode,
          ...(config.budget !== undefined ? { budget: config.budget } : {}),
          profiles: config.profiles,
        });
      } catch (error) {
        yield* emergencyStream(ctx, config, options, next, error);
        return;
      }
      emitReport(ctx, config, result.report);
      if (result.messages === options.messages) {
        yield* next();
        return;
      }
      // The projected request is hand-built (not marked as a loop request),
      // so this listener passes it straight through on re-entry.
      yield* ctx.llm.stream({ ...options, messages: result.messages });
    })();
  };
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolution = resolveGuardConfig(config);
  for (const diagnostic of resolution.diagnostics) warn(`config: ${diagnostic}`);
  if (!resolution.config.enabled) return;
  const guard = createMediaGuard({
    compressionTimeoutMs: resolution.config.compressionTimeoutMs,
  });
  const listener = createLlmStreamListener(
    ctx as unknown as GuardContext,
    guard,
    resolution.config,
  );
  ctx.on("llm/stream", listener);
}
