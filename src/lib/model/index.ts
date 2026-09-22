import type { Provider } from "../types";
import { ClaudeFrontDeskModel } from "./claude";
import { GeminiFrontDeskModel } from "./gemini";
import type { FrontDeskModel } from "./types";

/**
 * Provider factory. Claude is the default; Gemini (3.x Flash) is the A/B toggle
 * behind the same seam, so call sites never change. Both ship as real
 * implementations — provider portability you can measure, not just assert.
 */
export function getModel(provider: Provider = "claude"): FrontDeskModel {
  switch (provider) {
    case "gemini":
      return new GeminiFrontDeskModel();
    case "claude":
    default:
      return new ClaudeFrontDeskModel();
  }
}

export type { FrontDeskModel } from "./types";
