import { ContentSection } from "../ContentSection";
import { HELP_GAME_SETTINGS, HELP_PAYLINES_TITLE, HELP_PAYLINES_DESC0, HELP_PAYLINES_DESC1, HELP_PAYLINES_WIN, HELP_PAYLINES_NO_WIN } from '../../../../backend/LocalizationData';

export const gameSettingsContent: ContentSection = {
    Header: {
        key: HELP_GAME_SETTINGS,
        value: 'Game Settings',
    },
    Border: {
        opts: {
            margin: { top: 12, bottom: 12 },
            padding: 20,
        },
    },
    Content: [
        {
            Header: 
            {
                key: HELP_PAYLINES_TITLE,
                value: 'Paylines',
            }
        },
        {
            Text: {
                opts: {
                    padding: { top: 20, bottom: 20 },
                },
                key: HELP_PAYLINES_DESC0,
                value: 'Symbols can land anywhere on the screen.',
            }
        },
        {
            Text: {
                key: HELP_PAYLINES_WIN,
                value: 'Win',
                opts: {
                    style: {
                        fontSize: '26px',
                    },
                    align: 0.5,
                    anchor: { x: 0.5, y: 0 },
                },
            }
        },
        {
            Image: {
                opts: {
                    padding: { top: 15, bottom: 25 },
                    align: 0.5,
                    anchor: { x: 0.5, y: 0 },
                    size: 'fitToWidth',
                },
                key: 'help_tumbles_win',
            },
        },
        {
            Text: {
                key: HELP_PAYLINES_NO_WIN,
                value: 'No Win',
                opts: {
                    style: {
                        fontSize: '26px',
                    },
                    align: 0.5,
                    anchor: { x: 0.5, y: 0 },
                },
            }
        },
        {
            Image: {
                opts: {
                    padding: { top: 15, bottom: 25 },
                    align: 0.5,
                    anchor: { x: 0.5, y: 0 },
                    size: 'fitToWidth',
                },
                key: 'help_tumbles_no-win',
            },
        },
        {
            Text: {
                opts: {
                    padding: { top: 40, bottom: 10 },
                },
                key: HELP_PAYLINES_DESC1,
                value: 'All wins are multiplied by the base bet.\nWhen multiple symbol wins occur, all values are combined into the total win.\nFree spins rewards are granted after the round ends.',
            }
        }
    ]
};
