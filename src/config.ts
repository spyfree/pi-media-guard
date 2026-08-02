import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  GuardMode,
  MediaBudgetOverride,
  MediaBudgetProfiles,
  ResolvedMediaBudget,
} from "./domain.js";
import { resolveMediaBudget } from "./policy.js";

const CONFIG_FILE_NAME = "pi-media-guard.json";
const BUDGET_FIELDS = new Set([
  "maxMediaBlocks",
  "maxSerializedMediaBytes",
  "maxDecodedMediaBytes",
  "maxSerializedBytesPerImage",
]);
const CONFIG_FIELDS = new Set(["version", "enabled", "mode", "budget", "profiles"]);
const GUARD_MODES = new Set<GuardMode>(["observe", "optimize", "protect"]);
const UNSAFE_PROFILE_NAMES = new Set(["__proto__", "prototype", "constructor"]);

export interface MediaGuardConfig {
  version: 1;
  enabled?: boolean;
  mode?: GuardMode;
  budget?: MediaBudgetOverride;
  profiles?: MediaBudgetProfiles;
}

type ConfigParseFailure = { ok: false; error: string };
export type ConfigParseResult = { ok: true; config: MediaGuardConfig } | ConfigParseFailure;

export interface LoadMediaGuardConfigOptions {
  cwd: string;
  projectTrusted: boolean;
  agentDir?: string;
  configDirName?: string;
}

export interface LoadedMediaGuardConfig {
  config: MediaGuardConfig;
  globalConfig?: MediaGuardConfig;
  projectConfig?: MediaGuardConfig;
  diagnostics: string[];
  globalPath: string;
  projectPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBudget(value: unknown, path: string): ConfigParseFailure | MediaBudgetOverride {
  if (!isRecord(value)) return { ok: false, error: `${path} must be an object` };
  const budget: MediaBudgetOverride = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!BUDGET_FIELDS.has(field)) return { ok: false, error: `Unknown config field "${path}.${field}"` };
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
      return { ok: false, error: `${path}.${field} must be a non-negative safe integer` };
    }
    Object.assign(budget, { [field]: raw });
  }
  return budget;
}

function isParseFailure(value: ConfigParseFailure | MediaBudgetOverride): value is ConfigParseFailure {
  return "ok" in value && value.ok === false;
}

export function parseMediaGuardConfig(value: unknown): ConfigParseResult {
  if (!isRecord(value)) return { ok: false, error: "Config must be an object" };
  for (const field of Object.keys(value)) {
    if (!CONFIG_FIELDS.has(field)) return { ok: false, error: `Unknown config field "${field}"` };
  }
  if (value.version !== 1) return { ok: false, error: "Config version must be 1" };

  let budget: MediaBudgetOverride | undefined;
  if (value.budget !== undefined) {
    const parsed = parseBudget(value.budget, "budget");
    if (isParseFailure(parsed)) return parsed;
    budget = parsed;
  }

  let profiles: Record<string, MediaBudgetOverride> | undefined;
  if (value.profiles !== undefined) {
    if (!isRecord(value.profiles)) return { ok: false, error: "profiles must be an object" };
    profiles = {};
    for (const [name, raw] of Object.entries(value.profiles)) {
      if (name.length === 0 || UNSAFE_PROFILE_NAMES.has(name)) {
        return { ok: false, error: `Invalid profile name "${name}"` };
      }
      const parsed = parseBudget(raw, `profiles.${name}`);
      if (isParseFailure(parsed)) return parsed;
      profiles[name] = parsed;
    }
  }

  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return { ok: false, error: "enabled must be a boolean" };
  }
  if (
    value.mode !== undefined &&
    (typeof value.mode !== "string" || !GUARD_MODES.has(value.mode as GuardMode))
  ) {
    return { ok: false, error: "mode must be observe, optimize, or protect" };
  }

  return {
    ok: true,
    config: {
      version: 1,
      ...(value.enabled !== undefined ? { enabled: value.enabled } : {}),
      ...(value.mode !== undefined ? { mode: value.mode as GuardMode } : {}),
      ...(budget ? { budget } : {}),
      ...(profiles ? { profiles } : {}),
    },
  };
}

export function mergeMediaGuardConfigs(
  base: MediaGuardConfig,
  override: MediaGuardConfig,
): MediaGuardConfig {
  const profileNames = new Set([
    ...Object.keys(base.profiles ?? {}),
    ...Object.keys(override.profiles ?? {}),
  ]);
  const profiles: Record<string, MediaBudgetOverride> = {};
  for (const name of profileNames) {
    profiles[name] = {
      ...base.profiles?.[name],
      ...override.profiles?.[name],
    };
  }
  return {
    version: 1,
    ...(base.enabled !== undefined || override.enabled !== undefined
      ? { enabled: override.enabled ?? base.enabled }
      : {}),
    ...(base.mode || override.mode ? { mode: override.mode ?? base.mode } : {}),
    ...(base.budget || override.budget
      ? { budget: { ...base.budget, ...override.budget } }
      : {}),
    ...(profileNames.size > 0 ? { profiles } : {}),
  };
}

export function resolveGuardMode(
  globalConfig?: MediaGuardConfig,
  projectConfig?: MediaGuardConfig,
): GuardMode {
  if ((projectConfig?.enabled ?? globalConfig?.enabled) === false) return "observe";
  return projectConfig?.mode ?? globalConfig?.mode ?? "protect";
}

export interface ResolveLayeredMediaBudgetOptions {
  provider?: string;
  globalConfig?: MediaGuardConfig;
  projectConfig?: MediaGuardConfig;
  override?: MediaBudgetOverride;
}

export function resolveLayeredMediaBudget(
  options: ResolveLayeredMediaBudgetOptions,
): ResolvedMediaBudget {
  const base = resolveMediaBudget({ provider: options.provider });
  const globalProfile = options.provider
    ? options.globalConfig?.profiles?.[options.provider]
    : undefined;
  const projectProfile = options.provider
    ? options.projectConfig?.profiles?.[options.provider]
    : undefined;
  return {
    budget: {
      ...base.budget,
      ...globalProfile,
      ...options.globalConfig?.budget,
      ...projectProfile,
      ...options.projectConfig?.budget,
      ...options.override,
    },
    profile:
      base.profile !== "default" || globalProfile || projectProfile
        ? (options.provider ?? "default")
        : "default",
  };
}

async function readConfigLayer(
  path: string,
  label: "global" | "project",
  diagnostics: string[],
): Promise<MediaGuardConfig | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    diagnostics.push(`${label} config could not be read: ${(error as Error).message}`);
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    diagnostics.push(`${label} config has invalid JSON: ${path}`);
    return undefined;
  }
  const parsed = parseMediaGuardConfig(value);
  if (!parsed.ok) {
    diagnostics.push(`${label} config rejected: ${parsed.error}`);
    return undefined;
  }
  return parsed.config;
}

export async function loadMediaGuardConfig(
  options: LoadMediaGuardConfigOptions,
): Promise<LoadedMediaGuardConfig> {
  const globalPath = join(options.agentDir ?? getAgentDir(), CONFIG_FILE_NAME);
  const projectPath = join(options.cwd, options.configDirName ?? CONFIG_DIR_NAME, CONFIG_FILE_NAME);
  const diagnostics: string[] = [];
  const globalConfig = await readConfigLayer(globalPath, "global", diagnostics);
  const projectConfig = options.projectTrusted
    ? await readConfigLayer(projectPath, "project", diagnostics)
    : undefined;
  return {
    config: mergeMediaGuardConfigs(
      globalConfig ?? { version: 1 },
      projectConfig ?? { version: 1 },
    ),
    globalConfig,
    projectConfig,
    diagnostics,
    globalPath,
    projectPath,
  };
}
