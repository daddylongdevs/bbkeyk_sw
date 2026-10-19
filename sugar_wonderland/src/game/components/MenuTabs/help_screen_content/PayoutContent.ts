import type { BorderOpts, ContentItem, ContentSection, GridCell, TextOpts } from '../ContentSection';
import { CurrencyManager } from '../../CurrencyManager';
import { formatCurrencyNumber } from '../../../../utils/NumberPrecisionFormatter';
import { HELP_PAYOUT_TITLE, HELP_SCATTER_TITLE, HELP_SCATTER_DESC } from '../../../../backend/LocalizationData';

interface PayoutContentOptions {
    defaultOuterBorderStyle: BorderOpts;
    getBetAmount: () => number;
    getIsDemo?: () => boolean;
}

const SYMBOL_CHILD_SECTION_GAP = 10;

const symbolCount = 9;
const baseSymbolKey = 'symbol';
export const scatterSymbolKey = `${baseSymbolKey}0`;

const symbolImageScaleMultiplier: Record<number, number> = {
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
};

/**
 * Returns the symbol image scale multiplier for the given image key (e.g. symbol1 -> 1).
 * Used only for visual scaling; layout (border/grid) uses base size.
 */
function getSymbolScaleMultiplier(imageKey: string): number {
    const match = new RegExp(`${baseSymbolKey}(\\d+)`).exec(imageKey);
    if (match == null) return 1;
    const index = parseInt(match[1], 10);
    return symbolImageScaleMultiplier[index] ?? 1;
}

// Payout ranges: maps symbol index to array of range strings
const payoutRanges: Record<number, string[]> = {
    0: ['6', '5', '4'],
    1: ['12 - 30', '10 - 11', '8 - 9'],
};

// Symbol payouts: maps symbol index to array of payout values (variable length)
const symbolPayouts: Record<number, number[]> = {
    0: [100.0, 5.0, 3.0],
    1: [50.0, 25.0, 10.0],
    2: [25.0, 10.0, 2.5],
    3: [15.0, 5.0, 2.0],
    4: [12.0, 2.0, 1.0],
    5: [10.0, 1.5, 1.0],
    6: [8.0, 1.2, 0.8],
    7: [5.0, 1.0, 0.5],
    8: [4.0, 0.9, 0.4],
    9: [2.0, 0.75, 0.25],
};

/** Text opts for the range column (e.g. "12 - 30") in symbol payout grid. Edit here to change style. */
const symbolPayoutRangeTextOpts: TextOpts = {
    padding: 0,
    align: 0,
    anchor: { x: 0, y: 0.5 },
    style: { fontSize: '20px', fontFamily: 'Poppins-Regular', fontStyle: 'bold', color: '#FFFFFF' },
    fitToBounds: true,
};

/** Text opts for the payout column (e.g. "50.00") in symbol payout grid. Edit here to change style. */
const symbolPayoutPayoutTextOpts: TextOpts = {
    padding: 0,
    align: 1,
    anchor: { x: 1, y: 0.5 },
    style: { fontSize: '20px', fontFamily: 'Poppins-Regular', color: '#FFFFFF' },
    fitToBounds: true,
};

/**
 * Formats a payout value using project precision (NumberPrecisionFormatter).
 */
function formatPayout(value: number): string {
    return formatCurrencyNumber(value);
}

/**
 * Applies the current bet amount to a base payout value.
 */
function applyBetToPayout(baseValue: number, getBetAmount: () => number): number {
    const betAmount = getBetAmount();
    const result = baseValue * betAmount;
    console.log(`[PayoutContent] applyBetToPayout: ${baseValue} * ${betAmount} = ${result}`);
    return result;
}

/**
 * Builds grid cells for a payout table from range strings and payout values.
 */
function buildPayoutGridCells(
    payoutRangesForSymbol: string[],
    payoutValues: number[],
    getBetAmount: () => number,
    getIsDemo?: () => boolean
): GridCell[] {
    const gridCells: GridCell[] = [];
    const numRows = payoutValues.length;
    for (let row = 0; row < numRows; row++) {
        const rangeValue = payoutRangesForSymbol && payoutRangesForSymbol.length > 0
            ? (row < payoutRangesForSymbol.length
                ? payoutRangesForSymbol[row]
                : payoutRangesForSymbol[payoutRangesForSymbol.length - 1])
            : '';
        const payoutValue = payoutValues[row] ?? 0;
        const adjustedPayout = applyBetToPayout(payoutValue, getBetAmount);
        const formattedPayout = formatPayout(adjustedPayout);

        const isDemo = getIsDemo?.() ?? false;
        const currencyPrefix = isDemo ? '' : CurrencyManager.getCurrencyCode();
        // Use non-breaking space (\u00A0) to prevent currency and value from wrapping to separate lines
        const payoutText = currencyPrefix ? `${currencyPrefix}\u00A0${formattedPayout}` : formattedPayout;

        gridCells.push({
            Text: {
                opts: { ...symbolPayoutRangeTextOpts },
                value: rangeValue,
            },
        });
        gridCells.push({
            Text: {
                opts: { ...symbolPayoutPayoutTextOpts },
                value: payoutText,
            },
        });
    }
    return gridCells;
}

/**
 * Creates a symbol child ContentSection based on the base template.
 */
function createSymbolChildContentSection(
    imageKey: string,
    payoutRangesForSymbol: string[],
    payoutValues: number[],
    baseSymbolChildContentSection: ContentSection,
    getBetAmount: () => number,
    getIsDemo?: () => boolean
): ContentSection {
    const numRows = payoutValues.length;
    const gridCells = buildPayoutGridCells(payoutRangesForSymbol, payoutValues, getBetAmount, getIsDemo);

    const baseRowItem = baseSymbolChildContentSection.Content![0];
    if (!('Row' in baseRowItem) || !baseRowItem.Row) {
        throw new Error('[PayoutContent] Base section must contain a Row item');
    }

    const baseImageItem = baseRowItem.Row.items[0];
    const baseGridItem = baseRowItem.Row.items[1];
    if (!('Image' in baseImageItem) || !('Grid' in baseGridItem)) {
        throw new Error('[PayoutContent] Base section Row must contain Image and Grid items');
    }

    return {
        Border: baseSymbolChildContentSection.Border,
        Content: [
            {
                Row: {
                    opts: baseRowItem.Row.opts,
                    items: [
                        {
                            Image: {
                                opts: {
                                    ...baseImageItem.Image.opts,
                                    scale: getSymbolScaleMultiplier(imageKey),
                                    scaleAffectsLayout: false,
                                },
                                key: imageKey,
                            },
                        },
                        {
                            Grid: {
                                opts: {
                                    columns: 2, // Always 2 columns for payout grid
                                    rows: numRows,
                                    alignment: baseGridItem.Grid.opts?.alignment ?? 'justified',
                                    gap: baseGridItem.Grid.opts?.gap ?? { x: 8, y: 8 },
                                    spacing: baseGridItem.Grid.opts?.spacing ?? 'fitToWidth',
                                    verticalSpacing: baseGridItem.Grid.opts?.verticalSpacing ?? 0,
                                    horizontalSpacing: baseGridItem.Grid.opts?.horizontalSpacing ?? 0,
                                    columnWidthPercents: baseGridItem.Grid.opts?.columnWidthPercents ?? [50, 50],
                                    padding: baseGridItem.Grid.opts?.padding,
                                    align: baseGridItem.Grid.opts?.align,
                                    offset: baseGridItem.Grid.opts?.offset,
                                    anchor: baseGridItem.Grid.opts?.anchor,
                                },
                                cells: gridCells,
                            },
                        },
                    ],
                },
            },
        ],
    };
}

/**
 * Generates the symbol payout content section dynamically based on symbolCount and baseSymbolKey.
 */
function getSymbolPayoutContent(
    baseSymbolChildContentSection: ContentSection,
    getBetAmount: () => number,
    getIsDemo?: () => boolean
): ContentSection {
    const childSections: ContentSection[] = [];

    for (let symbolIndex = 1; symbolIndex <= symbolCount; symbolIndex++) {
        const payoutData = symbolPayouts[symbolIndex];
        if (!payoutData || payoutData.length === 0) continue;

        // Get payout ranges for this symbol, or use the last valid payoutRange if index not found
        let symbolRanges = payoutRanges[symbolIndex];
        if (!symbolRanges) {
            const payoutRangeKeys = Object.keys(payoutRanges).map(Number).sort((a, b) => b - a);
            const lastValidKey = payoutRangeKeys.length > 0 ? payoutRangeKeys[0] : undefined;
            symbolRanges = lastValidKey !== undefined ? payoutRanges[lastValidKey] : [];
        }

        const imageKey = `${baseSymbolKey}${symbolIndex}`;
        const childSection = createSymbolChildContentSection(
            imageKey,
            symbolRanges,
            payoutData,
            baseSymbolChildContentSection,
            getBetAmount,
            getIsDemo
        );

        childSections.push(childSection);
    }

    const contentItems: ContentItem[] = childSections.map((section) => ({ ChildSection: section }));
    return {
        Header: {
            opts: { padding: { top: 12, bottom: 12 }, align: 0, anchor: { x: 0, y: 0 }, style: { fontSize: 24, fontFamily: 'Poppins-Regular' } },
            key: HELP_PAYOUT_TITLE,
            value: 'Payout',
        },
        Content: contentItems,
    };
}

function getScatterPayoutContent(
    baseSymbolChildBorderStyle: BorderOpts,
    getBetAmount: () => number,
    getIsDemo?: () => boolean
): ContentSection {
    return {
        Border: {
            opts: { ...baseSymbolChildBorderStyle, margin: { bottom: 12, right: 0, left: 0 } },
        },
        Content: [
            {
                Header: {
                    opts: {},
                    key: HELP_SCATTER_TITLE,
                    value: 'Scatter',
                },
            },
            {
                Image: {
                    opts: {
                        padding: 2,
                        align: 0.5,
                        offset: { x: 0, y: 10 },
                        anchor: { x: 0.5, y: 0 },
                        scale: getSymbolScaleMultiplier(scatterSymbolKey),
                        scaleAffectsLayout: false,
                    },
                    key: scatterSymbolKey,
                },
            },
            {
                Grid: {
                    opts: {
                        padding: { top: 40, bottom: 40, right: 75, left: 75 },
                        columns: 2,
                        rows: (symbolPayouts[0] ?? []).length,
                        alignment: 'justified',
                        verticalSpacing: 8,
                        columnWidthPercents: [20],
                    },
                    cells: buildPayoutGridCells(payoutRanges[0], symbolPayouts[0], getBetAmount, getIsDemo),
                },
            },
            {
                Text: {
                    opts: { padding: 2 },
                    key: HELP_SCATTER_DESC,
                    value: 'This is the SCATTER symbol.\nSCATTER symbol is present on all reels.\nSCATTER pays on any position.',
                },
            },
        ],
    };
}

export function getPayoutContent(options: PayoutContentOptions): {
    symbolPayoutContent: ContentSection;
    scatterPayoutContent: ContentSection;
} {
    const baseSymbolChildContentSection: ContentSection = {
        Border: {
            opts: {
                ...options.defaultOuterBorderStyle,
                margin: { bottom: SYMBOL_CHILD_SECTION_GAP },
            },
        },
        Content: [
            {
                Row: {
                    opts: {
                        spacing: 'fit',
                        gap: 25,
                    },
                    items: [
                        {
                            Image: {
                                opts: {
                                    align: 0.5,
                                    offset: { x: 20, y: 0 },
                                    anchor: { x: 0.5, y: 0.5 },
                                    size: 'fitToHeight',
                                    maxHeight: 100,
                                },
                                key: '',
                            },
                        },
                        {
                            Grid: {
                                opts: {
                                    columns: 2,
                                    rows: 0,
                                    alignment: 'justified',
                                    spacing: 'fitToWidth',
                                    verticalSpacing: 10,
                                    columnWidthPercents: [35],
                                },
                                cells: [],
                            },
                        },
                    ],
                },
            },
        ],
    };

    const symbolPayoutContent = getSymbolPayoutContent(
        baseSymbolChildContentSection,
        options.getBetAmount,
        options.getIsDemo
    );
    const scatterPayoutContent = getScatterPayoutContent(
        options.defaultOuterBorderStyle,
        options.getBetAmount,
        options.getIsDemo
    );

    return { symbolPayoutContent, scatterPayoutContent };
}
