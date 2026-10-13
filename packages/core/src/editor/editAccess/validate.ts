import { Action, HISTORY_ACTIONS } from '@craftjs/utils';
import { Patch } from 'immer';
import isEqual from 'lodash/isEqual';

import {
  changedNodeIds,
  hasChangedPath,
  hasOtherDataChange,
  hasStructureChange,
  hasValidTree,
} from './changes';
import { getEditAccess, isGeometryProp } from './permissions';

import {
  EditAccessResult,
  EditOperation,
  EditorState,
  EditTransactionContext,
} from '../../interfaces';

const wrappedActions = [
  HISTORY_ACTIONS.IGNORE,
  HISTORY_ACTIONS.MERGE,
  HISTORY_ACTIONS.THROTTLE,
];

function unwrap(action: Action) {
  return wrappedActions.includes(action.type)
    ? { type: action.payload[0], payload: action.payload.slice(1) }
    : action;
}

export function validateEditorChange(
  next: EditorState,
  previous: EditorState,
  action: Action,
  patches: Patch[]
): boolean {
  const configured = previous.options.editAccess;
  if (!configured) return true;
  const policy = typeof configured === 'object' ? configured : {};
  const performed = unwrap(action);
  const context: EditTransactionContext =
    performed.type === 'transact' ? performed.payload[0] || {} : {};
  const source = context.source || 'user-edit';
  const deny = (result: EditAccessResult, nodeId?: string) => {
    previous.options.onEditDenied?.({ ...result, nodeId, action, context });
    return false;
  };
  const reject = (reason: string) => deny({ allowed: false, reason });
  if (
    context.documentRevision !== undefined &&
    context.documentRevision !== policy.documentRevision
  )
    return reject('stale-document');

  // History replays accepted transactions intact; page-level readonly still applies.
  if ([HISTORY_ACTIONS.UNDO, HISTORY_ACTIONS.REDO].includes(action.type)) {
    return previous.options.enabled || reject('editor-disabled');
  }
  if (action.type === HISTORY_ACTIONS.CLEAR) return true;
  // Configuration is a host capability. setState cannot change its own policy.
  if (performed.type === 'setOptions') return true;
  if (
    next.options !== previous.options &&
    !isEqual(next.options, previous.options)
  ) {
    return reject('configuration-in-edit');
  }
  if (source === 'document-load') return true;
  if (source === 'derived-binding' || source === 'runtime-data') {
    const decision = policy.canApplySystemChange?.({
      context,
      previousState: previous,
      nextState: next,
      patches,
    });
    if (decision && typeof (decision as any).then === 'function') {
      throw new Error('Edit access policies must return synchronously');
    }
    return decision === true || reject('system-change-not-authorized');
  }
  if (source !== 'user-edit' && source !== 'lock-control')
    return reject('unknown-edit-source');
  if (
    !next.nodes ||
    typeof next.nodes !== 'object' ||
    Array.isArray(next.nodes)
  )
    return reject('invalid-tree');

  const check = (id: string, operation: EditOperation) => {
    const result = getEditAccess(previous, id, { operation });
    return result.allowed || deny(result, id);
  };
  let structureChanged = false;
  for (const id of changedNodeIds(previous, next, patches)) {
    const before = previous.nodes[id];
    const after = next.nodes[id];
    if (after && (after.id !== id || !after.data))
      return reject('invalid-tree');
    if (before === after || isEqual(before?.data, after?.data)) continue;
    if (source === 'lock-control') {
      if (
        !before ||
        !after ||
        hasChangedPath(
          before.data,
          after.data,
          (path) => path.join('.') !== 'custom.editorLock'
        )
      )
        return reject('invalid-lock-change');
    }
    if (!before) {
      structureChanged = true;
      let parent = after?.data.parent;
      const seen = new Set<string>([id]);
      while (parent && !previous.nodes[parent] && !seen.has(parent)) {
        seen.add(parent);
        parent = next.nodes[parent]?.data.parent;
      }
      if (!parent || seen.has(parent)) return reject('invalid-tree');
      if (!check(parent, 'structure')) return false;
      continue;
    }
    if (!after) {
      structureChanged = true;
      if (!check(id, 'structure')) return false;
      continue;
    }
    if (hasStructureChange(before, after)) {
      structureChanged = true;
      if (!check(id, 'structure')) return false;
    }
    const oldCustom = before.data.custom || {};
    const newCustom = after.data.custom || {};
    if (!isEqual(oldCustom.editorLock, newCustom.editorLock)) {
      if (![undefined, '', 'position', 'all'].includes(newCustom.editorLock))
        return reject('invalid-lock');
      if (!check(id, 'lock')) return false;
    }
    const ordinaryCustomChanged = hasChangedPath(
      oldCustom,
      newCustom,
      (path) => path[0] !== 'editorLock'
    );
    const propsChanged = !isEqual(before.data.props, after.data.props);
    if (
      (ordinaryCustomChanged ||
        propsChanged ||
        hasOtherDataChange(before, after)) &&
      !check(id, 'props')
    )
      return false;
    if (
      propsChanged &&
      hasChangedPath(before.data.props, after.data.props, (path) =>
        isGeometryProp(path, before, policy)
      ) &&
      !check(id, 'geometry')
    )
      return false;
  }
  return !structureChanged || hasValidTree(next, previous) || reject('invalid-tree');
}
