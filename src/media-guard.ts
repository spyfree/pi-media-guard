import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
  BudgetDecision,
  EncodedImage,
  GuardEnvironment,
  GuardResult,
  ImageCodec,
  MediaBudget,
  MediaGuard,
  MediaLedgerItem,
} from "./domain.js";
import { createEvidenceNote } from "./evidence-note.js";
import { buildMediaLedger, mediaFootprint } from "./ledger.js";
import { planMediaBudget, resolveMediaBudget } from "./policy.js";

function locationKey(messageIndex: number, contentIndex: number): string {
  return `${messageIndex}:${contentIndex}`;
}

function transformContentLeaves(
  messages: AgentMessage[],
  replacements: ReadonlyMap<string, TextContent | ImageContent>,
): AgentMessage[] {
  return messages.map((message, messageIndex) => {
    if (!("content" in message) || !Array.isArray(message.content)) return message;
    let changed = false;
    const content = message.content.map((block, contentIndex) => {
      const replacement = replacements.get(locationKey(messageIndex, contentIndex));
      if (!replacement) return block;
      changed = true;
      return replacement;
    });
    return changed ? ({ ...message, content } as AgentMessage) : message;
  });
}

function imageAt(messages: AgentMessage[], item: MediaLedgerItem): ImageContent | undefined {
  const message = messages[item.messageIndex];
  if (!message || !("content" in message) || !Array.isArray(message.content)) return undefined;
  const block = message.content[item.contentIndex];
  if (typeof block !== "object" || block === null || block.type !== "image") return undefined;
  return block;
}

function compressionTarget(items: MediaLedgerItem[], budget: MediaBudget): number {
  // Fair share is divided among the images that can actually be kept: unique
  // hashes capped at maxMediaBlocks. Dividing by the raw ledger length would
  // shrink the target as history and duplicates accumulate, degrading the
  // current image even though the planner keeps at most maxMediaBlocks images.
  const uniqueImages = new Set(items.map((item) => item.hash)).size;
  const keepable = Math.min(uniqueImages, budget.maxMediaBlocks);
  if (keepable === 0) return 0;
  const serializedShare = Math.floor(budget.maxSerializedMediaBytes / keepable);
  const decodedAsBase64Share = Math.floor((budget.maxDecodedMediaBytes * 4) / 3 / keepable);
  return Math.max(
    0,
    Math.min(budget.maxSerializedBytesPerImage, serializedShare, decodedAsBase64Share),
  );
}

async function constrainWithTimeout(
  codec: ImageCodec,
  image: Parameters<ImageCodec["constrain"]>[0],
  target: Parameters<ImageCodec["constrain"]>[1],
  timeoutMs: number,
): Promise<EncodedImage | null> {
  const operation = codec.constrain(image, target);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation;
  let timer: NodeJS.Timeout | undefined;
  try {
    // Promise.race attaches handlers to the operation, so a late rejection
    // after the timeout wins is not an unhandled rejection. A timed-out image
    // is treated like a failed compression and falls through to the planner.
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function constrainImages(
  messages: AgentMessage[],
  ledger: MediaLedgerItem[],
  budget: MediaBudget,
  codec: ImageCodec | undefined,
  timeoutMs: number,
): Promise<{ messages: AgentMessage[]; compressed: number }> {
  if (!codec) return { messages, compressed: 0 };
  const activeCodec = codec;
  const maxSerializedBytes = compressionTarget(ledger, budget);
  if (maxSerializedBytes <= 0) return { messages, compressed: 0 };

  const replacements = new Map<string, ImageContent>();
  // Every oversized instance is compressed, duplicates included: skipping
  // duplicate locations would leave them with a different hash than the
  // compressed primary, and the planner's dedup would stop collapsing them.
  // The caching codec turns the repeated work into a lookup.
  const candidates = ledger.filter((item) => item.serializedBytes > maxSerializedBytes);
  let nextCandidate = 0;
  async function worker(): Promise<void> {
    while (nextCandidate < candidates.length) {
      const item = candidates[nextCandidate++];
      if (!item) return;
      const image = imageAt(messages, item);
      if (!image) continue;
      let encoded: EncodedImage | null;
      try {
        encoded = await constrainWithTimeout(
          activeCodec,
          { data: image.data, mimeType: image.mimeType, hash: item.hash },
          { maxWidth: 2000, maxHeight: 2000, maxSerializedBytes },
          timeoutMs,
        );
      } catch {
        encoded = null;
      }
      if (
        !encoded ||
        Buffer.byteLength(encoded.data, "utf8") > maxSerializedBytes ||
        encoded.data.length === 0
      ) {
        continue;
      }
      replacements.set(locationKey(item.messageIndex, item.contentIndex), {
        type: "image",
        data: encoded.data,
        mimeType: encoded.mimeType,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, async () => worker()));
  return {
    messages: transformContentLeaves(messages, replacements),
    compressed: replacements.size,
  };
}

function replaceRejectedImages(
  messages: AgentMessage[],
  decisions: BudgetDecision[],
): AgentMessage[] {
  const replacements = new Map<string, TextContent>();
  for (const decision of decisions) {
    if (decision.action !== "externalize" || !decision.reason) continue;
    replacements.set(locationKey(decision.item.messageIndex, decision.item.contentIndex), {
      type: "text",
      text: createEvidenceNote(decision.item, decision.reason),
    });
  }
  return transformContentLeaves(messages, replacements);
}

class DefaultMediaGuard implements MediaGuard {
  constructor(
    private readonly codec?: ImageCodec,
    private readonly compressionTimeoutMs: number = DEFAULT_COMPRESSION_TIMEOUT_MS,
  ) {}

  async project(messages: AgentMessage[], environment: GuardEnvironment): Promise<GuardResult> {
    const originalLedger = buildMediaLedger(messages);
    const resolvedBudget = resolveMediaBudget(environment);
    const mode = environment.mode ?? "protect";
    const originalPlan = planMediaBudget(originalLedger, resolvedBudget.budget);
    const originalPressure = originalPlan.pressure;
    if (mode === "observe") {
      return {
        messages,
        decisions: originalPlan.decisions,
        report: {
          mode,
          pressure: originalPressure,
          currentPressure: originalPressure,
          budget: resolvedBudget.budget,
          budgetProfile: resolvedBudget.profile,
          before: mediaFootprint(originalLedger),
          after: mediaFootprint(originalLedger),
          kept: originalLedger.length,
          compressed: 0,
          externalized: 0,
          externalizedCurrent: 0,
          deduplicated: 0,
        },
      };
    }
    const constrained = await constrainImages(
      messages,
      originalLedger,
      resolvedBudget.budget,
      this.codec,
      this.compressionTimeoutMs,
    );
    const constrainedLedger = buildMediaLedger(constrained.messages);
    if (mode === "optimize") {
      const constrainedPlan = planMediaBudget(constrainedLedger, resolvedBudget.budget);
      return {
        messages: constrained.messages,
        decisions: constrainedPlan.decisions,
        report: {
          mode,
          pressure: originalPressure,
          currentPressure: constrainedPlan.pressure,
          budget: resolvedBudget.budget,
          budgetProfile: resolvedBudget.profile,
          before: mediaFootprint(originalLedger),
          after: mediaFootprint(constrainedLedger),
          kept: constrainedLedger.length,
          compressed: constrained.compressed,
          externalized: 0,
          externalizedCurrent: 0,
          deduplicated: 0,
        },
      };
    }
    const plan = planMediaBudget(constrainedLedger, resolvedBudget.budget);
    const projectedMessages = replaceRejectedImages(constrained.messages, plan.decisions);
    const projectedLedger = buildMediaLedger(projectedMessages);
    const currentPressure = planMediaBudget(projectedLedger, resolvedBudget.budget).pressure;
    const externalized = plan.decisions.filter((decision) => decision.action === "externalize");

    return {
      messages: projectedMessages,
      decisions: plan.decisions,
      report: {
        mode,
        pressure: originalPressure,
        currentPressure,
        budget: resolvedBudget.budget,
        budgetProfile: resolvedBudget.profile,
        before: mediaFootprint(originalLedger),
        after: mediaFootprint(projectedLedger),
        kept: plan.decisions.length - externalized.length,
        compressed: constrained.compressed,
        externalized: externalized.length,
        externalizedCurrent: externalized.filter((decision) => decision.item.currentWorkingSet)
          .length,
        deduplicated: externalized.filter((decision) => decision.reason === "duplicate").length,
      },
    };
  }
}

export const DEFAULT_COMPRESSION_TIMEOUT_MS = 10_000;

export interface CreateMediaGuardOptions {
  codec?: ImageCodec;
  /**
   * Upper bound on each image's compression attempt. A timed-out image is
   * treated like a failed compression: it stays oversized and the planner
   * externalizes it. Non-positive values disable the timeout.
   */
  compressionTimeoutMs?: number;
}

export function createMediaGuard(options: CreateMediaGuardOptions = {}): MediaGuard {
  return new DefaultMediaGuard(options.codec, options.compressionTimeoutMs);
}
