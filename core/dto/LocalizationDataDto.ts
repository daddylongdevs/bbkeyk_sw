/**
 * Response payload for the localization / locale endpoint.
 *
 * Named `LocalizationDataDto` to distinguish from per-game `LocalizationData.ts`
 * help-string maps.
 *
 * `maxWin` / `rtp` are null when the locale response omits them
 * (demo, missing locale, or mapper fallback).
 * `sessionId` / `gameId` / `lang` are echoed from the request. Games may use
 * `lang` as a fallback when initialization does not provide a logo language.
 */
export interface LocalizationDataDto {
    sessionId?: string;
    gameId?: string;
    lang?: string;
    locale: string | null;
    maxWin: number | null;
    rtp: string | null;
}
