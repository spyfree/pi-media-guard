import type { GuardMode, MediaBudget, MediaBudgetOverride } from "./domain.js";
import { DEFAULT_COMPRESSION_TIMEOUT_MS } from "./media-guard.js";

/** Plugin configuration accepted from the cordis layer (`config:` in a patch). */
export interface Config {
  /** `false` bypasses the guard entirely — no inventory, no projection. */
  enabled?: boolean;
  /** `observe` reports only; `optimize` compresses only; `protect` (default) compresses then externalizes. */
  mode?: GuardMode;
  /** Overrides applied on top of the default budget for every provider. */
  budget?: MediaBudgetOverride;
  /** Per-provider-route budget overrides keyed by `GenerateOptions.provider`. */
  profiles?: Record<string, MediaBudgetOverride>;
  /** Upper bound per image compression attempt; non-positive disables the timeout. */
  compressionTimeoutMs?: number;
  /** `true` prints a one-line report summary to stderr after each projection. */
  log?: boolean;
}

export interface ResolvedGuardConfig {
  enabled: boolean;
  mode: GuardMode;
  budget?: MediaBudgetOverride;
  profiles: Record<string, MediaBudgetOverride>;
  compressionTimeoutMs: number;
  log: boolean;
}

export interface GuardConfigResolution {
  config: ResolvedGuardConfig;
  /** Human-readable rejections; each rejected field fell back to its default. */
  diagnostics: string[];
}

const DEFAULT_CONFIG: ResolvedGuardConfig = Object.freeze({
  enabled: true,
  mode: "protect",
  profiles: Object.freeze({}),
  compressionTimeoutMs: DEFAULT_COMPRESSION_TIMEOUT_MS,
  log: false,
});

const BUDGET_KEYS: readonly (keyof MediaBudget)[] = [
  "maxMediaBlocks",
  "maxSerializedMediaBytes",
  "maxDecodedMediaBytes",
  "maxSerializedBytesPerImage",
];

const MODES: readonly GuardMode[] = ["observe", "optimize", "protect"];

const UNSAFE_PROFILE_NAMES = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBudgetOverride(
  value: unknown,
  where: string,
  diagnostics: string[],
): MediaBudgetOverride | undefined {
  if (!isPlainObject(value)) {
    diagnostics.push(`${where} must be an object`);
    return undefined;
  }
  const override: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!BUDGET_KEYS.includes(key as keyof MediaBudget)) {
      diagnostics.push(`${where}.${key} is not a budget field`);
      continue;
    }
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
      diagnostics.push(`${where}.${key} must be a non-negative integer`);
      continue;
    }
    override[key] = raw;
  }
  return Object.keys(override).length > 0 ? (override as MediaBudgetOverride) : undefined;
}

/**
 * Strictly validate the plugin configuration, falling back FIELD BY FIELD to
 * the protective defaults. An invalid value can never widen a budget or turn
 * the guard off: protection degrades toward the defaults, never toward "off".
 * Only an explicit boolean `enabled: false` bypasses the guard.
 */
export function resolveGuardConfig(raw: unknown): GuardConfigResolution {
  const diagnostics: string[] = [];
  if (raw === undefined || raw === null) {
    return { config: { ...DEFAULT_CONFIG }, diagnostics };
  }
  if (!isPlainObject(raw)) {
    diagnostics.push("config must be an object; using defaults");
    return { config: { ...DEFAULT_CONFIG }, diagnostics };
  }
  const config: ResolvedGuardConfig = { ...DEFAULT_CONFIG, profiles: {} };
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case "enabled": {
        if (typeof value === "boolean") config.enabled = value;
        else diagnostics.push("enabled must be a boolean");
        break;
      }
      case "mode": {
        if (typeof value === "string" && (MODES as readonly string[]).includes(value)) {
          config.mode = value as GuardMode;
        } else diagnostics.push(`mode must be one of ${MODES.join("/")}`);
        break;
      }
      case "budget": {
        const override = parseBudgetOverride(value, "budget", diagnostics);
        if (override) config.budget = override;
        break;
      }
      case "profiles": {
        if (!isPlainObject(value)) {
          diagnostics.push("profiles must be an object");
          break;
        }
        for (const [name, profile] of Object.entries(value)) {
          if (UNSAFE_PROFILE_NAMES.has(name)) {
            diagnostics.push(`profiles.${name} is not an allowed profile name`);
            continue;
          }
          const override = parseBudgetOverride(profile, `profiles.${name}`, diagnostics);
          if (override) config.profiles[name] = override;
        }
        break;
      }
      case "compressionTimeoutMs": {
        if (typeof value === "number" && Number.isFinite(value)) {
          config.compressionTimeoutMs = value;
        } else diagnostics.push("compressionTimeoutMs must be a finite number");
        break;
      }
      case "log": {
        if (typeof value === "boolean") config.log = value;
        else diagnostics.push("log must be a boolean");
        break;
      }
      default:
        diagnostics.push(`unknown config field "${key}"`);
    }
  }
  return { config, diagnostics };
}
