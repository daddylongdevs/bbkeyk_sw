import React, { useEffect, useState } from 'react';
import * as Phaser from 'phaser';
import { EventBus } from '../game/EventBus';
import styles from './Loading.module.scss';

interface Props {
	currentScene: Phaser.Scene | null;
	mode: { isPortrait: boolean } | null;
}

export const Loading = ({ currentScene, mode }: Props) => {
	const [progress, setProgress] = useState<number>(0);
	const [scene, setScene] = useState<Phaser.Scene | null>(null);

	useEffect(() => {
		EventBus.on('progress', (p: number) => {
			setProgress(p);
			// console.log(`Loading progress: ${p}: ${scene?.scene.key}`);
		});
	}, []);

	useEffect(() => {
		if (currentScene) {
			setScene(currentScene);
		}
	}, [currentScene]);
	
	// Debug logging for mode detection - only log when values change
	useEffect(() => {
		console.log(`[Loading] Current mode:`, mode);
		console.log(`[Loading] Is portrait:`, mode?.isPortrait);
		console.log(`[Loading] Scene key:`, scene?.scene.key);
	}, [mode, scene]);
	
	return (
		<div>
			{scene && scene.scene.key === "Preloader" && (
				<div>
					{landscape(mode, progress)}
					{portrait(mode, progress)}
				</div>
			)}
		</div>
	);
};

function landscape(mode: { isPortrait: boolean } | null, progress: number) {
	if (!mode || mode.isPortrait) {
		return null;
	}

	return (
		<div className={styles.desktop}>
			<div className={styles.loading}>
				<p className={styles.max_win}></p>

				<div>
					<div className={styles.progress_bar_bg}>
						<div 
							className={styles.progress_bar} 
							style={{ width: `${progress * 100}%` }}
						>
						</div>
					</div>
				</div>
				
			</div>
		</div>
	)
}

function portrait(mode: { isPortrait: boolean } | null, progress: number) {
	if (!mode || !mode.isPortrait) {
		return null;
	}

	return (
		<div className={styles.mobile}>
			<div className={styles.loading}>
			<p className={styles.max_win}></p>
				<div className={styles.progress_bar_bg}>
					<div 
						className={styles.progress_bar} 
						style={{ width: `${progress * 100}%` }}
					>
					</div>
				</div>
			</div>
		</div>
	)
}


