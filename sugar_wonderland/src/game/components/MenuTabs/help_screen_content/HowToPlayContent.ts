import type { ContentSection } from '../ContentSection';
import { HELP_HOW_PLAY_TITLE } from '../../../../backend/LocalizationData';
import { betControlsSection } from './BetControlsContent';
import { gameActionsSection } from './GameActionsContent';
import { displayStatsSection } from './DisplayStatsContent';
import { generalControlsSection } from './GeneralControlsContent';

export const howToPlayContent: ContentSection = {
    Header: {
        key: HELP_HOW_PLAY_TITLE,
        value: 'How to Play',
        opts: {
            padding: { top: 12, bottom: 12 },
        }
    },
    Border: {
        opts: {
            padding: { top: 16, right: 16, bottom: 16, left: 16 },
            style: { fillColor: 0x1f1f1f, strokeColor: 0xffffff },
        }
    },
    Content: [
        { ChildSection: betControlsSection },
        { ChildSection: gameActionsSection },
        { ChildSection: displayStatsSection },
        { ChildSection: generalControlsSection },
    ]
};
