/**
 * Unresolved spin from slot initialization / resume.
 *
 * `response` is the game's spin payload. Games specialize as
 * `UnresolvedSpinDto<SpinData>`. Core defaults to `unknown` so this DTO does not
 * depend on a per-game `SpinData`.
 *
 * `mode` is stored on some backends but not read by Sugar yet.
 */
export interface UnresolvedSpinDto<TSpinData = unknown> {
    uuid: string;
    index: number;
    response: TSpinData;
    betSize?: string;
    mode?: string;
}
