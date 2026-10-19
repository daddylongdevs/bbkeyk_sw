import { Scene } from 'phaser';
import { SpineGameObject } from '@esotericsoftware/spine-phaser-v3';

export class KobiAss {
  public scene: Scene;
  public container: Phaser.GameObjects.Container;

  constructor() { }

  public preload(scene: Scene) {
    this.scene = scene;

		const prefix = 'assets/animations/kobi';
		scene.load.spineAtlas(
			'kobiass-atlas', `${prefix}/kobiass_character.atlas`
		);

    scene.load.spineJson('kobiass', `${prefix}/kobiass_character.json`);

		// scene.load.spineAtlas('symbol-1-atlas', 'assets/animations/symbol_1/Symbol1_KA.atlas');
		// scene.load.spineJson('symbol-1', 'assets/animations/symbol_1/Symbol1_KA.json');
  }

  public create(scene: Scene) {
    const width = scene.scale.width;
		const height = scene.scale.height;

		const spineObject = scene.add.spine(width * 0.18, height * 0.7, "kobiass", "kobiass-atlas");
		spineObject.setOrigin(0.5, 0.5);
		spineObject.setScale(0.35)
		spineObject.animationState.setAnimation(0, "win", true);


		// const symbol1 = scene.add.spine(width * 0.18, height * 0.7, "symbol-1", "symbol-1-atlas");
		// symbol1.setOrigin(0.5, 0.5);
		// symbol1.setScale(0.1)
		// symbol1.animationState.setAnimation(0, "Symbol1_KA_01", true);
  }
}