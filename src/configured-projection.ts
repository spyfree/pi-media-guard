import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { LoadedMediaGuardConfig } from "./config.js";
import { resolveGuardEnabled, resolveGuardMode, resolveLayeredMediaBudget } from "./config.js";
import type { GuardResult, ImageCodec, MediaBudgetOverride } from "./domain.js";
import { createMediaGuard } from "./media-guard.js";

export interface ConfiguredProjectionOptions {
  provider?: string;
  loadedConfig: LoadedMediaGuardConfig;
  override?: MediaBudgetOverride;
  codec?: ImageCodec;
}

const EMPTY_FOOTPRINT = Object.freeze({ blocks: 0, serializedBytes: 0, decodedBytes: 0 });

export async function projectConfiguredRequest(
  messages: AgentMessage[],
  options: ConfiguredProjectionOptions,
): Promise<GuardResult> {
  const resolved = resolveLayeredMediaBudget({
    provider: options.provider,
    globalConfig: options.loadedConfig.globalConfig,
    projectConfig: options.loadedConfig.projectConfig,
    override: options.override,
  });
  if (!resolveGuardEnabled(options.loadedConfig.globalConfig, options.loadedConfig.projectConfig)) {
    // A disabled guard costs nothing: no ledger, no hashing, no projection.
    return {
      messages,
      decisions: [],
      report: {
        mode: "observe",
        disabled: true,
        pressure: "green",
        budget: resolved.budget,
        budgetProfile: resolved.profile,
        before: EMPTY_FOOTPRINT,
        after: EMPTY_FOOTPRINT,
        kept: 0,
        compressed: 0,
        externalized: 0,
        externalizedCurrent: 0,
        deduplicated: 0,
      },
    };
  }
  return createMediaGuard({ codec: options.codec }).project(messages, {
    provider: options.provider,
    mode: resolveGuardMode(options.loadedConfig.globalConfig, options.loadedConfig.projectConfig),
    budgetProfile: resolved.profile,
    budget: resolved.budget,
  });
}
