import type { SlotControllerScheduler } from "./types";

export function createGlobalSlotControllerScheduler(): SlotControllerScheduler {
  if (
    typeof globalThis.setTimeout !== "function"
    || typeof globalThis.clearTimeout !== "function"
  ) {
    throw new Error("Global timer APIs are not available for SlotControllerCore");
  }

  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (timeoutId) => {
      globalThis.clearTimeout(timeoutId as ReturnType<typeof globalThis.setTimeout>);
    },
  };
}
