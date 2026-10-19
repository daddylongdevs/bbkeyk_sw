import type { ContentSection } from '../ContentSection';
import { HELP_TUMBLE_TITLE, HELP_TUMBLE_DESC } from '../../../../backend/LocalizationData';

export const tumbleWinContent: ContentSection = {
    Header: {
        key: HELP_TUMBLE_TITLE,
        value: 'Tumble Win',
    },
    Border: {
        opts: {
            margin: { top: 10, bottom: 10 },
            padding: 20,
        },
    },
    Content: [
        {
            Image: {
                opts: {
                    align: 0.5,
                    anchor: { x: 0.5, y: 0 },
                    size: 'fitToWidth',
                },
                key: 'tumbleWin' 
            } 
        },
        {
            Text: {
                opts: {
                    padding: { top: 40, bottom: 10 },
                },
                key: HELP_TUMBLE_DESC,
                value: 'After each spin, winning symbols are paid and then removed from the screen. Remaining symbols drop down, and new ones fall from above to fill the empty spaces.\n\nTumbles continue as long as new winning combinations appear — there is no limit to the number of tumbles per spin.\n\nAll wins are credited to the player\'s balance after all tumbles from a base spin are completed.',
            }
        }
    ]
};
