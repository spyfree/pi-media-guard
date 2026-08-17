import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import type { Message } from "@deepseek-ai/dsh-llm";

export interface MediaLedgerItem {
  messageIndex: number;
  /**
   * Content indexes from the message root to the image block. A top-level
   * image has one segment; images nested inside tool-result blocks add one
   * segment per nesting level.
   */
  path: readonly number[];
  kind: "image";
  mediaType: string;
  /** Content-addressed identity from the attachment service (`sha256:<hex>`). */
  hash: string;
  /** Bytes a Base64-embedding serializer will spend on this image. */
  serializedBytes: number;
  /** Exact encoded byte length of the stored image (`ref.bytes`). */
  decodedBytes: number;
  width: number;
  height: number;
  age: number;
  currentWorkingSet: boolean;
  priority: number;
  /** Where the media entered the session, e.g. `tool read_image({"path":"a.png"})`. */
  origin: string;
  /** The live attachment reference, used for codec replacement. */
  ref: ImageAttachmentRef;
}

export interface ImageTarget {
  maxWidth: number;
  maxHeight: number;
  maxSerializedBytes: number;
}

/**
 * Produces a smaller stored variant of an image and returns its reference.
 * Implementations own the byte work (read, re-encode, save); the guard
 * pipeline never touches image bytes. Returning null means the image cannot
 * be constrained and the planner externalizes it instead.
 */
export interface ImageCodec {
  constrain(ref: ImageAttachmentRef, target: ImageTarget): Promise<ImageAttachmentRef | null>;
}

export interface MediaBudget {
  maxMediaBlocks: number;
  maxSerializedMediaBytes: number;
  maxDecodedMediaBytes: number;
  maxSerializedBytesPerImage: number;
}

export type GuardMode = "observe" | "optimize" | "protect";
export type PressureLevel = "green" | "yellow" | "red";
export type ProjectionReason = "duplicate" | "per-image-budget" | "aggregate-budget";

export interface BudgetDecision {
  item: MediaLedgerItem;
  action: "keep" | "externalize";
  reason?: ProjectionReason;
}

export interface BudgetPlan {
  decisions: BudgetDecision[];
  pressure: PressureLevel;
}

export type MediaBudgetOverride = Partial<MediaBudget>;
export type MediaBudgetProfiles = Readonly<Record<string, MediaBudgetOverride>>;

export interface GuardEnvironment {
  /** The provider route of the outgoing request (`GenerateOptions.provider`). */
  provider?: string;
  mode?: GuardMode;
  budgetProfile?: string;
  profiles?: MediaBudgetProfiles;
  budget?: MediaBudgetOverride;
}

export interface ResolvedMediaBudget {
  budget: MediaBudget;
  profile: string;
}

export interface MediaFootprint {
  blocks: number;
  serializedBytes: number;
  decodedBytes: number;
}

export interface GuardReport {
  mode: GuardMode;
  /** Pressure of the original request before compression or externalization. */
  pressure: PressureLevel;
  /** Pressure of the request that will currently be sent to the provider. */
  currentPressure: PressureLevel;
  budget: MediaBudget;
  budgetProfile: string;
  before: MediaFootprint;
  after: MediaFootprint;
  kept: number;
  compressed: number;
  externalized: number;
  externalizedCurrent: number;
  deduplicated: number;
}

export interface GuardResult {
  messages: Message[];
  report: GuardReport;
  /**
   * Per-image outcomes for the projected request. In `protect` mode these are
   * the decisions that were applied; in `observe`/`optimize` they are what
   * `protect` would have decided, for diagnostics only.
   */
  decisions: BudgetDecision[];
}

export interface MediaGuard {
  project(messages: Message[], environment: GuardEnvironment): Promise<GuardResult>;
}
