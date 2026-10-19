import { useEffect, useState } from 'react';
import * as Phaser from 'phaser';  // Import Phaser for type access
import { Game } from '../game/scenes/Game';
import styles from './Game.module.scss';  // Import the SCSS module
import { EventBus } from '../game/EventBus';

interface GameUIProps {
	currentScene: Phaser.Scene | null;
	mode: { isPortrait: boolean } | null;
}

// Commented out for future use - replaced with Phaser-based SlotController
/*
export const GameUI = ({ currentScene, mode }: GameUIProps) => {
	const [scene, setScene] = useState<Phaser.Scene | null>(null);

	useEffect(() => {
		if (currentScene) {
			setScene(currentScene);
		}
	}, [currentScene]);

	const spin = () => {
		let s = scene as Game;
			if (s && s.scene.key === 'Game') {
				s.spin();
			}
	}

	const turbo = () => {
		let s = scene as Game;
			if (s && s.scene.key === 'Game') {
				s.turbo();
			}
	}

	const autoplay = () => {
		if (scene) {
			let s = scene as Game;
			if (s && s.scene.key === 'Game') {
				s.autoplay();
			}
		}
	}

	const info = () => {
		if (scene) {
			EventBus.emit('info');
		}
	}

	return (
		<div>
			{scene && scene.scene.key === 'Game' && (
				<div>
					{mode && !mode.isPortrait && landscape(turbo, spin, autoplay, info)}
					{mode && mode.isPortrait && portrait(turbo, spin, autoplay, info)}
				</div>
			)}
		</div>
	);
};

function landscape(turbo: () => void, spin: () => void, autoplay: () => void, info: () => void) {
	return (
		<div className={styles.desktop}>
			<div className={styles.verticalButtons}>
				<button className={`${styles.turbo} ${styles.button}`} onClick={turbo}/>
				<button className={`${styles.spin} ${styles.button}`} onClick={spin}/>
				<button className={`${styles.autoplay} ${styles.button}`} onClick={autoplay}/>
				<button className={`${styles.info} ${styles.button}`} onClick={info}/>
			</div>
			<div className={styles.horizontalButtons}>
				<div className={`${styles.balance}`}>
					<p>BALANCE</p>
					<p>$ 200,000</p>
				</div>
				<div className={`${styles.totalWin}`}>
					<p>TOTAL WIN</p>
					<p>$ 200,000</p>
				</div>
				<div className={`${styles.bet}`}>
					<p>BET</p>
					<p>$ 200,000</p>
				</div>
			</div>
		</div>
	);
}

function portrait(turbo: () => void, spin: () => void, autoplay: () => void, info: () => void) {
	return (
		<div className={styles.mobile}>
			<div className={styles.verticalButtons}>
				<button className={`${styles.turbo} ${styles.button}`} onClick={turbo}/>
				<button className={`${styles.spin} ${styles.button}`} onClick={spin}/>
				<button className={`${styles.autoplay} ${styles.button}`} onClick={autoplay}/>
				<button className={`${styles.info} ${styles.button}`} onClick={info}/>
			</div>
			<div className={styles.horizontalButtons}>
				<div className={`${styles.balance}`}>
					<p>BALANCE</p>
					<p>$ 200,000</p>
				</div>
				<div className={`${styles.totalWin}`}>
					<p>TOTAL WIN</p>
					<p>$ 200,000</p>
				</div>
				<div className={`${styles.bet}`}>
					<p>BET</p>
					<p>$ 200,000</p>
				</div>
			</div>
		</div>
	);
}
*/

// Placeholder export to maintain module structure
export const GameUI = () => null;