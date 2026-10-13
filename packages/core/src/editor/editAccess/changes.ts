import { ROOT_NODE } from '@craftjs/utils';
import { Patch } from 'immer';
import isEqual from 'lodash/isEqual';

import { EditorState, Node } from '../../interfaces';

/** Only broad replacements require scanning the entire tree. */
export function changedNodeIds(
  previous: EditorState,
  next: EditorState,
  patches: readonly Patch[]
): string[] {
  const ids = new Set<string>();
  for (const patch of patches) {
    const [root, id] = patch.path;
    if (!patch.path.length || (root === 'nodes' && id === undefined)) {
      return Array.from(
        new Set([...Object.keys(previous.nodes), ...Object.keys(next.nodes)])
      );
    }
    if (root === 'nodes') ids.add(String(id));
  }
  return Array.from(ids);
}

function isContainer(value: any): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Array.isArray(value) ||
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

/** A whole-style replacement may only change color; inspect actual changed leaves. */
export function hasChangedPath(
  previous: any,
  next: any,
  predicate: (path: readonly (string | number)[]) => boolean,
  path: (string | number)[] = []
): boolean {
  if (isEqual(previous, next)) return false;
  if (isContainer(previous) || isContainer(next)) {
    const keys = new Set([
      ...Object.keys(isContainer(previous) ? previous : {}),
      ...Object.keys(isContainer(next) ? next : {}),
    ]);
    if (!keys.size) return predicate(path);
    return Array.from(keys).some((key) =>
      hasChangedPath(previous?.[key], next?.[key], predicate, [...path, key])
    );
  }
  return predicate(path);
}

/** Ids reachable from ROOT, tolerating malformed links in loaded documents. */
function attachedNodeIds(state: EditorState): Set<string> {
  const visited = new Set<string>();
  const pending = [ROOT_NODE];
  while (pending.length) {
    const id = pending.pop();
    const data = state.nodes[id]?.data;
    if (!data || visited.has(id)) continue;
    visited.add(id);
    if (Array.isArray(data.nodes)) pending.push(...data.nodes);
    if (isContainer(data.linkedNodes))
      pending.push(...(Object.values(data.linkedNodes) as string[]));
  }
  return visited;
}

/**
 * Structural edits must leave one rooted tree with consistent parent references.
 * Detached nodes already present in `previous` (legacy documents) are tolerated;
 * edits may not detach or add any others.
 */
export function hasValidTree(
  state: EditorState,
  previous: EditorState
): boolean {
  const root = state.nodes[ROOT_NODE];
  if (!root?.data || root.data.parent) return false;
  const visited = new Set<string>();
  const pending = [{ id: ROOT_NODE, parent: undefined as string | undefined }];
  while (pending.length) {
    const { id, parent } = pending.pop();
    const node = state.nodes[id];
    if (
      !node?.data ||
      node.id !== id ||
      visited.has(id) ||
      !Array.isArray(node.data.nodes) ||
      !isContainer(node.data.linkedNodes) ||
      Array.isArray(node.data.linkedNodes) ||
      (parent && node.data.parent !== parent)
    )
      return false;
    visited.add(id);
    for (const child of [
      ...node.data.nodes,
      ...Object.values(node.data.linkedNodes),
    ]) {
      pending.push({ id: child, parent: id });
    }
  }
  const ids = Object.keys(state.nodes);
  if (visited.size === ids.length) return true;
  const attached = attachedNodeIds(previous);
  return ids.every(
    (id) => visited.has(id) || (previous.nodes[id] && !attached.has(id))
  );
}

export function hasStructureChange(previous: Node, next: Node): boolean {
  return ['parent', 'nodes', 'linkedNodes', 'type', 'isCanvas'].some(
    (key) => !isEqual(previous.data[key], next.data[key])
  );
}

export function hasOtherDataChange(previous: Node, next: Node): boolean {
  const excluded = new Set([
    'props',
    'custom',
    'parent',
    'nodes',
    'linkedNodes',
    'type',
    'isCanvas',
  ]);
  return Array.from(
    new Set([...Object.keys(previous.data), ...Object.keys(next.data)])
  ).some(
    (key) => !excluded.has(key) && !isEqual(previous.data[key], next.data[key])
  );
}
