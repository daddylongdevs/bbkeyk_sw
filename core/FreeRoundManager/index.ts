/**
 * Core FreeRoundManager exports.
 *
 * For integration checklist, contracts, and Game.ts wiring, see:
 * @see ./IMPLEMENTATION.md
 */
export { FreeRoundManager } from "./FreeRoundManager";
export {
  DEFAULT_FREE_ROUND_TEXTURES,
  FREE_ROUND_TEXT_FALLBACKS,
  FreeRoundEventName,
  FreeRoundTextKey,
  extractTotalWin,
} from "./types";
export type {
  FreeRoundEventBusPort,
  FreeRoundGameAPIPort,
  FreeRoundGameStatePort,
  FreeRoundInitializationData,
  FreeRoundManagerCreateOptions,
  FreeRoundManagerDeps,
  FreeRoundSlotControllerPort,
  FreeRoundTextKeyId,
  FreeRoundTextureKeys,
} from "./types";
