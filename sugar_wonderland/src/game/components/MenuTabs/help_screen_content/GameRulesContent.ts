import type { ContentSection } from '../ContentSection';
import { HELP_GAME_RULES_TITLE, HELP_GAME_RULES_DESC } from '../../../../backend/LocalizationData';

export const gameRulesContent: ContentSection = {
    Header: {
        opts: { 
            padding: { top: 12, bottom: 12 },
        },
        key: HELP_GAME_RULES_TITLE,
        value: 'Game Rules',
    },
    Content: [
        {
            Text: {
                opts: { padding: 2 },
                key: HELP_GAME_RULES_DESC,
                value: 'Win by landing 8 or more matching symbols anywhere on the screen. The more matching symbols you get, the higher your payout.',
            },
        },
    ],
};
