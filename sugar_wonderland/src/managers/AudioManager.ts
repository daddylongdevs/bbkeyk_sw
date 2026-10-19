import { gameStateManager } from './GameStateManager';

export enum MusicType {
	MAIN = 'main',
	BONUS = 'bonus', 
	FREE_SPIN = 'freespin'
}

export enum SoundEffectType {
	SPIN = 'spin',
	REEL_DROP = 'reeldrop',
	TURBO_DROP = 'turbodrop',
	CANDY_TRANSITION = 'candy_transition',
	// Scatter win "nom nom" SFX (Symbol0 win animation)
	SCATTER_NOMNOM = 'scatter_nomnom',
	MENU_CLICK = 'menu_click',
	MULTIPLIER_TRIGGER = 'multitrigger',
	SCATTER = 'scatter',
	// Tumble-driven symbol-win SFX (play per tumble index)
	SYMBOL_WIN_1 = 'symbol_win_1',
	SYMBOL_WIN_2 = 'symbol_win_2',
	SYMBOL_WIN_3 = 'symbol_win_3',
	SYMBOL_WIN_4 = 'symbol_win_4',
	// Win dialog effects
	WIN_BIG = 'win_big',
	WIN_MEGA = 'win_mega',
	WIN_SUPER = 'win_super',
	WIN_EPIC = 'win_epic',
	DIALOG_CONGRATS = 'dialog_congrats'
}

export class AudioManager {
	private scene: Phaser.Scene;
	private currentMusic: MusicType | null = null;
	private musicVolume: number = 0.2;
	private sfxVolume: number = 0.2;
	private ambientVolume: number = 0.2; // Volume for ambient audio layer
	private isMuted: boolean = false;
	private musicInstances: Map<MusicType, Phaser.Sound.BaseSound> = new Map();
	private sfxInstances: Map<SoundEffectType, Phaser.Sound.BaseSound> = new Map();
	private ambientInstance: Phaser.Sound.BaseSound | null = null; // Ambient audio instance
	private currentWinSfx: Phaser.Sound.BaseSound | null = null;
	private isDucked: boolean = false;
	private savedMusicVolume: number | null = null;
	private savedAmbientVolume: number | null = null;
	private duckFadeTimer: any = null;
	private restoreFadeTimer: any = null;

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
		console.log('[AudioManager] AudioManager initialized');
	}

	/**
	 * Preload all background music and sound effect files
	 */
	preloadMusic(): void {
		console.log('[AudioManager] Preloading audio files...');
		
		// Main background music
		this.scene.load.audio('mainbg_ka', 'assets/sounds/BG/mainbg_ka.ogg');
		
		// Bonus background music
		this.scene.load.audio('bonusbg_ka', 'assets/sounds/BG/bonusbg_ka.ogg');
		
		// Free spin background music
		this.scene.load.audio('freespinbg_ka', 'assets/sounds/BG/freespinbg_ka.ogg');
		
		// Ambient audio
		//this.scene.load.audio('ambience_ka', 'assets/sounds/SFX/ambience_ka.ogg');
		
		// Sound effects
		this.scene.load.audio('spinb_ka', 'assets/sounds/SFX/spinb_ka.ogg');
		this.scene.load.audio('click_sw', 'assets/sounds/click_sw.ogg');
		this.scene.load.audio('reeldrop_ka', 'assets/sounds/SFX/reeldrop_ka.ogg');
		this.scene.load.audio('turbodrop_ka', 'assets/sounds/SFX/turbodrop_ka.ogg');
		this.scene.load.audio('nomnom_sw', 'assets/sounds/SFX/nomnom_sw.ogg');
		
		console.log('[AudioManager] Audio files preloaded successfully');
	}

	/**
	 * Create music and sound effect instances after loading
	 */
	createMusicInstances(): void {
		console.log('[AudioManager] Creating audio instances...');
		
		try {
			// IMPORTANT:
			// `createMusicInstances()` can be called from retry/unlock flows (e.g. on first user gesture).
			// If we `sound.add(...)` unconditionally, we can create multiple looping BGM instances that overlap.
			// So we only create each instance once.

			// Create main background music (idempotent)
			if (!this.musicInstances.has(MusicType.MAIN)) {
				const mainMusic = this.scene.sound.add('mainbg_ka', {
					volume: this.musicVolume,
					loop: true
				});
				this.musicInstances.set(MusicType.MAIN, mainMusic);
				console.log('[AudioManager] Main background music instance created');
			}

			// Create bonus background music (idempotent)
			if (!this.musicInstances.has(MusicType.BONUS)) {
				const bonusMusic = this.scene.sound.add('bonusbg_ka', {
					volume: this.musicVolume,
					loop: true
				});
				this.musicInstances.set(MusicType.BONUS, bonusMusic);
				console.log('[AudioManager] Bonus background music instance created');
			}

			// Create free spin background music (idempotent)
			if (!this.musicInstances.has(MusicType.FREE_SPIN)) {
				const freespinMusic = this.scene.sound.add('freespinbg_ka', {
					volume: this.musicVolume,
					loop: true
				});
				this.musicInstances.set(MusicType.FREE_SPIN, freespinMusic);
				console.log('[AudioManager] Free spin background music instance created');
			}

			// Create sound effect instances
			if (!this.sfxInstances.has(SoundEffectType.SPIN)) {
				const spinSfx = this.scene.sound.add('spinb_ka', {
					volume: this.sfxVolume,
					loop: false
				});
				this.sfxInstances.set(SoundEffectType.SPIN, spinSfx);
				console.log('[AudioManager] Spin sound effect instance created');
			}

			// Menu click SFX
			try {
				if (!this.sfxInstances.has(SoundEffectType.MENU_CLICK)) {
					const clickSfx = this.scene.sound.add('click_sw', { volume: this.sfxVolume, loop: false });
					this.sfxInstances.set(SoundEffectType.MENU_CLICK, clickSfx);
					console.log('[AudioManager] Menu click SFX instance created');
				}
			} catch (e) {
				console.warn('[AudioManager] Failed to create click_sw SFX instance:', e);
			}

			if (!this.sfxInstances.has(SoundEffectType.REEL_DROP)) {
				const reelDropSfx = this.scene.sound.add('reeldrop_ka', {
					volume: this.sfxVolume,
					loop: false
				});
				this.sfxInstances.set(SoundEffectType.REEL_DROP, reelDropSfx);
				console.log('[AudioManager] Reel drop sound effect instance created');
			}

			if (!this.sfxInstances.has(SoundEffectType.TURBO_DROP)) {
				const turboDropSfx = this.scene.sound.add('turbodrop_ka', {
					volume: this.sfxVolume,
					loop: false
				});
				this.sfxInstances.set(SoundEffectType.TURBO_DROP, turboDropSfx);
				console.log('[AudioManager] Turbo drop sound effect instance created');
			}

			// Candy explosion transition SFX (SymbolExplosionTransition)
			try {
				if (!this.sfxInstances.has(SoundEffectType.CANDY_TRANSITION)) {
					const candyTransition = this.scene.sound.add('candy_transition_sw', {
						volume: this.sfxVolume,
						loop: false
					});
					this.sfxInstances.set(SoundEffectType.CANDY_TRANSITION, candyTransition);
					console.log('[AudioManager] Candy transition SFX instance created');
				}
			} catch (e) {
				console.warn('[AudioManager] Failed to create candy_transition_sw SFX instance:', e);
			}

			// Create tumble symbol-win SFX instances (twin1..4_sw)
			try {
				if (!this.sfxInstances.has(SoundEffectType.SYMBOL_WIN_1)) {
					const twin1 = this.scene.sound.add('twin1_sw', { volume: this.sfxVolume, loop: false });
					this.sfxInstances.set(SoundEffectType.SYMBOL_WIN_1, twin1);
				}
			} catch (e) { console.warn('[AudioManager] Failed to create twin1_sw SFX instance:', e); }
			try {
				if (!this.sfxInstances.has(SoundEffectType.SYMBOL_WIN_2)) {
					const twin2 = this.scene.sound.add('twin2_sw', { volume: this.sfxVolume, loop: false });
					this.sfxInstances.set(SoundEffectType.SYMBOL_WIN_2, twin2);
				}
			} catch (e) { console.warn('[AudioManager] Failed to create twin2_sw SFX instance:', e); }
			try {
				if (!this.sfxInstances.has(SoundEffectType.SYMBOL_WIN_3)) {
					const twin3 = this.scene.sound.add('twin3_sw', { volume: this.sfxVolume, loop: false });
					this.sfxInstances.set(SoundEffectType.SYMBOL_WIN_3, twin3);
				}
			} catch (e) { console.warn('[AudioManager] Failed to create twin3_sw SFX instance:', e); }
			try {
				if (!this.sfxInstances.has(SoundEffectType.SYMBOL_WIN_4)) {
					const twin4 = this.scene.sound.add('twin4_sw', { volume: this.sfxVolume, loop: false });
					this.sfxInstances.set(SoundEffectType.SYMBOL_WIN_4, twin4);
				}
			} catch (e) { console.warn('[AudioManager] Failed to create twin4_sw SFX instance:', e); }
			console.log('[AudioManager] Tumble symbol-win SFX instances created');

			// Create multiplier trigger / bomb SFX instance (bonus-mode multipliers)
			try {
				if (!this.sfxInstances.has(SoundEffectType.MULTIPLIER_TRIGGER)) {
					const bombSfx = this.scene.sound.add('bomb_sw', { volume: this.sfxVolume, loop: false });
					this.sfxInstances.set(SoundEffectType.MULTIPLIER_TRIGGER, bombSfx);
					console.log('[AudioManager] Multiplier trigger (bomb_sw) SFX instance created');
				}
			} catch (e) {
				console.warn('[AudioManager] Failed to create bomb_sw SFX instance:', e);
			}

			// Create scatter SFX instance
			try {
				if (!this.sfxInstances.has(SoundEffectType.SCATTER)) {
					const scatter = this.scene.sound.add('scatter_sw', { volume: this.sfxVolume, loop: false });
					this.sfxInstances.set(SoundEffectType.SCATTER, scatter);
					console.log('[AudioManager] Scatter SFX instance created');
				}
			} catch (e) {
				console.warn('[AudioManager] Failed to create scatter_sw SFX instance:', e);
			}

			// Create scatter win "nom nom" SFX instance
			try {
				if (!this.sfxInstances.has(SoundEffectType.SCATTER_NOMNOM)) {
					const scatterNomnom = this.scene.sound.add('nomnom_sw', { volume: this.sfxVolume, loop: false });
					this.sfxInstances.set(SoundEffectType.SCATTER_NOMNOM, scatterNomnom);
					console.log('[AudioManager] Scatter nomnom SFX instance created');
				}
			} catch (e) {
				console.warn('[AudioManager] Failed to create nomnom_sw SFX instance:', e);
			}

			// Create win dialog SFX instances
			if (!this.sfxInstances.has(SoundEffectType.WIN_BIG)) {
				const bigWinSfx = this.scene.sound.add('bigw_ka', { volume: this.sfxVolume, loop: false });
				this.sfxInstances.set(SoundEffectType.WIN_BIG, bigWinSfx);
			}
			if (!this.sfxInstances.has(SoundEffectType.WIN_MEGA)) {
				const megaWinSfx = this.scene.sound.add('megaw_ka', { volume: this.sfxVolume, loop: false });
				this.sfxInstances.set(SoundEffectType.WIN_MEGA, megaWinSfx);
			}
			if (!this.sfxInstances.has(SoundEffectType.WIN_SUPER)) {
				const superWinSfx = this.scene.sound.add('superw_ka', { volume: this.sfxVolume, loop: false });
				this.sfxInstances.set(SoundEffectType.WIN_SUPER, superWinSfx);
			}
			if (!this.sfxInstances.has(SoundEffectType.WIN_EPIC)) {
				const epicWinSfx = this.scene.sound.add('epicw_ka', { volume: this.sfxVolume, loop: false });
				this.sfxInstances.set(SoundEffectType.WIN_EPIC, epicWinSfx);
			}
			console.log('[AudioManager] Win dialog SFX instances created');

			// Create dialog-specific SFX instances
			try {
				if (!this.sfxInstances.has(SoundEffectType.DIALOG_CONGRATS)) {
					const congratsDlg = this.scene.sound.add('congrats_ka', { volume: this.sfxVolume, loop: false });
					this.sfxInstances.set(SoundEffectType.DIALOG_CONGRATS, congratsDlg);
					console.log('[AudioManager] Congrats dialog SFX instance created');
				}
			} catch (e) {
				console.warn('[AudioManager] Failed to create congrats_ka SFX instance:', e);
			}
			console.log('[AudioManager] Total SFX instances:', this.sfxInstances.size);

			// Create ambient audio instance
			// this.ambientInstance = this.scene.sound.add('ambience_ka', {
			// 	volume: this.ambientVolume,
			// 	loop: true
			// });
			// console.log('[AudioManager] Ambient audio instance created');

			console.log('[AudioManager] All audio instances created successfully');
		} catch (error) {
			console.error('[AudioManager] Error creating audio instances:', error);
		}
	}

	/**
	 * Play tumble-indexed symbol-win SFX.
	 * 1 -> twin1_sw, 2 -> twin2_sw, 3 -> twin3_sw, 4+ -> twin4_sw
	 */
	playSymbolWinByTumble(tumbleIndex: number): void {
		if (this.isMuted) {
			console.log('[AudioManager] Audio is muted, skipping symbol-win SFX');
			return;
		}
		const clamped = Math.max(1, Math.min(4, Math.floor(tumbleIndex || 1)));
		// Custom succession per request:
		// 1 -> twin4, 2 -> twin2, 3 -> twin3, 4+ -> twin1
		let pick: SoundEffectType = SoundEffectType.SYMBOL_WIN_4; // default for 1
		if (clamped === 2) pick = SoundEffectType.SYMBOL_WIN_2;
		else if (clamped === 3) pick = SoundEffectType.SYMBOL_WIN_3;
		else if (clamped >= 4) pick = SoundEffectType.SYMBOL_WIN_1;
		console.log(`[AudioManager] playSymbolWinByTumble: tumbleIndex=${tumbleIndex}, clamped=${clamped}, playing=${pick}`);
		this.playSoundEffect(pick);
	}

	/**
	 * Crossfade from current music to the target music type without gaps
	 */
	crossfadeTo(nextType: MusicType, durationMs: number = 500): void {
		if (this.isMuted) return;
		if (this.currentMusic === nextType) return;

		const currentType = this.currentMusic;
		const from = currentType ? this.musicInstances.get(currentType) : null;
		const to = this.musicInstances.get(nextType);
		if (!to) {
			console.warn('[AudioManager] Crossfade target music not found:', nextType);
			this.playBackgroundMusic(nextType);
			return;
		}

		// If nothing is currently playing, just play the target
		if (!from || !from.isPlaying) {
			try {
				if ('setVolume' in to && typeof (to as any).setVolume === 'function') {
					(to as any).setVolume(0);
				}
				to.play();
				this.currentMusic = nextType;
				const steps = 10;
				const interval = Math.max(10, Math.floor(durationMs / steps));
				let step = 0;
				const timer = setInterval(() => {
					step++;
					const t = step / steps;
					if ('setVolume' in to && typeof (to as any).setVolume === 'function') {
						(to as any).setVolume(this.musicVolume * t);
					}
					if (step >= steps) {
						clearInterval(timer);
						if ('setVolume' in to && typeof (to as any).setVolume === 'function') {
							(to as any).setVolume(this.musicVolume);
						}
					}
				}, interval);
			} catch (e) {
				console.warn('[AudioManager] Failed simple fade-in for target music, falling back to play:', e);
				this.playBackgroundMusic(nextType);
			}
			return;
		}

		// Crossfade between two tracks
		try {
			const fromStart = (from as any).volume ?? this.musicVolume;
			// Ensure target starts at 0 volume
			if ('setVolume' in to && typeof (to as any).setVolume === 'function') {
				(to as any).setVolume(0);
			}
			if (!to.isPlaying) to.play();

			const steps = 12;
			const interval = Math.max(10, Math.floor(durationMs / steps));
			let step = 0;
			const timer = setInterval(() => {
				step++;
				const t = step / steps;
				const toVol = this.musicVolume * t;
				const fromVol = Math.max(0, fromStart * (1 - t));
				if ('setVolume' in to && typeof (to as any).setVolume === 'function') {
					(to as any).setVolume(toVol);
				}
				if ('setVolume' in from && typeof (from as any).setVolume === 'function') {
					(from as any).setVolume(fromVol);
				}
				if (step >= steps) {
					clearInterval(timer);
					// Stop the old track and finalize volumes
					try { if (from.isPlaying) from.stop(); } catch {}
					if ('setVolume' in to && typeof (to as any).setVolume === 'function') {
						(to as any).setVolume(this.musicVolume);
					}
					this.currentMusic = nextType;
					this.startAmbientAudio();
				}
			}, interval);
		} catch (e) {
			console.warn('[AudioManager] Crossfade failed, falling back to direct switch:', e);
			this.playBackgroundMusic(nextType);
		}
	}

	/**
	 * Play background music based on game state
	 */
	playBackgroundMusic(musicType: MusicType): void {
		if (this.isMuted) {
			console.log('[AudioManager] Audio is muted, skipping music playback');
			return;
		}

		// If the requested track is already playing, do not restart it (common on first user gesture unlock flows).
		try {
			if (this.currentMusic === musicType) {
				const current = this.musicInstances.get(musicType);
				if (current && current.isPlaying) {
					// Keep volumes consistent and ensure ambient layer is running.
					try {
						if ('setVolume' in current && typeof (current as any).setVolume === 'function') {
							(current as any).setVolume(this.musicVolume);
						}
					} catch {}
					this.startAmbientAudio();
					return;
				}
			}
		} catch {}

		// Stop current music if playing
		this.stopCurrentMusic();

		const music = this.musicInstances.get(musicType);
		if (music) {
			try {
				music.play();
				this.currentMusic = musicType;
				console.log(`[AudioManager] Playing ${musicType} background music`);
				this.startAmbientAudio();
			} catch (error) {
				console.error(`[AudioManager] Error playing ${musicType} music:`, error);
			}
		} else {
			console.warn(`[AudioManager] Music instance not found for type: ${musicType}`);
		}
	}

	/**
	 * Stop current background music
	 */
	stopCurrentMusic(): void {
		if (this.currentMusic) {
			const music = this.musicInstances.get(this.currentMusic);
			if (music && music.isPlaying) {
				music.stop();
				console.log(`[AudioManager] Stopped ${this.currentMusic} background music`);
			}
			this.currentMusic = null;
		}
	}

	/**
	 * Stop all background music
	 */
	stopAllMusic(): void {
		console.log('[AudioManager] Stopping all background music');
		this.musicInstances.forEach((music, type) => {
			if (music.isPlaying) {
				music.stop();
				console.log(`[AudioManager] Stopped ${type} music`);
			}
		});
		this.currentMusic = null;
		this.stopAmbientAudio();
	}

	/**
	 * Set music volume
	 */
	setVolume(volume: number): void {
		this.musicVolume = Math.max(0, Math.min(1, volume));
		
		this.musicInstances.forEach((music) => {
			if ('setVolume' in music && typeof music.setVolume === 'function') {
				music.setVolume(this.musicVolume);
			}
		});
		
		console.log(`[AudioManager] Music volume set to: ${this.musicVolume}`);
	}

	/**
	 * Temporarily reduce background (music + ambient) volume by a factor
	 */
	duckBackground(factor: number = 0.3, durationMs: number = 300): void {
		if (this.isMuted) return;
		// Cancel any ongoing restore fade
		if (this.restoreFadeTimer) {
			clearInterval(this.restoreFadeTimer);
			this.restoreFadeTimer = null;
		}
		// Save current volumes once
		if (!this.isDucked) {
			this.savedMusicVolume = this.musicVolume;
			this.savedAmbientVolume = this.ambientVolume;
		}
		this.isDucked = true;
		const startMusic = this.getVolume();
		const startAmbient = this.getAmbientVolume();
		const targetMusic = Math.max(0, Math.min(1, startMusic * factor));
		const targetAmbient = Math.max(0, Math.min(1, startAmbient * factor));
		if (durationMs <= 0) {
			this.musicInstances.forEach((music) => {
				if ('setVolume' in music && typeof music.setVolume === 'function') {
					music.setVolume(targetMusic);
				}
			});
			if (this.ambientInstance && 'setVolume' in this.ambientInstance && typeof (this.ambientInstance as any).setVolume === 'function') {
				(this.ambientInstance as any).setVolume(targetAmbient);
			}
			console.log(`[AudioManager] Background ducked instantly to factor ${factor} (music=${targetMusic}, ambient=${targetAmbient})`);
			return;
		}
		// Fade
		if (this.duckFadeTimer) {
			clearInterval(this.duckFadeTimer);
		}
		const steps = 10;
		const interval = Math.max(10, Math.floor(durationMs / steps));
		let step = 0;
		this.duckFadeTimer = setInterval(() => {
			step++;
			const t = step / steps;
			const curMusic = startMusic + (targetMusic - startMusic) * t;
			const curAmbient = startAmbient + (targetAmbient - startAmbient) * t;
			this.musicInstances.forEach((music) => {
				if ('setVolume' in music && typeof music.setVolume === 'function') {
					music.setVolume(curMusic);
				}
			});
			if (this.ambientInstance && 'setVolume' in this.ambientInstance && typeof (this.ambientInstance as any).setVolume === 'function') {
				(this.ambientInstance as any).setVolume(curAmbient);
			}
			if (step >= steps) {
				clearInterval(this.duckFadeTimer);
				this.duckFadeTimer = null;
				console.log(`[AudioManager] Background ducked to factor ${factor} (music=${targetMusic}, ambient=${targetAmbient})`);
			}
		}, interval);
	}

	/**
	 * Restore background (music + ambient) volume after ducking
	 */
	restoreBackground(durationMs: number = 500): void {
		if (this.isMuted) return;
		if (!this.isDucked) return;
		// Cancel any ongoing duck fade
		if (this.duckFadeTimer) {
			clearInterval(this.duckFadeTimer);
			this.duckFadeTimer = null;
		}
		const targetMusic = this.savedMusicVolume ?? this.musicVolume;
		const targetAmbient = this.savedAmbientVolume ?? this.ambientVolume;
		// Read current applied volumes from any music instance (all share same intended volume)
		let currentMusic = targetMusic;
		this.musicInstances.forEach((music) => {
			try {
				currentMusic = (music as any).volume ?? targetMusic;
				throw new Error('break');
			} catch {}
		});
		let currentAmbient = targetAmbient;
		if (this.ambientInstance) {
			currentAmbient = (this.ambientInstance as any).volume ?? targetAmbient;
		}
		if (durationMs <= 0) {
			this.musicInstances.forEach((music) => {
				if ('setVolume' in music && typeof music.setVolume === 'function') {
					music.setVolume(targetMusic);
				}
			});
			if (this.ambientInstance && 'setVolume' in this.ambientInstance && typeof (this.ambientInstance as any).setVolume === 'function') {
				(this.ambientInstance as any).setVolume(targetAmbient);
			}
			this.isDucked = false;
			this.savedMusicVolume = null;
			this.savedAmbientVolume = null;
			console.log('[AudioManager] Background volume restored instantly');
			return;
		}
		if (this.restoreFadeTimer) {
			clearInterval(this.restoreFadeTimer);
		}
		const steps = 10;
		const interval = Math.max(10, Math.floor(durationMs / steps));
		let step = 0;
		this.restoreFadeTimer = setInterval(() => {
			step++;
			const t = step / steps;
			const curMusic = currentMusic + (targetMusic - currentMusic) * t;
			const curAmbient = currentAmbient + (targetAmbient - currentAmbient) * t;
			this.musicInstances.forEach((music) => {
				if ('setVolume' in music && typeof music.setVolume === 'function') {
					music.setVolume(curMusic);
				}
			});
			if (this.ambientInstance && 'setVolume' in this.ambientInstance && typeof (this.ambientInstance as any).setVolume === 'function') {
				(this.ambientInstance as any).setVolume(curAmbient);
			}
			if (step >= steps) {
				clearInterval(this.restoreFadeTimer);
				this.restoreFadeTimer = null;
				this.isDucked = false;
				this.savedMusicVolume = null;
				this.savedAmbientVolume = null;
				console.log('[AudioManager] Background volume restored');
			}
		}, interval);
	}

	/**
	 * Get current music volume
	 */
	getVolume(): number {
		return this.musicVolume;
	}

	/**
	 * Toggle mute state
	 */
	toggleMute(): void {
		this.isMuted = !this.isMuted;
		
		if (this.isMuted) {
			this.stopAllMusic();
			console.log('[AudioManager] Audio muted');
		} else {
			console.log('[AudioManager] Audio unmuted');
			// Resume music based on current game state
			this.resumeMusicBasedOnGameState();
		}
	}

	/**
	 * Set mute state
	 */
	setMuted(muted: boolean): void {
		this.isMuted = muted;
		
		if (this.isMuted) {
			this.stopAllMusic();
			console.log('[AudioManager] Audio muted');
		} else {
			console.log('[AudioManager] Audio unmuted');
			this.resumeMusicBasedOnGameState();
		}
	}

	/**
	 * Get mute state
	 */
	isAudioMuted(): boolean {
		return this.isMuted;
	}

	/**
	 * Resume music based on current game state
	 */
	resumeMusicBasedOnGameState(): void {
		if (this.isMuted) return;

		// Only resume main music when unmuting
		// Bonus music will be triggered when showBonusBackground event is emitted
		// Don't automatically switch to bonus music based on isBonus flag
		if (!gameStateManager.isBonus) {
			this.playBackgroundMusic(MusicType.MAIN);
			this.startAmbientAudio();
		} else {
			// If we're in bonus mode but music isn't playing, don't auto-start bonus music
			// It should only start when the background actually changes
			console.log('[AudioManager] In bonus mode - bonus music will start when background changes');
		}
	}

	/**
	 * Start ambient audio
	 */
	startAmbientAudio(): void {
		if (this.isMuted || !this.ambientInstance) return;

		if (!this.ambientInstance.isPlaying) {
			this.ambientInstance.play();
			console.log('[AudioManager] Ambient audio started');
		}
	}

	/**
	 * Stop ambient audio
	 */
	stopAmbientAudio(): void {
		if (this.ambientInstance && this.ambientInstance.isPlaying) {
			this.ambientInstance.stop();
			console.log('[AudioManager] Ambient audio stopped');
		}
	}

	/**
	 * Set ambient audio volume
	 */
	setAmbientVolume(volume: number): void {
		this.ambientVolume = Math.max(0, Math.min(1, volume));
		
		if (this.ambientInstance && 'setVolume' in this.ambientInstance && typeof this.ambientInstance.setVolume === 'function') {
			this.ambientInstance.setVolume(this.ambientVolume);
		}
		
		console.log(`[AudioManager] Ambient volume set to: ${this.ambientVolume}`);
	}

	/**
	 * Get ambient audio volume
	 */
	getAmbientVolume(): number {
		return this.ambientVolume;
	}

	/**
	 * Handle game state changes and switch music accordingly
	 */
	onGameStateChange(): void {
		if (this.isMuted) return;

		// Only switch to main music when leaving bonus mode
		// Bonus music will be triggered when showBonusBackground event is emitted
		// Don't automatically switch to bonus music based on isBonus flag
		if (!gameStateManager.isBonus && this.currentMusic === MusicType.BONUS) {
			this.playBackgroundMusic(MusicType.MAIN);
		}
	}

	/**
	 * Switch to free spin music (can be called during bonus mode)
	 */
	switchToFreeSpinMusic(): void {
		if (this.isMuted) return;
		
		this.playBackgroundMusic(MusicType.FREE_SPIN);
		console.log('[AudioManager] Switched to free spin background music');
	}

	/**
	 * Play a sound effect
	 */
	playSoundEffect(sfxType: SoundEffectType, rate?: number): void {
		if (this.isMuted) {
			console.log('[AudioManager] Audio is muted, skipping sound effect');
			return;
		}

		console.log(`[AudioManager] Attempting to play ${sfxType} sound effect`);
		console.log(`[AudioManager] Available SFX instances:`, Array.from(this.sfxInstances.keys()));
		
		const sfx = this.sfxInstances.get(sfxType);
		if (sfx) {
			try {
				// Apply optional playback rate/timeScale if supported
				if (typeof rate === 'number' && rate > 0) {
					try {
						if ('setRate' in sfx && typeof (sfx as any).setRate === 'function') {
							(sfx as any).setRate(rate);
						} else if ('rate' in (sfx as any)) {
							(sfx as any).rate = rate;
						}
					} catch (e) {
						console.warn('[AudioManager] Failed to apply playback rate to SFX:', e);
					}
				}
				sfx.play();
				// Track current win SFX so we can fade it out on dialog close
				if (
					sfxType === SoundEffectType.WIN_BIG ||
					sfxType === SoundEffectType.WIN_MEGA ||
					sfxType === SoundEffectType.WIN_SUPER ||
					sfxType === SoundEffectType.WIN_EPIC
				) {
					this.currentWinSfx = sfx;
				}
				console.log(`[AudioManager] Successfully playing ${sfxType} sound effect`);
			} catch (error) {
				console.error(`[AudioManager] Error playing ${sfxType} sound effect:`, error);
			}
		} else {
			console.warn(`[AudioManager] Sound effect instance not found for type: ${sfxType}`);
		}
	}

	/**
	 * Fade out a specific SFX by type and stop it when done
	 */
	fadeOutSfx(sfxType: SoundEffectType, durationMs: number = 400): void {
		const sfx = this.sfxInstances.get(sfxType);
		if (!sfx || !sfx.isPlaying) return;
		try {
			const startVolume = (sfx as any).volume ?? this.sfxVolume;
			const steps = 8;
			const interval = Math.max(10, Math.floor(durationMs / steps));
			let step = 0;
			const timer = setInterval(() => {
				step++;
				const t = step / steps;
				const vol = startVolume * (1 - t);
				if ('setVolume' in sfx && typeof (sfx as any).setVolume === 'function') {
					(sfx as any).setVolume(Math.max(0, vol));
				}
				if (step >= steps) {
					clearInterval(timer);
					if (sfx.isPlaying) sfx.stop();
					if ('setVolume' in sfx && typeof (sfx as any).setVolume === 'function') {
						(sfx as any).setVolume(this.sfxVolume);
					}
				}
			}, interval);
		} catch (e) {
			console.warn('[AudioManager] Failed to fade out SFX:', e);
			try { if (sfx.isPlaying) sfx.stop(); } catch {}
		}
	}

	/**
	 * Fade out any currently playing win SFX and stop it when done
	 */
	fadeOutCurrentWinSfx(durationMs: number = 400): void {
		if (!this.currentWinSfx) return;
		const sfx = this.currentWinSfx;
		try {
			const startVolume = (sfx as any).volume ?? this.sfxVolume;
			const steps = 8;
			const interval = Math.max(10, Math.floor(durationMs / steps));
			let step = 0;
			const timer = setInterval(() => {
				step++;
				const t = step / steps;
				const vol = startVolume * (1 - t);
				if ('setVolume' in sfx && typeof (sfx as any).setVolume === 'function') {
					(sfx as any).setVolume(Math.max(0, vol));
				}
				if (step >= steps) {
					clearInterval(timer);
					if (sfx.isPlaying) sfx.stop();
					if ('setVolume' in sfx && typeof (sfx as any).setVolume === 'function') {
						(sfx as any).setVolume(this.sfxVolume);
					}
					if (this.currentWinSfx === sfx) this.currentWinSfx = null;
				}
			}, interval);
		} catch (e) {
			console.warn('[AudioManager] Failed to fade out win SFX:', e);
			try { if (sfx.isPlaying) sfx.stop(); } catch {}
			if (this.currentWinSfx === sfx) this.currentWinSfx = null;
		}
	}

	/**
	 * Play win dialog SFX based on dialog type
	 */
	playWinDialogSfx(dialogType: string): void {
		if (this.isMuted) return;
		let effect: SoundEffectType | null = null;
		const t = (dialogType || '').toLowerCase();

		switch (t) {
			case 'smallw_ka':
				effect = SoundEffectType.WIN_BIG; break;
			case 'mediumw_ka':
				effect = SoundEffectType.WIN_MEGA; break;
			case 'largew_ka':
				effect = SoundEffectType.WIN_SUPER; break;
			case 'superw_ka':
				effect = SoundEffectType.WIN_EPIC; break;
			default:
				break;
		}

		if (effect) {
			this.playSoundEffect(effect);
		}
	}

	/**
	 * Set sound effect volume
	 */
	setSfxVolume(volume: number): void {
		this.sfxVolume = Math.max(0, Math.min(1, volume));
		
		this.sfxInstances.forEach((sfx) => {
			if ('setVolume' in sfx && typeof sfx.setVolume === 'function') {
				sfx.setVolume(this.sfxVolume);
			}
		});
		
		console.log(`[AudioManager] Sound effect volume set to: ${this.sfxVolume}`);
	}

	/**
	 * Get sound effect volume
	 */
	getSfxVolume(): number {
		return this.sfxVolume;
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {
		console.log('[AudioManager] Destroying AudioManager...');
		this.stopAllMusic();
		this.musicInstances.clear();
		this.sfxInstances.clear();
		this.ambientInstance = null;
		console.log('[AudioManager] AudioManager destroyed');
	}

	/**
	 * Get current playing music type
	 */
	getCurrentMusicType(): MusicType | null {
		return this.currentMusic;
	}

	/**
	 * Check if any music is currently playing
	 */
	isMusicPlaying(): boolean {
		return this.currentMusic !== null && !this.isMuted;
	}
}
