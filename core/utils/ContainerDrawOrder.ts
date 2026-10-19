/**
 * Group selected container children by an ascending numeric batch key.
 * Works with Phaser 3 and 4: both render Container.list in array order.
 *
 * Return null/undefined to exclude a child: it keeps its exact list position.
 * Equal keys keep their relative order. This changes draw order only; child
 * ownership, depth, and game-specific logical arrays are not modified.
 * Call before rendering, using a pure key callback. Only opt in where reordering
 * overlapping children is acceptable. Matching keys still need compatible
 * textures, shaders, blend modes and masks to actually share a GPU batch.
 *
 * Returns true when reordered. Already grouped lists allocate no scratch arrays.
 */
export function groupContainerChildrenByKey<T>(
  container: { list: T[] },
  getKey: (child: T) => number | null | undefined,
): boolean {
  const children = container.list;
  let previous = -Infinity;
  let needsGrouping = false;
  for (const child of children) {
    const key = getKey(child);
    if (key == null) continue;
    if (key < previous) {
      needsGrouping = true;
      break;
    }
    previous = key;
  }
  if (!needsGrouping) return false;

  const selected: T[] = [];
  const positions: number[] = [];
  for (let i = 0; i < children.length; i++) {
    if (getKey(children[i]) == null) continue;
    selected.push(children[i]);
    positions.push(i);
  }
  selected.sort((a, b) => getKey(a)! - getKey(b)!);
  for (let i = 0; i < selected.length; i++) children[positions[i]] = selected[i];
  return true;
}
