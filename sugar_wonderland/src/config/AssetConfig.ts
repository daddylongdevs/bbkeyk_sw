import { NetworkManager } from "../managers/NetworkManager";
import { ScreenModeManager } from "../managers/ScreenModeManager";
import { createLocalizedLogoAssets } from "@core/utils/LocalizedLogo";

export interface AssetGroup {
	images?: { [key: string]: string };
	spine?: { [key: string]: { atlas: string; json: string } };
	audio?: { [key: string]: string };
	fonts?: { [key: string]: string };
}

export class AssetConfig {
	private networkManager: NetworkManager;
	private screenModeManager: ScreenModeManager;

	constructor(networkManager: NetworkManager, screenModeManager: ScreenModeManager) {
		this.networkManager = networkManager;
		this.screenModeManager = screenModeManager;
	}

	private getAssetPrefix(): string {
		const screenConfig = this.screenModeManager.getScreenConfig();
		const isHighSpeed = this.networkManager.getNetworkSpeed();
		
		const orientation = screenConfig.isPortrait ? 'portrait' : 'landscape';
		const quality = isHighSpeed ? 'high' : 'low';
		
		return `assets/${orientation}/${quality}`;
	}

	getBackgroundAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		
		return {
			images: {
				'BG-Default': `${prefix}/background/BG-Default.png`,
				'normal-bg-cover': `assets/portrait/high/background/normal_bg_cover.png`,
				'candy-overlay': `assets/portrait/high/background/candy-overlay.png`,
				'cloud-upper': `assets/portrait/high/background/cloud_upper.png`,
				'cloud-middle': `assets/portrait/high/background/cloud_middle.png`,
				'cloud-lower': `assets/portrait/high/background/cloud_lower.png`,
				'shine': `assets/portrait/high/background/shine.png`
			}
		};
	}

	getBonusBackgroundAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		
		return {
			images: {
				'bonus_background': `${prefix}/bonus_background/BG-Bonus.png`,
				'bonus-bg-cover': `assets/portrait/high/bonus_background/bonus-bg-cover.png`,
				'cloud-upper-bonus': `assets/portrait/high/bonus_background/cloud_upper_bonus.png`,
				'cloud-middle-bonus': `assets/portrait/high/bonus_background/cloud_middle_bonus.png`
			}
		};
	}

	getHeaderAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		
		return {
			images: {
				'header-logo': `${prefix}/header/header_logo.png`,
				// Add more header images here
			},
			spine: {
				// Removed cat and win-bar assets from header
				// Add more Spine animations here
			}
		};
	}

	getBonusHeaderAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		
		return {
			images: {},
			spine: {}
		};
	}


	getLoadingAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		
		return {
			images: {
				'loading_background': `${prefix}/loading/image.png`,
				'button_bg': `${prefix}/loading/button_bg.png`,
				'button_spin': `${prefix}/loading/button_spin.png`,
				'logo_loading': `${prefix}/loading/logo-loading.png`,
				'loading_frame': `${prefix}/loading/loading-frame.png`,
				'loading_frame_2': `${prefix}/loading/loading-frame-2.png`,
				'dijoker_logo': `${prefix}/loading/DiJoker-logo.png`,
				'dijoker_face': `${prefix}/loading/DiJoker.png`,
			},
			spine: {
				// Studio loading spine (DI JOKER) – only available in portrait/high
				'di_joker': {
					atlas: `assets/portrait/high/dijoker_loading/DI JOKER.atlas`,
					json: `assets/portrait/high/dijoker_loading/DI JOKER.json`
				}
			}
		};
	}

	/**
	 * Optional localized game logos are loaded before the backend language is
	 * available. Missing variants safely fall back to the existing default logos.
	 */
	getLocalizedLogoAssets(): AssetGroup {
		return {
			images: createLocalizedLogoAssets(this.getAssetPrefix()),
		};
	}

	// Add more asset groups as needed
	getSymbolAssets(): AssetGroup {
		const prefix = this.getAssetPrefix(); // This gives us assets/{orientation}/{quality}
		console.log(`[AssetConfig] Loading symbol assets from: ${prefix}/symbols/`);
		
		// Generate symbol assets for all symbols (0-21)
		const symbolImages: { [key: string]: string } = {};
		const symbolSpine: { [key: string]: { atlas: string; json: string } } = {};
		
		// Sugar symbol Spine animations (idle) for Symbol0–Symbol9
		// These are provided in a fixed path under assets/symbols/high/sugar_symbols
		for (let i = 0; i <= 9; i++) {
			const sugarKey = `symbol_${i}_sugar_spine`;
			const sugarAtlas = `assets/symbols/high/sugar_symbols/Symbol${i}.atlas`;
			const sugarJson = `assets/symbols/high/sugar_symbols/Symbol${i}.json`;
			symbolSpine[sugarKey] = { atlas: sugarAtlas, json: sugarJson };
			console.log(`[AssetConfig] Sugar Symbol ${i}: spine=${sugarAtlas}`);

			const imageKey = `symbol${i}`;
			const imagePath = `assets/symbols/high/sugar_symbols/statics/${imageKey}.webp`;
			symbolImages[imageKey] = imagePath;
			console.log(`[AssetConfig] Sugar Symbol ${i}: image=${imagePath}`);
		}
		
		// Multiplier symbols (10–22) share a single Spine: SymbolBombs_SW
		// Animations inside:
		// - Symbols10_SW_Idle / Symbols10_SW_Win
		// - Symbols11_SW_Idle / Symbols11_SW_Win
		// - Symbols12_SW_Idle / Symbols12_SW_Win
		// Note: no Drop animation for these
		const multiKey = 'symbol_bombs_sw';
		const multiAtlas = `assets/symbols/high/sugar_symbols/SymbolBombs_SW.atlas`;
		const multiJson = `assets/symbols/high/sugar_symbols/SymbolBombs_SW.json`;
		symbolSpine[multiKey] = { atlas: multiAtlas, json: multiJson };
		console.log(`[AssetConfig] Multiplier Symbols (10–22): spine=${multiAtlas}`);
		
		// Multiplier overlays (PNG numbers shown in front of the multiplier symbol)
		// Mapping per request:
		// 10->2, 11->3, 12->4, 13->5, 14->6, 15->8, 16->10,
		// 17->12, 18->15, 19->20, 20->25, 21->50, 22->100
		const overlayMap: { [value: number]: string } = {
			10: '2',
			11: '3',
			12: '4',
			13: '5',
			14: '6',
			15: '8',
			16: '10',
			17: '12',
			18: '15',
			19: '20',
			20: '25',
			21: '50',
			22: '100'
		};
		Object.entries(overlayMap).forEach(([valueStr, label]) => {
			const value = Number(valueStr);
			const key = `multiplier_overlay_${value}`;
			const path = `assets/symbols/high/sugar_symbols/multiplier_symbols/${label}.png`;
			symbolImages[key] = path;
			console.log(`[AssetConfig] Multiplier overlay ${value}: ${path}`);
		});

		symbolImages['Symbol10'] = 'assets/symbols/high/sugar_symbols/Symbol10.png';
		symbolImages['Symbol12'] = 'assets/symbols/high/sugar_symbols/Symbol12.png';
		
		return {
			images: symbolImages,
			spine: symbolSpine
		};
	}

	getButtonAssets(): AssetGroup {
		// Controller buttons now follow portrait/landscape structure
		const screenConfig = this.screenModeManager.getScreenConfig();
		const isHighSpeed = this.networkManager.getNetworkSpeed();
		const quality = isHighSpeed ? 'high' : 'low';
		const screenMode = screenConfig.isPortrait ? 'portrait' : 'landscape';
		
		console.log(`[AssetConfig] Loading controller buttons with quality: ${quality}, screen mode: ${screenMode}`);
		
		return {
			images: {
				'autoplay_off': `assets/controller/${screenMode}/${quality}/autoplay_off.png`,
				'autoplay_on': `assets/controller/${screenMode}/${quality}/autoplay_on.png`,
				'decrease_bet': `assets/controller/${screenMode}/${quality}/decrease_bet.png`,
				'increase_bet': `assets/controller/${screenMode}/${quality}/increase_bet.png`,
				'menu': `assets/controller/${screenMode}/${quality}/menu.png`,
				// spin_bg.png retired — green disc + FX live in start_btn_spine.
				'spin_icon': `assets/controller/${screenMode}/${quality}/spin_icon.png`,
				// Portrait/high only export (no low variant).
				'autoplay_stop_icon': `assets/controller/portrait/high/autoplay_stop_icon.png`,
				'turbo_off': `assets/controller/${screenMode}/${quality}/turbo_off.png`,
				'turbo_on': `assets/controller/${screenMode}/${quality}/turbo_on.png`,
				'amplify': `assets/controller/${screenMode}/${quality}/amplify.png`,
				'feature': `assets/controller/${screenMode}/${quality}/feature.png`,
				'scratch_card': `assets/controller/portrait/high/scratch_card.webp`,
				'long_button': `assets/controller/${screenMode}/${quality}/long_button.png`,
				'maximize': `assets/controller/${screenMode}/${quality}/maximize.png`,
				'minimize': `assets/controller/${screenMode}/${quality}/minimize.png`,
				// Free round button background (currently only available as portrait/high asset)
				// We reference it directly so it can be used in all modes without additional variants.
				'freeround_bg': `assets/controller/portrait/high/freeround_bg.png`,
				// "Spin Now" button for free round reward panel (portrait/high only asset)
				'spin_now_button': `assets/controller/portrait/high/spin_now_button.png`,
			},
			spine: {
				// Merged spin disc + particle FX (replaces spin_bg.png + spin_button_anim.*).
				// Portrait/high only export; used for all qualities while low has no copy.
				'spin_button_animation': {
					atlas: `assets/controller/portrait/high/spin_button_anim/start_btn_spine.atlas`,
					json: `assets/controller/portrait/high/spin_button_anim/start_btn_spine.json`
				},
				// Free-round specific spin button animation (portrait/high only asset)
				// Used instead of the normal spin_button_animation while in initialization
				// free-round spins mode.
				'fr_spin_button_animation': {
					atlas: `assets/controller/portrait/high/Button_Bonus_Buttom/Button_Bonus_VFX.atlas`,
					json: `assets/controller/portrait/high/Button_Bonus_Buttom/Button_Bonus_VFX.json`
				},
				'button_animation_idle': {
					atlas: `assets/controller/${screenMode}/${quality}/button_animation_idle/button_animation_idle.atlas`,
					json: `assets/controller/${screenMode}/${quality}/button_animation_idle/button_animation_idle.json`
				},
				'amplify_bet': {
					atlas: `assets/portrait/high/amplify_bet/Amplify Bet.atlas`,
					json: `assets/portrait/high/amplify_bet/Amplify Bet.json`
				},
				// Enhance Bet idle loop (available only in portrait/high for now)
				'enhance_bet_idle_on': {
					atlas: `assets/controller/portrait/high/enhanceBet_idle_on/Amplify Bet.atlas`,
					json: `assets/controller/portrait/high/enhanceBet_idle_on/Amplify Bet.json`
				},
				'turbo_animation': {
					atlas: `assets/controller/${screenMode}/${quality}/turbo_animation/Turbo_Spin.atlas`,
					json: `assets/controller/${screenMode}/${quality}/turbo_animation/Turbo_Spin.json`
				}
			}
		};
	}

	getFontAssets(): AssetGroup {
		console.log(`[AssetConfig] Loading font assets`);
		
		return {
			fonts: {
				'poppins-bold': 'assets/fonts/poppins/Poppins-Bold.ttf',
				'poppins-regular': 'assets/fonts/poppins/Poppins-Regular.ttf'
				
			}
		};
	}

	getMenuAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		return {
			images: {
				// Menu tab icons
				'menu_info': `${prefix}/menu/Info.png`,
				'menu_history': `${prefix}/menu/History.png`,
				'menu_settings': `${prefix}/menu/Settings.png`,
				// Pagination and loading
				'icon_left': `${prefix}/menu/icon_left.png`,
				'icon_most_left': `${prefix}/menu/icon_most_left.png`,
				'icon_right': `${prefix}/menu/icon_right.png`,
				'icon_most_right': `${prefix}/menu/icon_most_right.png`,
				'loading_icon': `${prefix}/menu/loading.png`,
				// Close icon (portrait/high specific path)
				'menu_close': `assets/controller/portrait/high/close.png`
			}
		};
	}

	getHelpScreenAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		return {
			images: {
				// Payline visuals
				'help_tumbles_win': `${prefix}/help_screen/game_settings_content/help_tumbles_win.webp`,
				'help_tumbles_no-win': `${prefix}/help_screen/game_settings_content/help_tumbles_no-win.webp`,

				// Scatter / Tumble / Multiplier visuals
				'scatterGame': `${prefix}/help_screen/bonus_game_content/scatter_game.webp`,
				'tumbleWin': `${prefix}/help_screen/bonus_game_content/tumble_win.webp`,
				'multiplierGame': `${prefix}/help_screen/bonus_game_content/multiplier_game.webp`,

				// How To Play || Bet controls
				'betControlsMinus': `${prefix}/help_screen/how_to_play_content/betControls_minus.png`,
				'betControlsPlus': `${prefix}/help_screen/how_to_play_content/betControls_plus.png`,

				// How To Play || Game actions
				'spin_button': `${prefix}/help_screen/how_to_play_content/spin_button.png`,
				'enhanced_bet_button': `${prefix}/help_screen/how_to_play_content/enhanced_bet.png`,
				'amplify_bet_button': `${prefix}/help_screen/how_to_play_content/enhanced_bet.png`,
				'autoplay_button': `${prefix}/help_screen/how_to_play_content/autoplay.png`,
				'turbo_button': `${prefix}/help_screen/how_to_play_content/turbo.png`,

				// How To Play || General controls
				'sound_icon_on': `${prefix}/help_screen/how_to_play_content/sound_icon_on.png`,
				'sound_icon_off': `${prefix}/help_screen/how_to_play_content/sound_icon_off.png`,
				'settings_icon': `${prefix}/help_screen/how_to_play_content/settings.png`,
				'info_icon': `${prefix}/help_screen/how_to_play_content/info.png`,

				// Package 1 specific assets
				'help_multiplier_symbol': `${prefix}/help_screen/bonus_game_content/help_multiplier_symbol.png`,
			}
		};
	}

	getDialogAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		
		console.log(`[AssetConfig] Loading dialog assets with prefix: ${prefix}`);
		
		return {
			spine: {
				// 'Congrats_KA': {
				// 	atlas: `${prefix}/dialogs/Congrats_KA.atlas`,
				// 	json: `${prefix}/dialogs/Congrats_KA.json`
				// },
				// 'SmallW_KA': {
				// 	atlas: `${prefix}/dialogs/SmallW_KA.atlas`,
				// 	json: `${prefix}/dialogs/SmallW_KA.json`
				// },
				// 'MediumW_KA': {
				// 	atlas: `${prefix}/dialogs/MediumW_KA.atlas`,
				// 	json: `${prefix}/dialogs/MediumW_KA.json`
				// },
				// 'LargeW_KA': {
				// 	atlas: `${prefix}/dialogs/largeW_KA.atlas`,
				// 	json: `${prefix}/dialogs/largeW_KA.json`
				// },
				// 'SuperW_KA': {
				// 	atlas: `${prefix}/dialogs/SuperW_KA.atlas`,
				// 	json: `${prefix}/dialogs/SuperW_KA.json`
				// },
				// 'FreeSpinDialog_KA': {
				// 	atlas: `${prefix}/dialogs/FreeSpinDialog_KA.atlas`,
				// 	json: `${prefix}/dialogs/FreeSpinDialog_KA.json`
				// },
				'Win': {
					atlas: `${prefix}/win_dialog/Win.atlas`,
					json: `${prefix}/win_dialog/Win.json`
				}
			}
		};
	}

	getNumberAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		
		console.log(`[AssetConfig] Loading number assets with prefix: ${prefix}`);
		
		// Generate number assets for digits 0-9, plus comma and dot
		const numberImages: { [key: string]: string } = {};
		
		// Add digit images (0-9)
		for (let i = 0; i <= 9; i++) {
			const key = `number_${i}`;
			const path = `${prefix}/numbers/Number${i}.png`;
			numberImages[key] = path;
			console.log(`[AssetConfig] Number ${key}: ${path}`);
		}
		
		// Add comma and dot
		numberImages['number_comma'] = `${prefix}/numbers/comma.png`;
		numberImages['number_dot'] = `${prefix}/numbers/dot.png`;
		
		console.log(`[AssetConfig] Number comma: ${prefix}/numbers/comma.png`);
		console.log(`[AssetConfig] Number dot: ${prefix}/numbers/dot.png`);
		
		return {
			images: numberImages
		};
	}

	getBuyFeatureAssets(): AssetGroup {
		const prefix = this.getAssetPrefix();
		
		console.log(`[AssetConfig] Loading buy feature assets with prefix: ${prefix}`);
		
		return {
			images: {
				'buy_feature_logo': `${prefix}/buy_feature/buy_feature_logo.png`,
				'buy_feature_bg': `${prefix}/buy_feature/buy_feature_bg.png`
			}
		};
	}

	getAudioAssets(): AssetGroup {
		console.log(`[AssetConfig] Loading audio assets`);
		
		return {
			audio: {
				// Menu/UI clicks
				'click_sw': 'assets/sounds/click_sw.ogg',
				'mainbg_ka': 'assets/sounds/BG/mainbg_sw.ogg',
				'bonusbg_ka': 'assets/sounds/BG/bonusbg_sw.ogg',
				'freespinbg_ka': 'assets/sounds/BG/freespinbg_sw.ogg',
				'spinb_ka': 'assets/sounds/SFX/spin_sw.ogg',
				'reeldrop_ka': 'assets/sounds/SFX/reeldrop_sw.ogg',
				'turbodrop_ka': 'assets/sounds/SFX/turbodrop_sw.ogg',
				// Candy explosion transition SFX (used by SymbolExplosionTransition)
				'candy_transition_sw': 'assets/sounds/SFX/candy_transition.ogg',
				// Scatter win "nom nom" SFX – played when scatter win animation runs
				'nomnom_sw': 'assets/sounds/SFX/nomnom_sw.ogg',
				// Multiplier trigger / bomb SFX (bonus-mode multipliers)
				'bomb_sw': 'assets/sounds/SFX/bomb_sw.ogg',
				'scatter_sw': 'assets/sounds/SFX/scatter_sw.ogg',
				// Tumble symbol-win SFX (play per tumble index)
				'twin1_sw': 'assets/sounds/SFX/symbol_win/twin1_sw.ogg',
				'twin2_sw': 'assets/sounds/SFX/symbol_win/twin2_sw.ogg',
				'twin3_sw': 'assets/sounds/SFX/symbol_win/twin3_sw.ogg',
				'twin4_sw': 'assets/sounds/SFX/symbol_win/twin4_sw.ogg',
				// Win dialog SFX
				'bigw_ka': 'assets/sounds/Wins/bigw_sw.ogg',
				'megaw_ka': 'assets/sounds/Wins/megaw_sw.ogg',
				'superw_ka': 'assets/sounds/Wins/superw_sw.ogg',
				'epicw_ka': 'assets/sounds/Wins/epicw_sw.ogg',
				'congrats_ka': 'assets/sounds/Wins/congrats_sw.ogg'
			}
		};
	}

	// Helper method to get all assets for a scene
		getAllAssets(): { [key: string]: AssetGroup } {
		return {
			background: this.getBackgroundAssets(),
			header: this.getHeaderAssets(),
			bonusHeader: this.getBonusHeaderAssets(),
			loading: this.getLoadingAssets(),
			symbols: this.getSymbolAssets(),
			buttons: this.getButtonAssets(),
			fonts: this.getFontAssets(),
			dialogs: this.getDialogAssets(),
			numbers: this.getNumberAssets(),
			buyFeature: this.getBuyFeatureAssets(),
			audio: this.getAudioAssets(),
		};
	}

	// Method to get debug info
	getDebugInfo(): void {
		const prefix = this.getAssetPrefix();
		console.log(`[AssetConfig] Asset prefix: ${prefix}`);
		console.log(`[AssetConfig] Available asset groups:`, Object.keys(this.getAllAssets()));
	}
} 