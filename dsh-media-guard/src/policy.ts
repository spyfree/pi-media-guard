import type {
  BudgetDecision,
  BudgetPlan,
  GuardEnvironment,
  MediaBudget,
  MediaBudgetProfiles,
  MediaLedgerItem,
  PressureLevel,
  ResolvedMediaBudget,
} from "./domain.js";

export const DEFAULT_MEDIA_BUDGET: Readonly<MediaBudget> = Object.freeze({
  maxMediaBlocks: 8,
  maxSerializedMediaBytes: 2_097_152,
  maxDecodedMediaBytes: 1_572_864,
  maxSerializedBytesPerImage: 524_288,
});

/**
 * DSH provider routes are deployment-defined (adapter plugins register
 * arbitrary route ids), so no provider names are hardcoded here — unlike the
 * Pi original, the built-in table is empty and every provider gets the
 * conservative default until the user declares a `profiles` entry keyed by
 * their route id.
 */
export const BUILTIN_MEDIA_PROFILES: MediaBudgetProfiles = Object.freeze({});

export function resolveMediaBudget(environment: GuardEnvironment = {}): ResolvedMediaBudget {
  const provider = environment.provider;
  const builtIn = provider ? BUILTIN_MEDIA_PROFILES[provider] : undefined;
  const configured = provider ? environment.profiles?.[provider] : undefined;
  return {
    budget: {
      ...DEFAULT_MEDIA_BUDGET,
      ...builtIn,
      ...configured,
      ...environment.budget,
    },
    profile:
      environment.budgetProfile ?? (provider && (builtIn || configured) ? provider : "default"),
  };
}

function pressureLevel(items: MediaLedgerItem[], budget: MediaBudget): PressureLevel {
  const serialized = items.reduce((sum, item) => sum + item.serializedBytes, 0);
  const decoded = items.reduce((sum, item) => sum + item.decodedBytes, 0);
  const largest = items.reduce((max, item) => Math.max(max, item.serializedBytes), 0);
  const utilization = Math.max(
    items.length / budget.maxMediaBlocks,
    serialized / budget.maxSerializedMediaBytes,
    decoded / budget.maxDecodedMediaBytes,
    largest / budget.maxSerializedBytesPerImage,
  );
  if (utilization > 1) return "red";
  if (utilization >= 0.6) return "yellow";
  return "green";
}

export function planMediaBudget(items: MediaLedgerItem[], budget: MediaBudget): BudgetPlan {
  const ranked = [...items].sort(
    (left, right) =>
      right.priority - left.priority ||
      left.age - right.age ||
      right.messageIndex - left.messageIndex ||
      comparePathsDesc(left.path, right.path),
  );
  const kept = new Set<MediaLedgerItem>();
  const duplicateRejected = new Set<MediaLedgerItem>();
  const perImageRejected = new Set<MediaLedgerItem>();
  const seenHashes = new Set<string>();
  let blocks = 0;
  let serializedBytes = 0;
  let decodedBytes = 0;

  for (const item of ranked) {
    if (seenHashes.has(item.hash)) {
      duplicateRejected.add(item);
      continue;
    }
    seenHashes.add(item.hash);
    if (item.serializedBytes > budget.maxSerializedBytesPerImage) {
      perImageRejected.add(item);
      continue;
    }
    if (
      blocks + 1 <= budget.maxMediaBlocks &&
      serializedBytes + item.serializedBytes <= budget.maxSerializedMediaBytes &&
      decodedBytes + item.decodedBytes <= budget.maxDecodedMediaBytes
    ) {
      kept.add(item);
      blocks += 1;
      serializedBytes += item.serializedBytes;
      decodedBytes += item.decodedBytes;
    }
  }

  const decisions: BudgetDecision[] = items.map((item) => {
    if (kept.has(item)) return { item, action: "keep" };
    return {
      item,
      action: "externalize",
      reason: duplicateRejected.has(item)
        ? "duplicate"
        : perImageRejected.has(item)
          ? "per-image-budget"
          : "aggregate-budget",
    };
  });
  return { decisions, pressure: pressureLevel(items, budget) };
}

function comparePathsDesc(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (right[index] ?? -1) - (left[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}
