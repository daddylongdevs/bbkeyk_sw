import type { ContentSection } from '../ContentSection';
import { HELP_SOUNDS_LABEL, HELP_SOUNDS_DESC, COMMON_SETTINGS, HELP_SETTINGS_DESC, HELP_INFO_LABEL, HELP_INFO_DESC, HELP_GENERAL_CONTROLS_TITLE } from '../../../../backend/LocalizationData';

/** Shared border opts for General Controls item boxes (sounds, settings, info). */
const generalControlsBorderOpts = {
    margin: 16,
    padding: 16,
    style: { fillColor: 0xffffff, strokeColor: 0xffffff, fillAlpha: 0.1, strokeAlpha: 0.0 },
} as const;

const soundsContent: ContentSection = {
    Border: {
        opts: generalControlsBorderOpts,
    },
    Content: [
        {
            RichText: {
                opts: {
                    padding: { top: 6, bottom: 24 },
                },
                parts: [
                    {
                        TextImage: {
                            key: 'sound_icon_on',
                            opts: {
                                padding: { right: 6 },
                            },
                        }
                    },
                    {
                        TextImage: {
                            key: 'sound_icon_off',
                            opts: {
                                padding: { left: 6, right: 12 },
                            },
                        }
                    },
                    {
                        Text: {
                            key: HELP_SOUNDS_LABEL,
                            value: 'Sounds',
                            fitToSingleLine: true,
                            minFontSize: 16,
                            style: {
                                fontSize: '24px',
                            }
                        }
                    }
                ]
            }
        },
        {
            Text: {
                key: HELP_SOUNDS_DESC,
                value: 'Toggle game sounds on or off.',
            }
        },
    ]
};

const settingsContent: ContentSection = {
    Border: {
        opts: generalControlsBorderOpts,
    },
    Content: [
        {
            RichText: {
                opts: {
                    padding: { top: 6, bottom: 24 },
                },
                parts: [
                    {
                        TextImage: {
                            key: 'settings_icon',
                            opts: {
                                padding: { right: 16 },
                            },
                        }
                    },
                    {
                        Text: {
                            key: COMMON_SETTINGS,
                            value: 'Settings',
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
                key: HELP_SETTINGS_DESC,
                value: 'Access gameplay preferences and systems options.',
                opts: {
                    padding: { top: -6 },
                },
            }
        }
    ]
};

const infoContent: ContentSection = {
    Border: {
        opts: generalControlsBorderOpts,
    },
    Content: [
        {
            RichText: {
                parts: [
                    {
                        TextImage: {
                            key: 'info_icon',
                            opts: {
                                padding: { right: 16 },
                            },
                        }
                    },
                    {
                        Text: {
                            key: HELP_INFO_LABEL,
                            value: 'Info',
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
                key: HELP_INFO_DESC,
                value: 'View game rules, features, and paytable.',
                opts: {
                    padding: { top: 12 },
                },
            }
        }

    ]
};

export const generalControlsSection: ContentSection = {
    Content: [
        {
            Header: {
                key: HELP_GENERAL_CONTROLS_TITLE,
                value: 'General Controls',
                opts: {
                    padding: { top: 36, bottom: 12 },
                },
            }
        },
        { ChildSection: soundsContent },
        { ChildSection: settingsContent },
        { ChildSection: infoContent },
    ]
};
