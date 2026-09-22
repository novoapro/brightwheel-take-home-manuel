import type { Provider } from "../types";
import { ClaudeFrontDeskModel } from "./claude";
import type { FrontDeskModel } from "./types";

/**
 * Provider factory. Claude is the default and only shipped implementation in
 * v1; the Gemini implementation lands in M7 behind this same seam, so call
 * sites never change. An unknown/unbuilt provider falls back to Claude.
 */
export function getModel(provider: Provider = "claude"): FrontDeskModel {
  switch (provider) {
    case "claude":
      return new ClaudeFrontDeskModel();
    case "gemini":
      // M7 — GeminiFrontDeskModel. Fall back to Claude until it ships.
      return new ClaudeFrontDeskModel();
    default:
      return new ClaudeFrontDeskModel();
  }
}

export type { FrontDeskModel } from "./types";
