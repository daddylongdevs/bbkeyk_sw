import { CanvasAnimationFrameCache, type CanvasFrameSource } from './CanvasAnimationFrameCache';
import { isSpineSlotTransparent } from './SpineTransparentCulling';

// Each game supplies its installed Spine runtime so core never imports a second copy.
interface SpineCanvasRuntime {
	Skeleton: { new(data: any): any; yDown: boolean };
	MeshAttachment: new(...args: any[]) => any;
	RegionAttachment: new(...args: any[]) => any;
	MixBlend: { setup: number };
	MixDirection: { mixIn: number };
	Physics: { none: number; reset: number; update: number };
}

interface CanvasCacheScene {
	events: {
		once(event: string, listener: () => void): unknown;
		off(event: string, listener: () => void): unknown;
	};
}

const FRAME_RATE = 60;
const BLENDS = ['source-over', 'lighter', 'multiply', 'screen'] as const;

/** Cache registered Spine animations on one Canvas renderer; leave other objects live. */
export function installSpineCanvasFrameCache(
	scene: CanvasCacheScene,
	renderer: any,
	runtime: SpineCanvasRuntime,
	options: { cacheRegions?: boolean } = {},
): void {
	const { Skeleton, MeshAttachment, RegionAttachment, MixBlend, MixDirection, Physics } = runtime;
	const cache = new CanvasAnimationFrameCache();
	const poses = new Map<object, { id: number; skeleton: any; frame: number; signature: string }>();
	const drawTriangles = renderer.drawTriangles;

	renderer.drawTriangles = function (live: any) {
		// The owner is registered when a scratch symbol starts its win clip.
		const owner = (live as any).__scratchFrameCacheOwner;
		const state = owner?.animationState;
		const track = state?.getCurrent(0);
		if (!track || track.mixingFrom || track.alpha !== 1 || state.tracks.some((t: unknown, i: number) => i > 0 && t)) {
			return drawTriangles.call(this, live);
		}

		let pose = poses.get(live.data);
		if (!pose) {
			pose = { id: poses.size, skeleton: new Skeleton(live.data), frame: -1, signature: '' };
			poses.set(live.data, pose);
		}
		const frame = Math.floor(track.getAnimationTime() * FRAME_RATE);
		const rotation = live.getRootBone()!.rotation;
		// Include scale, skin and skeleton color; never cache a cell's screen position.
		const signature = [pose.id, track.animation.name, live.scaleX, live.scaleY, rotation,
			live.data.skins.indexOf(live.skin!), live.color.r, live.color.g, live.color.b, live.color.a].join('|');
		const layers = cache.getFrame(`${signature}|${frame}`, () => {
			const hasPhysics = live.physicsConstraints.length > 0;
			if (hasPhysics && (pose!.signature !== signature || frame < pose!.frame)) {
				pose!.skeleton = new Skeleton(live.data);
				pose!.frame = -1;
			}
			pose!.signature = signature;
			const skeleton = pose!.skeleton;
			skeleton.setSkin(live.skin!);
			skeleton.color.setFromColor(live.color);
			skeleton.scaleX = live.scaleX;
			skeleton.scaleY = Skeleton.yDown ? -live.scaleY : live.scaleY;
			// Physics needs fixed-step history, including skipped frames. Restart when
			// sampling an earlier phase or a different appearance; never mutate the live pose.
			const start = hasPhysics ? pose!.frame + 1 : frame;
			for (let step = start; step <= frame; step++) {
				skeleton.setToSetupPose();
				track.animation.apply(skeleton, -1, step / FRAME_RATE, false, [], 1, MixBlend.setup, MixDirection.mixIn);
				// Match SpineGameObject.renderCanvas's camera-derived root rotation.
				skeleton.getRootBone().rotation = rotation;
				if (hasPhysics && step > 0) skeleton.update(1 / FRAME_RATE);
				skeleton.updateWorldTransform(hasPhysics ? (step === 0 ? Physics.reset : Physics.update) : Physics.none);
				pose!.frame = step;
			}

			const groups: { slots: any[]; blend: GlobalCompositeOperation }[] = [];
			let previousCached = false;
			for (const slot of skeleton.drawOrder) {
				const attachment = slot.getAttachment();
				if (isSpineSlotTransparent(skeleton, slot, attachment as any)) continue;
				if (!(attachment instanceof MeshAttachment || attachment instanceof RegionAttachment)) continue;
				if (options.cacheRegions === false && attachment instanceof RegionAttachment) {
					previousCached = false;
					continue;
				}
				const blend = BLENDS[slot.data.blendMode] ?? 'source-over';
				const previous = groups[groups.length - 1];
				if (previousCached && blend === 'source-over' && previous?.blend === blend) previous.slots.push(slot);
				else groups.push({ slots: [slot], blend });
				previousCached = true;
			}

			return groups.map(({ slots, blend }): CanvasFrameSource => {
				let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
				for (const slot of slots) {
					const attachment = slot.getAttachment();
					const vertices = attachment instanceof MeshAttachment
						? this.computeMeshVertices(slot, attachment, false)
						: this.computeRegionVertices(slot, attachment, false);
					const count = attachment instanceof MeshAttachment ? attachment.worldVerticesLength / 2 : 4;
					for (let i = 0; i < count; i++) {
						minX = Math.min(minX, vertices[i * 8]); maxX = Math.max(maxX, vertices[i * 8]);
						minY = Math.min(minY, vertices[i * 8 + 1]); maxY = Math.max(maxY, vertices[i * 8 + 1]);
					}
				}
				return {
					id: slots.map(slot => slot.data.index).join(','),
					x: minX, y: minY, width: maxX - minX, height: maxY - minY, blendMode: blend,
					draw: context => {
						const output = this.ctx;
						this.ctx = context;
						try {
							drawTriangles.call(this, { color: skeleton.color, drawOrder: slots }, 'source-over');
						} finally {
							this.ctx = output;
						}
					},
				};
			});
		});
		if (!layers) return drawTriangles.call(this, live);
		const context: CanvasRenderingContext2D = this.ctx;
		context.save();
		try {
			context.globalAlpha = 1;
			const drawLayer = (layer: typeof layers[number]) => {
				context.globalCompositeOperation = layer.blendMode;
				context.drawImage(layer.canvas, live.x + layer.x, live.y + layer.y);
			};
			if (options.cacheRegions !== false) {
				for (const layer of layers) drawLayer(layer);
			} else {
				const bySlot = new Map<number, typeof layers[number] | null>();
				for (const layer of layers) {
					const indices = layer.id!.split(',').map(Number);
					for (const index of indices) bySlot.set(index, null);
					bySlot.set(indices[0], layer);
				}
				for (const slot of live.drawOrder) {
					const index = slot.data.index;
					if (!bySlot.has(index)) drawTriangles.call(this, { color: live.color, drawOrder: [slot] });
					else if (bySlot.get(index)) drawLayer(bySlot.get(index)!);
				}
			}
		} finally {
			context.restore();
		}
	};

	const dispose = () => {
		scene.events.off('shutdown', dispose);
		scene.events.off('destroy', dispose);
		renderer.drawTriangles = drawTriangles;
		cache.clear();
		poses.clear();
	};
	scene.events.once('shutdown', dispose);
	scene.events.once('destroy', dispose);
}
