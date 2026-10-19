export const HistoryItemType = {
    FREE_SPIN: "free_spin",
    NORMAL: "normal",
} as const;

export type HistoryItemType =
    (typeof HistoryItemType)[keyof typeof HistoryItemType];

/**
 * A single game-history entry.
 *
 * Not wired in Sugar yet — fields stay optional until a history UI reads them.
 */
export interface HistoryItemDto {
    id?: number;
    roundId?: string;
    type?: HistoryItemType;
    gameId?: string;
    gameName?: string;
    currency?: string;
    bet?: string;
    win?: string;
    jackpotWin?: string;
    createdAt?: string;
}
