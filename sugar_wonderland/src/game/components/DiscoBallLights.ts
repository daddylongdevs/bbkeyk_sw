import { Scene } from "phaser";

export class DiscoBallLights extends Scene {
  constructor() {
    super('DiscoBallLights');
  }

  preload(scene: Scene) {
    scene.load.image('disco-ball-light-1', 'assets/discoballs/disco-ball-light_01.png');
		scene.load.image('disco-ball-light-2', 'assets/discoballs/disco-ball-light_02.png');
		scene.load.image('disco-ball-light-3', 'assets/discoballs/disco-ball-light_03.png');
  }

  create(scene: Scene) {
		// Spawn randomly from top to bottom
		// Make it slowly scrolling from left to right infinitely
		// Starts from left to right
		// When it reaches the right, outside of the screen, dispose
		
		// const light1 = scene.add.image(0, scene.scale.height * 0.05, 'disco-ball-light-1');
		// light1.setScale(0.1)

		// const duration = 5000;

		// scene.tweens.add({
		// 	targets: light1,
		// 	x: scene.scale.width,
		// 	duration: duration,
		// 	repeat: -1,
		// 	delay: 0,
		// });

		// const light2 = scene.add.image(0, scene.scale.height * 0.1, 'disco-ball-light-2');
		// light2.setScale(0.1)
		// scene.tweens.add({
		// 	targets: light2,
		// 	x: scene.scale.width,
		// 	duration: duration,
		// 	repeat: -1,
		// 	delay: 100,
		// });

		// const light3 = scene.add.image(0, scene.scale.height * 0.15, 'disco-ball-light-3');
		// light3.setScale(0.1)
		// scene.tweens.add({
		// 	targets: light3,
		// 	x: scene.scale.width,
		// 	duration: duration,
		// 	repeat: -1,
		// 	delay: 300,
		// });

  }
}