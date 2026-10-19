import type { SlotControllerState } from "./types";

export function getDisplayedBonusSpinCount(state: SlotControllerState): number {
  if (!state.isBonusModeActive) {
    return 0;
  }

  return Math.max(0, state.remainingBonusSpins + (state.canSpin ? 0 : 1));
}

export function getDisplayedFreeRoundSpinCount(state: SlotControllerState): number {
  if (!state.isFreeRoundModeActive) {
    return 0;
  }

  return Math.max(0, state.remainingFreeRoundSpins);
}
