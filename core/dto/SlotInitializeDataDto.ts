import type { InitFreeSpinRoundDto } from "./InitFreeSpinRoundDto";
import type { UnresolvedSpinDto } from "./UnresolvedSpinDto";

/**
 * Response payload for the /api/v1/slots/initialize endpoint.
 *
 * Specialize as `SlotInitializeDataDto<SpinData>` when wiring a game.
 *
 * Legacy `freeSpinRound` shapes (`number` / loose object) are normalized in
 * GameAPI, not represented here.
 *
 * `hasUnresolvedSpin` / `unresolvedSpinIndex` are not read by Sugar (resume
 * keys off `unresolvedSpin`).
 */
export interface SlotInitializeDataDto<TSpinData = unknown> {
    gameId: string;
    playerId?: string;
    sessionId: string;
    lang: string;
    currency: string;
    currencySymbol?: string;
    currencyDecimalPlaces?: number;
    betLevels?: number[];
    defaultBetIndex?: number;
    hasFreeSpinRound: boolean;
    freeSpinRound: InitFreeSpinRoundDto[] | null;
    hasUnresolvedSpin?: boolean;
    unresolvedSpinIndex?: number;
    unresolvedSpin?: UnresolvedSpinDto<TSpinData> | null;
    maxWin?: number | null;
    rtpRange?: string | null;
}
