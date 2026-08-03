import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface MediaLedgerItem {
  messageIndex: number;
  contentIndex: number;
  kind: "image";
  mimeType: string;
  hash: string;
  serializedBytes: number;
  decodedBytes: number;
  age: number;
  currentWorkingSet: boolean;
  priority: number;
  /** Where the media entered the session, e.g. `tool read({"path":"a.png"})`. */
  origin: string;
}

export interface MediaImage {
  data: string;
  mimeType: string;
  hash: string;
}

export interface ImageTarget {
  maxWidth: number;
  maxHeight: number;
  maxSerializedBytes: number;
}

export interface EncodedImage {
  data: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface ImageCodec {
  constrain(image: MediaImage, target: ImageTarget): Promise<EncodedImage | null>;
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

export interface GuardReport {
  mode: GuardMode;
  /** True when `enabled: false` bypassed the guard entirely for this request. */
  disabled?: boolean;
  pressure: PressureLevel;
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

export interface MediaFootprint {
  blocks: number;
  serializedBytes: number;
  decodedBytes: number;
}

export interface GuardResult {
  messages: AgentMessage[];
  report: GuardReport;
  /**
   * Per-image outcomes for the projected request. In `protect` mode these are
   * the decisions that were applied; in `observe`/`optimize` they are what
   * `protect` would have decided, for diagnostics only.
   */
  decisions: BudgetDecision[];
}

export interface MediaGuard {
  project(messages: AgentMessage[], environment: GuardEnvironment): Promise<GuardResult>;
}
