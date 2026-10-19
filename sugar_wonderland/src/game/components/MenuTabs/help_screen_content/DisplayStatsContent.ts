import type { BorderOpts } from '../ContentSection';
import type { ContentSection } from '../ContentSection';
import { HELP_BALANCE_DESC, COMMON_BALANCE, HELP_TOTALWIN_DESC, COMMON_TOTAL_WIN, HELP_BET_DESC, COMMON_BET, HELP_DISPLAY_STATS_TITLE } from '../../../../backend/LocalizationData';
import { CurrencyManager } from '../../CurrencyManager';

const sectionBorderOpts: BorderOpts = {
    margin: 28,
    padding: 16,
    style: { fillColor: 0x000000, strokeColor: 0x00ff00, fillAlpha: 1, strokeAlpha: 1 },
};

/**
 * Creates a currency formatting marker that will be processed at render time.
 * This ensures CurrencyManager is initialized before formatting.
 */
function formatCurrencyAmount(amount: number): string {
    return `CURRENCY:${amount}`;
}

const balanceTextSection: ContentSection = {
    Content: [
        {
            Text: {
                key: HELP_BALANCE_DESC,
                value: 'Shows your current available credits.',
            }
        }
    ]
};

const balanceSection: ContentSection = {
    Border: {
        opts: sectionBorderOpts
    },
    Content: [
        {
            Text: {
                key: COMMON_BALANCE,
                value: 'BALANCE',
                opts: {
                    style: {
                        fontSize: '20px',
                        fontFamily: 'Poppins-Bold',
                        color: '#3FFF0D',
                    },
                    align: 0.5,
                    anchor: { x: 0.5 },
                    padding: 3
                },
            }
        },
        {
            Text: {
                value: formatCurrencyAmount(200000.00),
                opts: {
                    style: {
                        fontSize: '24px',
                        fontFamily: 'Poppins-Bold',
                        color: '#FFFFFF',
                    },
                    align: 0.5,
                    anchor: { x: 0.5 },
                    padding: 3
                },
            }
        }
    ]
};

const totalWinTextSection: ContentSection = {
    Content: [
        {
            Text: {
                key: HELP_TOTALWIN_DESC,
                value: 'Displays your total winnings from the current round.',
            }
        }
    ]
};

const totalWinSection: ContentSection = {
    Border: {
        opts: sectionBorderOpts
    },
    Content: [
        {
            Text: {
                key: COMMON_TOTAL_WIN,
                value: 'TOTAL WIN',
                opts: {
                    style: {
                        fontSize: '20px',
                        fontFamily: 'Poppins-Bold',
                        color: '#3FFF0D',
                    },
                    align: 0.5,
                    anchor: { x: 0.5 },
                    padding: 3
                },
            }
        },
        {
            Text: {
                value: formatCurrencyAmount(200000.00),
                opts: {
                    style: {
                        fontSize: '24px',
                        fontFamily: 'Poppins-Bold',
                        color: '#FFFFFF',
                    },
                    align: 0.5,
                    anchor: { x: 0.5 },
                    padding: 3
                },
            }
        }
    ]
};

const betTextSection: ContentSection = {
    Content: [
        {
            Text: {
                key: HELP_BET_DESC,
                value: 'Adjust your wager using the – and + buttons.'
            }
        }
    ]
};

const betSection: ContentSection = {
    Border: {
        opts: sectionBorderOpts
    },
    Content: [
        {
            Text: {
                key: COMMON_BET,
                value: 'BET',
                opts: {
                    style: {
                        fontSize: '20px',
                        fontFamily: 'Poppins-Bold',
                        color: '#3FFF0D',
                    },
                    align: 0.5,
                    anchor: { x: 0.5 },
                    padding: 3
                },
            }
        },
        {
            RichText: {
                opts: { 
                    align: 0.5,
                    anchor: { x: 0.5 },
                    offset: { x: 0, y: 10 },
                    margin: -10,
                },
                parts: [
                    {
                        TextImage: {
                            key: 'betControlsMinus',
                            opts: {
                            },
                        }
                    },
                    {
                        Text: {
                            value: '125',
                            style: {
                                fontSize: '24px',
                                fontFamily: 'Poppins-Bold',
                                color: '#FFFFFF',
                            }
                        }
                    },
                    {
                        TextImage: {
                            key: 'betControlsPlus',
                            opts: {
                            },
                        }
                    }
                ]
            }
        }
    ]
};
export const displayStatsSection: ContentSection = {
    Content: [
        {
            Header: {
                key: HELP_DISPLAY_STATS_TITLE,
                value: 'Display & Stats',
                opts: {
                    padding: { top: 30 },
                },
            }
        },
        { ChildSection: balanceSection },
        { ChildSection: balanceTextSection },
        { ChildSection: totalWinSection },
        { ChildSection: totalWinTextSection },
        { ChildSection: betSection },
        { ChildSection: betTextSection },
    ]
};
