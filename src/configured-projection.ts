import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { LoadedMediaGuardConfig } from "./config.js";
import { resolveGuardMode, resolveLayeredMediaBudget } from "./config.js";
import type { GuardResult, ImageCodec, MediaBudgetOverride } from "./domain.js";
import { createMediaGuard } from "./media-guard.js";

export interface ConfiguredProjectionOptions {
  provider?: string;
  loadedConfig: LoadedMediaGuardConfig;
  override?: MediaBudgetOverride;
  codec?: ImageCodec;
}

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
  return createMediaGuard({ codec: options.codec }).project(messages, {
    provider: options.provider,
    mode: resolveGuardMode(
      options.loadedConfig.globalConfig,
      options.loadedConfig.projectConfig,
    ),
    budgetProfile: resolved.profile,
    budget: resolved.budget,
  });
}
