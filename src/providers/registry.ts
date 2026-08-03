import type { PayloadFootprint } from "./openai-responses.js";
import {
  emergencyProjectOpenAIResponsesPayload,
  inspectOpenAIResponsesPayload,
} from "./openai-responses.js";

/**
 * Final-payload audit for one provider wire format. Adding a provider means
 * adding an adapter here; the extension wiring does not change.
 */
export interface ProviderPayloadAdapter {
  /** Counts the structural media blocks the emergency projection can rewrite. */
  inspect(payload: unknown): PayloadFootprint;
  /** Replaces those media blocks with text notes, without mutating the input. */
  emergencyProject(payload: unknown): unknown;
}

export const PROVIDER_PAYLOAD_ADAPTERS: Readonly<Record<string, ProviderPayloadAdapter>> =
  Object.freeze({
    "openai-codex": Object.freeze({
      inspect: inspectOpenAIResponsesPayload,
      emergencyProject: emergencyProjectOpenAIResponsesPayload,
    }),
  });
