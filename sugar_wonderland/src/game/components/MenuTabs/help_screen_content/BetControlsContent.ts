import type { ContentSection } from '../ContentSection';
import { HELP_BET_CONTROLS_TITLE, HELP_BUTTONS_LABEL, HELP_BET_CONTROLS_DESC } from '../../../../backend/LocalizationData';

export const betControlsSection: ContentSection = {
    Header: {
        key: HELP_BET_CONTROLS_TITLE,
        value: 'Bet Controls',
    },
    Border: {
        opts: {
            margin: 16,
            padding: 16,
            style: { fillColor: 0xffffff, strokeColor: 0xffffff, fillAlpha: 0.1, strokeAlpha: 0.0 },
        }
    },
    Content: [
        {
            RichText: {
                opts: {
                    padding: { bottom: 12},
                },
                    parts: [
                        {
                            TextImage: {
                                key: 'betControlsMinus',
                                opts: {
                                    padding: { right: 6},
                                },
                            }
                        },
                        {
                            TextImage: {
                                key: 'betControlsPlus',
                                opts: {
                                    padding: { left: 6, right: 12 },
                                },
                            }
                        },
                        {
                            Text: {
                                key: HELP_BUTTONS_LABEL,
                                value: 'Buttons',
                                fitToSingleLine: true,
                                minFontSize: 16,
                                style: {
                                    fontSize: '24px',
                                },
                            }
                        }
                ]
            }
        },
        {
            Text: {
                key: HELP_BET_CONTROLS_DESC,
                value: 'Adjust your total bet',
            }
        }
    ]
};
