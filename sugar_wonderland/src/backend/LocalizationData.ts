/**
 * Centralized localization keys and default (fallback) text used across the game.
 * Use the key constants with getTextByKey; use LOCALIZATION_DEFAULTS for fallback when locale is missing.
 */

// ----- Common (shared across components) -----
export const COMMON_BALANCE = 'common_balance';
export const COMMON_BET = 'common_bet';
export const COMMON_OK = 'common_ok';
export const COMMON_SETTINGS = 'common_settings';
export const COMMON_SPIN = 'common_spin';
export const COMMON_TURBO = 'common_turbo';
export const COMMON_TOTAL_WIN = 'common_total-win';

// ----- Controller (SlotController) -----
export const CONTROLLER_BALANCE = 'controller_balance';
export const CONTROLLER_BET = 'controller_bet';
export const CONTROLLER_BUY_FEATURE = 'controller_buy-feature';
export const CONTROLLER_BUY = 'controller_buy';
export const CONTROLLER_SCRATCH = 'controller_scratch';
export const SCRATCH_BUY_CARD = 'scratch_buy-card';
export const SCRATCH_TITLE = 'scratch_title';
export const SCRATCH_SCRATCH_ALL = 'scratch_scratch-all';
export const CONTROLLER_TURBO = 'controller_turbo';
export const CONTROLLER_AMPLIFY_BET = 'controller_amplify-bet';
export const CONTROLLER_AUTOPLAY = 'controller_autoplay';
export const CONTROLLER_MENU = 'controller_menu';
export const CONTROLLER_DOUBLE_CHANCE = 'controller_double-chance';
export const CONTROLLER_FOR_FEATURE = 'controller_for-feature';
export const CONTROLLER_REMAINING = 'controller_remaining';
export const CONTROLLER_FREE_SPINS = 'controller_free-spins';

// ----- Header / Win bar -----
export const WINBAR_YOU_WON = 'winbar_you-won';
export const WINBAR_TOTAL_WIN = 'winbar_total-win';

// ----- Menu -----
export const MENU_RULES = 'menu_rules';
export const MENU_HISTORY = 'menu_history';
export const MENU_SETTINGS = 'menu_settings';
export const MENU_BACKGROUND_MUSIC = 'menu_background-music';
export const MENU_SOUND_FX = 'menu_sound-fx';
export const MENU_SKIP_INTRO = 'menu_skip-intro';

// ----- Popups -----
export const POPUP_SESSION_EXPIRED = 'popup_session-expired';
export const POPUP_INSUFFICIENT_BALANCE = 'popup_insufficient-balance';
export const POPUP_BET_FAILED = 'popup_bet-failed';
export const POPUP_BET_LIMIT_EXCEEDED = 'popup_bet-limit-exceeded';
export const POPUP_NETWORK_OFFLINE = 'popup_network-offline';
export const POPUP_CONFIRM_OK = 'popup_confirm-ok';
export const POPUP_CURRENCY_ERROR = 'popup_currency-error';
export const POPUP_GAME_LOADING_FAILED = 'popup_game-loading-failed';
export const POPUP_REFRESH = 'popup_refresh';
export const POPUP_RELOAD = 'popup_reload';
export const POPUP_GENERIC_ERROR = 'popup_generic-error';
export const POPUP_IDLE_SESSION_EXPIRED = 'popup_idle-session-expired';

// ----- Dialogs -----
export const DIALOG_PRESS_CONTINUE = 'dialog_press-continue';

// ----- Buy Feature -----
export const BUY_FEATURE_TITLE = 'buy-feature_title';
export const BUY_FEATURE_FEATURE_NAME = 'buy-feature_feature-name';
export const BUY_FEATURE_BUY_BUTTON = 'buy-feature_buy-button';
export const BUY_FEATURE_BET_LABEL = 'buy-feature_bet-label';

// ----- Bet Options -----
export const BET_OPTIONS_TITLE = 'bet-options_title';
export const BET_OPTIONS_SELECT_SIZE = 'bet-options_select-size';
export const BET_OPTIONS_BET_LABEL = 'bet-options_bet-label';
export const BET_OPTIONS_CONFIRM_BUTTON = 'bet-options_confirm-button';

// ----- Autoplay Options -----
export const AUTOPLAY_SETTINGS_TITLE = 'autoplay_settings-title';
export const AUTOPLAY_BALANCE_LABEL = 'autoplay_balance-label';
export const AUTOPLAY_NUMBER_OF_AUTOSPINS = 'autoplay_number-of-autospins';
export const AUTOPLAY_BET_LABEL = 'autoplay_bet-label';
export const AUTOPLAY_START_BUTTON = 'autoplay_start-button';

// ----- Preloader / Clock -----
export const PRELOADER_MAX_WIN = 'preloader_max-win';
export const CLOCK_DEMO = 'clock_demo';

// ----- Help (Game Rules) -----
export const HELP_GAME_RULES_TITLE = 'help_game-rules-title';
export const HELP_GAME_RULES_DESC = 'help_game-rules-desc';

// ----- Help (RTP / Max Win / Payout / Scatter) -----
export const HELP_RTP_TITLE = 'help_rtp-title';
export const HELP_MAX_WIN_TITLE = 'help_max-win-title';
export const HELP_PAYOUT_TITLE = 'help_payout-title';
export const HELP_SCATTER_TITLE = 'help_scatter-title';
export const HELP_SCATTER_DESC = 'help_scatter-desc';

// ----- Help (Tumble) -----
export const HELP_TUMBLE_TITLE = 'help_tumble-title';
export const HELP_TUMBLE_DESC = 'help_tumble-desc';

// ----- Help (Free Spin Rules) -----
export const HELP_FREESPIN_RULES_TITLE = 'help_freespin-rules-title';
export const HELP_BONUS_TRIGGER_TITLE = 'help_bonus-trigger-title';
export const HELP_BONUS_TRIGGER_DESC = 'help_bonus-trigger-desc';
export const HELP_RETRIGGER_TITLE = 'help_retrigger-title';
export const HELP_RETRIGGER_DESC = 'help_retrigger-desc';
export const HELP_MULTIPLIER_TITLE = 'help_multiplier-title';
export const HELP_MULTIPLIER_DESC = 'help_multiplier-desc';

// ----- Help (Game Settings / Paylines) -----
export const HELP_GAME_SETTINGS = 'help_game-settings';
export const HELP_PAYLINES_TITLE = 'help_paylines-title';
export const HELP_PAYLINES_DESC0 = 'help_paylines-desc0';
export const HELP_PAYLINES_DESC1 = 'help_paylines-desc1';
export const HELP_PAYLINES_WIN = 'help_paylines-win';
export const HELP_PAYLINES_NO_WIN = 'help_paylines-no-win';

// ----- Help (How to Play / Bet Controls / Game Actions) -----
export const HELP_HOW_PLAY_TITLE = 'help_how-play-title';
export const HELP_BET_CONTROLS_TITLE = 'help_bet-controls-title';
export const HELP_BUTTONS_LABEL = 'help_buttons-label';
export const HELP_BET_CONTROLS_DESC = 'help_bet-controls-desc';
export const HELP_GAME_ACTIONS_TITLE = 'help_game-actions-title';
export const HELP_SPIN_LABEL = 'help_spin-label';
export const HELP_SPIN_DESC = 'help_spin-desc';
export const HELP_BUY_LABEL = 'help_buy-label';
export const HELP_BUY_DESC = 'help_buy-desc';
export const HELP_AMPLIFY_LABEL = 'help_amplify-label';
export const HELP_AMPLIFY_DESC = 'help_amplify-desc';
export const HELP_AUTOPLAY_LABEL = 'help_autoplay-label';
export const HELP_AUTOPLAY_DESC = 'help_autoplay-desc';
export const HELP_TURBO_LABEL = 'help_turbo-label';
export const HELP_TURBO_DESC = 'help_turbo-desc';

// ----- Help (Display & Stats) -----
export const HELP_DISPLAY_STATS_TITLE = 'help_display-stats-title';
export const HELP_BALANCE_DESC = 'help_balance-desc';
export const HELP_BALANCE_LABEL = 'help_balance-label';
export const HELP_TOTALWIN_DESC = 'help_totalwin-desc';
export const HELP_TOTALWIN_LABEL = 'help_totalwin-label';
export const HELP_BET_DESC = 'help_bet-desc';
export const HELP_BET_LABEL = 'help_bet-label';

// ----- Help (General Controls) -----
export const HELP_GENERAL_CONTROLS_TITLE = 'help_general-controls-title';
export const HELP_SOUNDS_LABEL = 'help_sounds-label';
export const HELP_SOUNDS_DESC = 'help_sounds-desc';
export const HELP_SETTINGS_LABEL = 'help_settings-label';
export const HELP_SETTINGS_DESC = 'help_settings-desc';
export const HELP_INFO_LABEL = 'help_info-label';
export const HELP_INFO_DESC = 'help_info-desc';

// ----- Free Round Manager -----
export const FREEROUND_PANEL_LABEL = 'freeround_panel-label';
export const FREEROUND_REWARD_TITLE = 'freeround_reward-title';
export const FREEROUND_GRANTED_SUBTITLE = 'freeround_granted-subtitle';
export const FREEROUND_SPINS_LABEL = 'freeround_spins-label';
export const FREEROUND_WITH_LABEL = 'freeround_with-label';
export const FREEROUND_SPIN_NOW_BUTTON = 'freeround_spin-now-button';
export const FREEROUND_YOU_WON = 'freeround_you-won';
export const FREEROUND_CLAIM_NOW_BUTTON = 'freeround_claim-now-button';
export const FREEROUND_DONE_TITLE = 'freeround_done-title';
export const FREEROUND_CREDITED_LINE1 = 'freeround_credited-line1';
export const FREEROUND_CREDITED_LINE2 = 'freeround_credited-line2';
export const FREEROUND_CONFIRM_BUTTON = 'freeround_confirm-button';
export const FREEROUND_CREDITED_FROM_SPINS = 'freeround_credited-from-spins';
export const FREEROUND_CREDITED_FROM_SPIN = 'freeround_credited-from-spin';
export const FREEROUND_FAILED_TITLE = 'freeround_failed-title';
export const FREEROUND_FAILED_BODY = 'freeround_failed-body';
export const FREEROUND_CANCELLED_TITLE = 'freeround_cancelled-title';
export const FREEROUND_CANCELLED_BODY = 'freeround_cancelled-body';
export const FREEROUND_PARTIAL_REMAINING_CANCELLED = 'freeround_partial-remaining-cancelled';
export const FREEROUND_PARTIAL_REMAINING_CANCELLED_ONE = 'freeround_partial-remaining-cancelled-one';

// ----- Default (fallback) text when locale is missing -----
/** Key → default string. Use: localizationManager.getTextByKey(key) ?? LOCALIZATION_DEFAULTS[key] ?? key */
export const LOCALIZATION_DEFAULTS: Record<string, string> = {
	// Common
	[COMMON_BALANCE]: 'Balance',
	[COMMON_BET]: 'Bet',
	[COMMON_OK]: 'OK',
	[COMMON_SETTINGS]: 'Settings',
	[COMMON_SPIN]: 'Spin',
	[COMMON_TURBO]: 'Turbo',
	[COMMON_TOTAL_WIN]: 'Total Win',
	// Controller
	/** HUD center buy label; CMS locale uses this key with value "BUY". */
	[CONTROLLER_BUY_FEATURE]: 'BUY',
	[CONTROLLER_BUY]: 'BUY',
	[CONTROLLER_SCRATCH]: 'SCRATCH',
    [CONTROLLER_BET]: 'Bet',
	[SCRATCH_BUY_CARD]: 'BUY CARD',
    [SCRATCH_TITLE]: 'SCRATCH CARD',
	[SCRATCH_SCRATCH_ALL]: 'SCRATCH ALL',
	[CONTROLLER_AMPLIFY_BET]: 'Amplify Bet',
	[CONTROLLER_AUTOPLAY]: 'Autoplay',
	[CONTROLLER_MENU]: 'Menu',
	[CONTROLLER_DOUBLE_CHANCE]: 'Double Chance',
	[CONTROLLER_FOR_FEATURE]: 'For Feature',
	[CONTROLLER_REMAINING]: 'Remaining',
	[CONTROLLER_FREE_SPINS]: 'Free Spin : ',
	// Header / Win bar
	[WINBAR_YOU_WON]: 'YOU WON',
    [WINBAR_TOTAL_WIN]: 'TOTAL WIN',
	// Menu
	[MENU_RULES]: 'Rules',
	[MENU_HISTORY]: 'History',
	[MENU_BACKGROUND_MUSIC]: 'Background Music',
	[MENU_SOUND_FX]: 'Sound FX',
	[MENU_SKIP_INTRO]: 'Skip Intro',
	// Popups
	[POPUP_SESSION_EXPIRED]: 'Your play session has expired. Please log in again to keep playing. \n\nIf you were actively playing a game, your progress has been saved, and you can pick up right where you left off after relaunching the game.',
	[POPUP_INSUFFICIENT_BALANCE]: 'Insufficient balance.\nYour balance is too low to place this bet.\nPlease add funds or adjust your bet.',
	[POPUP_BET_FAILED]: "We couldn't process your bet. Your credits will be refunded.",
	[POPUP_BET_LIMIT_EXCEEDED]: 'You have reached your betting limit.',
	[POPUP_NETWORK_OFFLINE]:
		'You are currently offline.\n\n Please check your internet connection and try again.',
	[POPUP_CURRENCY_ERROR]: 'There was an error with the selected currency.\n\nPlease try refreshing the game or selecting another currency.',
	[POPUP_GAME_LOADING_FAILED]: 'Game loading failed.\n\nPlease try again later.',
	[POPUP_REFRESH]: 'REFRESH',
	[POPUP_RELOAD]: 'RELOAD',
	[POPUP_GENERIC_ERROR]: 'Something went wrong.',
	[POPUP_IDLE_SESSION_EXPIRED]:
		'Your session has expired due to inactivity. Please refresh the page or log in again to continue playing.',
	// Dialogs
	[DIALOG_PRESS_CONTINUE]: 'Press anywhere to continue',
	// Buy Feature
	[BUY_FEATURE_TITLE]: 'Buy Feature',
	[BUY_FEATURE_FEATURE_NAME]: 'Sugar Bomb Bonus',
	[BUY_FEATURE_BUY_BUTTON]: 'BUY FEATURE',
	// Bet Options
	[BET_OPTIONS_SELECT_SIZE]: 'Select size',
	[BET_OPTIONS_CONFIRM_BUTTON]: 'CONFIRM',
	// Autoplay Options
	[AUTOPLAY_SETTINGS_TITLE]: 'AUTOPLAY SETTINGS',
	[AUTOPLAY_NUMBER_OF_AUTOSPINS]: 'Number of autospins',
	[AUTOPLAY_START_BUTTON]: 'START AUTOPLAY',
	// Preloader / Clock
	[PRELOADER_MAX_WIN]: 'Win up to',
	[CLOCK_DEMO]: 'DEMO',
	// Help
	[HELP_GAME_RULES_TITLE]: 'Game Rules',
	[HELP_GAME_RULES_DESC]: 'Win by landing 8 or more matching symbols anywhere on the screen. The more matching symbols you get, the higher your payout.',
	[HELP_RTP_TITLE]: 'RTP',
	[HELP_MAX_WIN_TITLE]: 'Max Win',
	[HELP_PAYOUT_TITLE]: 'Payout',
	[HELP_SCATTER_TITLE]: 'Scatter',
	[HELP_SCATTER_DESC]: 'This is the SCATTER symbol.\nSCATTER symbol is present on all reels.\nSCATTER pays on any position.',
	[HELP_TUMBLE_TITLE]: 'Tumble Win',
	[HELP_TUMBLE_DESC]: "After each spin, winning symbols are paid and then removed from the screen. Remaining symbols drop down, and new ones fall from above to fill the empty spaces.\n\nTumbles continue as long as new winning combinations appear — there is no limit to the number of tumbles per spin.\n\nAll wins are credited to the player's balance after all tumbles from a base spin are completed.",
	[HELP_FREESPIN_RULES_TITLE]: 'Free Spin Rules',
	[HELP_BONUS_TRIGGER_TITLE]: 'Bonus Trigger',
	[HELP_BONUS_TRIGGER_DESC]: "Land 4 or more {image} SCATTER symbols anywhere on the screen to trigger the FREE SPINS feature.\nYou'll start with 10 free spins.\nDuring the bonus round, hitting 3 or more SCATTER symbols awards 5 extra free spins.",
	[HELP_RETRIGGER_TITLE]: 'In-Bonus Freespin Retrigger',
	[HELP_RETRIGGER_DESC]: 'Land 3 {image} SCATTER and win 5 more spins',
	[HELP_MULTIPLIER_TITLE]: 'Multiplier',
	[HELP_MULTIPLIER_DESC]: 'The {image} Multiplier symbol appears only during the FREE SPINS round and remains on the screen until the tumbling sequence ends.\nEach time a {image} lands, it randomly takes a multiplier value: 2x, 3x, 4x, 5x, 6x, 8x, 10x, 12x, 15x, 20x, 25x, 50x, or even 100x!\nOnce all tumbles are finished, the total of all {image} multipliers is added and applied to the total win of that sequence.\n\nSpecial reels are used during the FREE SPINS round.',
	[HELP_GAME_SETTINGS]: 'Game Settings',
	[HELP_PAYLINES_TITLE]: 'Paylines',
	[HELP_PAYLINES_DESC0]: 'Symbols can land anywhere on the screen.',
	[HELP_PAYLINES_DESC1]: 'All wins are multiplied by the base bet.\nWhen multiple symbol wins occur, all values are combined into the total win.\nFree spins rewards are granted after the round ends.',
	[HELP_PAYLINES_WIN]: 'Win',
	[HELP_PAYLINES_NO_WIN]: 'No Win',
	[HELP_HOW_PLAY_TITLE]: 'How to Play',
	[HELP_BET_CONTROLS_TITLE]: 'Bet Controls',
	[HELP_BUTTONS_LABEL]: 'Buttons',
	[HELP_BET_CONTROLS_DESC]: 'Adjust your total bet',
	[HELP_GAME_ACTIONS_TITLE]: 'Game Actions',
	[HELP_SPIN_DESC]: 'Starts the game round.',
	[HELP_BUY_LABEL]: 'Buy Feature',
	[HELP_BUY_DESC]: 'Lets you buy the free spins round for 100x your total bet.',
	[HELP_AMPLIFY_LABEL]: 'Amplify Bet',
	[HELP_AMPLIFY_DESC]: "You're wagering 25% more per spin, but you also have better chances at hitting big features.",
	[HELP_AUTOPLAY_LABEL]: 'Auto Play',
	[HELP_AUTOPLAY_DESC]: 'Opens the autoplay menu. Tap again to stop autoplay.',
	[HELP_TURBO_DESC]: 'Speeds up the game.',
	[HELP_DISPLAY_STATS_TITLE]: 'Display & Stats',
	[HELP_BALANCE_DESC]: 'Shows your current available credits.',
	[HELP_TOTALWIN_DESC]: 'Displays your total winnings from the current round.',
	[HELP_BET_DESC]: 'Adjust your wager using the – and + buttons.',
	[HELP_GENERAL_CONTROLS_TITLE]: 'General Controls',
	[HELP_SOUNDS_LABEL]: 'Sounds',
	[HELP_SOUNDS_DESC]: 'Toggle game sounds on or off.',
	[HELP_SETTINGS_DESC]: 'Access gameplay preferences and systems options.',
	[HELP_INFO_LABEL]: 'Info',
	[HELP_INFO_DESC]: 'View game rules, features, and paytable.',
	// Free Round Manager
	[FREEROUND_PANEL_LABEL]: 'Free\nSpin',
	[FREEROUND_REWARD_TITLE]: 'Free Spin Reward',
	[FREEROUND_GRANTED_SUBTITLE]: 'You have been Granted',
	[FREEROUND_SPINS_LABEL]: 'Spins',
	[FREEROUND_WITH_LABEL]: 'With',
	[FREEROUND_SPIN_NOW_BUTTON]: 'SPIN NOW',
	[FREEROUND_YOU_WON]: 'You won ',
	[FREEROUND_CLAIM_NOW_BUTTON]: 'CLAIM NOW',
	[FREEROUND_DONE_TITLE]: 'Free Spin Done',
	[FREEROUND_CREDITED_LINE1]: 'has been credited',
	[FREEROUND_CREDITED_LINE2]: 'to your balance',
	[FREEROUND_CREDITED_FROM_SPINS]: 'has been credited to your balance from {count} free spins.',
	[FREEROUND_CREDITED_FROM_SPIN]: 'has been credited to your balance from {count} free spin.',
	[FREEROUND_FAILED_TITLE]: 'Free Spin Failed',
	[FREEROUND_FAILED_BODY]: 'Bet failed. Free spin bet was not consumed. Please try again.',
	[FREEROUND_CANCELLED_TITLE]: 'Free Spin Cancelled',
	[FREEROUND_CANCELLED_BODY]: 'Your free spins have been cancelled. No wins credited to your balance.',
	[FREEROUND_PARTIAL_REMAINING_CANCELLED]: 'Remaining {count} free spins has been cancelled.',
	[FREEROUND_PARTIAL_REMAINING_CANCELLED_ONE]: 'Remaining {count} free spin has been cancelled.',
};
