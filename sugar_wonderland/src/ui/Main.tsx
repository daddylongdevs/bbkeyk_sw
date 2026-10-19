import React from 'react';
import * as Phaser from 'phaser';  // Import Phaser for type access
import { Loading } from './Loading';
// import { GameUI } from './Game';  // Commented out for future use
import { useEffect, useState } from 'react';
import { ScreenModeManager } from '../managers/ScreenModeManager';
import { EventBus } from '../game/EventBus';

interface MainProps {
	currentScene: Phaser.Scene | null;
}

export const Main = ({ currentScene }: MainProps) => {
	const [screenConfig, setScreenConfig] = useState<{ isPortrait: boolean } | null>(null);	

	useEffect(() => {
		// Listen for the ScreenModeManager from the Boot scene
		const handleScreenModeManagerReady = (screenModeManager: ScreenModeManager) => {
			console.log('[Main] Received ScreenModeManager from Boot scene');
			const config = screenModeManager.getScreenConfig();
			console.log('[Main] Screen config:', config);
			setScreenConfig(config);
		};

		EventBus.on('screen-mode-manager-ready', handleScreenModeManagerReady);

		// Cleanup
		return () => {
			EventBus.off('screen-mode-manager-ready', handleScreenModeManagerReady);
		};
	}, []);	

	return (
		<div>
			{Loading({ currentScene: currentScene, mode: screenConfig })}
			{/* GameUI({ currentScene: currentScene, mode: screenConfig }) - Commented out for future use */}
		</div>
	);
};