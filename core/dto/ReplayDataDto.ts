export interface ReplayDateTimeDto {
    date: string;
    time?: string;
}

/**
 * Cached payload for URL-driven replay mode (`replay=true`).
 *
 * `spinData` is the game's spin payload. Games specialize as
 * `ReplayDataDto<SpinData>`. Unused envelope fields stay optional until a
 * caller reads them.
 */
export interface ReplayDataDto<TSpinData = unknown> {
    id?: number;
    uuid?: string;
    round_id: string;
    type?: string;
    created_at: ReplayDateTimeDto;
    updated_at?: ReplayDateTimeDto;
    currency: string;
    currencySymbol?: string;
    spinData: TSpinData;
}
