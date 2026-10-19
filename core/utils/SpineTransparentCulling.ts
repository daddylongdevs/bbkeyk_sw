type MeshRendererPrototype = {
	__transparentMeshCullingInstalled?: boolean;
	renderMesh(
		renderer: unknown,
		mesh: { alpha: number },
		baseContext: unknown,
		currentContext: unknown,
		parentMatrix?: unknown,
	): unknown;
};

/** Phaser 4: skip invisible Spine meshes before changing render state. */
export function installSpineTransparentMeshCulling(rendererPrototype: object): void {
	// Spine declares renderMesh private; the runtime prototype exposes it.
	const prototype = rendererPrototype as MeshRendererPrototype;
	if (prototype.__transparentMeshCullingInstalled) return;
	const original = prototype.renderMesh;
	prototype.renderMesh = function (renderer, mesh, baseContext, currentContext, parentMatrix) {
		if (mesh.alpha === 0) return currentContext;
		return original.call(this, renderer, mesh, baseContext, currentContext, parentMatrix);
	};
	prototype.__transparentMeshCullingInstalled = true;
}

type SpineColorOwner = { color?: { a: number } };

/** Canvas: test before computing vertices or submitting triangles. Preserve partial alpha. */
export function isSpineSlotTransparent(
	skeleton: SpineColorOwner,
	slot: SpineColorOwner,
	attachment: SpineColorOwner | null | undefined,
): boolean {
	return skeleton.color?.a === 0 || slot.color?.a === 0 || attachment?.color?.a === 0;
}
