/** Backend `fsStatus` values on an `isFs` bet response. */
export const FreeRoundStatus = {
    COMPLETE: "complete",
    PENDING: "pending",
    PARTIAL: "partial",
    CANCELLED: "cancelled",
    FAILED: "failed",
} as const;

export type FreeRoundStatus =
    (typeof FreeRoundStatus)[keyof typeof FreeRoundStatus];

/**
 * Bet-response envelope when posting `isFs: true` (initialization free-round mode).
 *
 * Shared across games except `slot`. Games specialize as
 * `FreeRoundBetResponseDto<SlotData>`. Not `InitFreeSpinRoundDto` (that's the init
 * grant) and not `SpinData` (that's the playable spin).
 *
 * `fsCount` is remaining promotional spins after this bet. `fsStatus` / `fsTotal`
 * drive FreeRoundManager end-of-grant modals when present; omitted `fsStatus`
 * is treated as `pending`. `fsTotalAccumulatedWin` is the credited amount shown
 * on complete / partial panels.
 */
export interface FreeRoundBetResponseDto<TSlot = unknown> {
    balance: number;
    fsCount: number;
    fsStatus?: FreeRoundStatus;
    fsTotal?: number;
    fsTotalAccumulatedWin?: number;
    slot: TSlot;
}

/**
 * `FREEROUND_COUNT_UPDATE` payload from an `isFs` bet.
 * `fsTotalAccumulatedWin` is the grant win shown on complete / partial panels.
 * `totalWin` is still `slot.totalWin` from that response (per-spin, not modal).
 */
export interface FreeRoundCountUpdateDto {
    fsCount: number;
    fsStatus: FreeRoundStatus;
    fsTotal?: number;
    fsTotalAccumulatedWin?: number;
    balance?: number;
    totalWin?: number;
}

export function resolveFreeRoundStatus(raw: unknown): FreeRoundStatus {
    const value = typeof raw === "string" ? raw.toLowerCase() : "";
    switch (value) {
        case FreeRoundStatus.COMPLETE:
        case FreeRoundStatus.PARTIAL:
        case FreeRoundStatus.CANCELLED:
        case FreeRoundStatus.FAILED:
        case FreeRoundStatus.PENDING:
            return value;
        default:
            return FreeRoundStatus.PENDING;
    }
}

/** Failed / cancelled envelopes must not play reel results. */
export function isUnplayedFreeRoundStatus(status: FreeRoundStatus): boolean {
    return status === FreeRoundStatus.FAILED || status === FreeRoundStatus.CANCELLED;
}

/**
 * True when this isFs envelope has no playable reel result.
 *
 * Complete, partial, and pending responses settle through the normal spin
 * wallet flow, even when FreeRoundManager subsequently opens a status modal.
 * Failed/cancelled responses are reconciled after their modal closes because
 * their reel presentation is aborted.
 */
export function shouldDeferFreeRoundWalletUntilModal(
    update: FreeRoundCountUpdateDto | null | undefined,
): boolean {
    if (!update) {
        return false;
    }
    const status = resolveFreeRoundStatus(update.fsStatus);
    return isUnplayedFreeRoundStatus(status);
}
