/**
 * Structure of a single free spin round entry in the initialization payload.
 *
 * Promotional grant at session start. Per-spin remaining count / status live
 * on `FreeRoundBetResponseDto`, not here.
 */
export interface InitFreeSpinRoundDto {
    bet: string;
    totalFreeSpin: number;
    usedFreeSpin: number;
    remainingFreeSpin: number;
}
