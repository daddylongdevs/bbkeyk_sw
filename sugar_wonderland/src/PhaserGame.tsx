import React, { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import StartGame from './game/main';
import { releasePhaserWebGL } from '../../core/utils/releasePhaserWebGL';
import { EventBus } from './game/EventBus';

export interface IRefPhaserGame
{
	game: Phaser.Game | null;
	scene: Phaser.Scene | null;
}

export interface IProps
{
	currentActiveScene?: (scene_instance: Phaser.Scene) => void
}

export const PhaserGame = forwardRef<IRefPhaserGame, IProps>(function PhaserGame({ currentActiveScene }, ref)
{
	const game = useRef<Phaser.Game | null>(null!);
	const refProp = useRef(ref);
	const currentActiveSceneRef = useRef(currentActiveScene);
	const [_scene, setScene] = useState<Phaser.Scene | null>(null);

	refProp.current = ref;
	currentActiveSceneRef.current = currentActiveScene;

	useLayoutEffect(() =>
	{
		if (game.current === null)
		{
			game.current = StartGame("game-container");

			const r = refProp.current;
			if (typeof r === 'function')
			{
				r({ game: game.current, scene: null });
			} else if (r)
			{
				r.current = { game: game.current, scene: null };
			}
		}

		return () =>
		{
			if (game.current)
			{
				const current = game.current;
				game.current = null;
				try {
					(window as any).scratchDesktopHost?.destroy?.();
				} catch {
					/* noop */
				}
				try {
					(window as any).scratchDesktopHost = null;
				} catch {
					/* noop */
				}
				releasePhaserWebGL(current);
				try {
					(window as any).phaserGame = null;
				} catch {
					/* noop */
				}
			}
		}
	// Mount once — do not depend on `ref` (identity changes remount and exhaust WebGL contexts).
	}, []);

	useEffect(() =>
	{
		EventBus.on('current-scene-ready', (scene_instance: Phaser.Scene) =>
		{
			const onScene = currentActiveSceneRef.current;
			if (onScene && typeof onScene === 'function')
			{
				onScene(scene_instance);
				setScene(scene_instance);
			}

			const r = refProp.current;
			if (typeof r === 'function')
			{
				r({ game: game.current, scene: scene_instance });
			} else if (r)
			{
				r.current = { game: game.current, scene: scene_instance };
			}
				
		});
		return () =>
		{
			EventBus.removeListener('current-scene-ready');
		}
	}, []);

	return (
		<>
			<div id="game-container"></div>
		</>
	);

});
