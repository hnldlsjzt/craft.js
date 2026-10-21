import { ERROR_RESOLVER_NOT_AN_OBJECT, HISTORY_ACTIONS } from '@craftjs/utils';
import * as React from 'react';
import invariant from 'tiny-invariant';

import { EditorContext } from './EditorContext';
import { changedNodeIds } from './editAccess/changes';
import { editorInitialState, useEditorStore } from './store';

import { Events } from '../events';
import { DocumentChangeSource, Options } from '../interfaces';

type EditorProps = Partial<Options> & {
  children?: React.ReactNode;
};

/**
 * Whether any node was added, removed, or had its `data` replaced.
 * Relies on Immer's structural sharing: a node whose data wasn't touched keeps
 * the same `data` reference even when its `events` / `dom` changed.
 * A removal always rewrites the parent's `data.nodes`, but the length check
 * covers it on its own anyway.
 */
const hasNodeDataChanged = (
  prevNodes: Record<string, any> | null,
  nodes: Record<string, any>
) => {
  if (!prevNodes) {
    return true;
  }

  const ids = Object.keys(nodes);
  if (ids.length !== Object.keys(prevNodes).length) {
    return true;
  }

  for (let i = 0; i < ids.length; i++) {
    const prev = prevNodes[ids[i]];
    if (!prev || prev.data !== nodes[ids[i]].data) {
      return true;
    }
  }

  return false;
};

const HISTORY_ACTIONS_WITH_WRAPPER = [
  HISTORY_ACTIONS.IGNORE,
  HISTORY_ACTIONS.MERGE,
  HISTORY_ACTIONS.THROTTLE,
];

const unwrapAction = (action: { type: any; params?: any[] }) => {
  let type = action.type;
  let params = action.params || [];
  while (HISTORY_ACTIONS_WITH_WRAPPER.includes(type) && params.length) {
    type = params[0];
    params = params.slice(1);
  }
  return { type, params };
};

const isDocumentPatchPath = (path: readonly (string | number)[]) => {
  if (!path.length) return true;
  if (path[0] !== 'nodes') return false;
  return path.length <= 2 || path[2] === 'data';
};

const getDocumentChangeSource = (action: {
  type: any;
  params?: any[];
}): DocumentChangeSource => {
  if ([HISTORY_ACTIONS.UNDO, HISTORY_ACTIONS.REDO].includes(action.type))
    return 'history';
  const performed = unwrapAction(action);
  if (performed.type === 'transact') {
    const context = performed.params[0] || {};
    return context.source || 'user-edit';
  }
  return 'user-edit';
};

/**
 * A React Component that provides the Editor context
 */
export const Editor = ({ children, ...options }: EditorProps) => {
  // we do not want to warn the user if no resolver was supplied
  if (options.resolver !== undefined) {
    invariant(
      typeof options.resolver === 'object' &&
        !Array.isArray(options.resolver) &&
        options.resolver !== null,
      ERROR_RESOLVER_NOT_AN_OBJECT
    );
  }

  const optionsRef = React.useRef(options);
  const documentRevisionRef = React.useRef(0);

  const context = useEditorStore(
    optionsRef.current,
    (state, previousState, actionPerformedWithPatches, query, normalizer) => {
      if (!actionPerformedWithPatches) {
        return;
      }

      const { patches, ...actionPerformed } = actionPerformedWithPatches;

      for (let i = 0; i < patches.length; i++) {
        const { path } = patches[i];
        const isModifyingNodeData =
          path.length > 2 && path[0] === 'nodes' && path[2] === 'data';

        let actionType = actionPerformed.type;

        if (
          [
            HISTORY_ACTIONS.IGNORE,
            HISTORY_ACTIONS.MERGE,
            HISTORY_ACTIONS.THROTTLE,
          ].includes(actionType) &&
          actionPerformed.params
        ) {
          actionPerformed.type = actionPerformed.params[0];
        }

        if (
          ['setState', 'deserialize', 'transact'].includes(
            actionPerformed.type
          ) ||
          isModifyingNodeData
        ) {
          normalizer((draft) => {
            if (state.options.normalizeNodes) {
              state.options.normalizeNodes(
                draft,
                previousState,
                actionPerformed,
                query
              );
            }
          });
          break; // we exit the loop as soon as we find a change in node.data
        }
      }
    },
    (_state, _previousState, actionPerformedWithPatches) => {
      const { patches } = actionPerformedWithPatches;
      if (!patches.some((patch) => isDocumentPatchPath(patch.path))) return;

      documentRevisionRef.current += 1;
      const performed = unwrapAction(actionPerformedWithPatches);
      optionsRef.current.onDocumentChange?.({
        revision: documentRevisionRef.current,
        source: getDocumentChangeSource(actionPerformedWithPatches),
        actionType: String(performed.type),
        changedNodeIds: changedNodeIds(_previousState, _state, patches),
      });
    }
  );

  // sync enabled prop with editor store options
  React.useEffect(() => {
    if (!context) {
      return;
    }

    if (
      options.enabled === undefined ||
      context.query.getOptions().enabled === options.enabled
    ) {
      return;
    }

    context.actions.setOptions((editorOptions) => {
      editorOptions.enabled = options.enabled;
    });
  }, [context, options.enabled]);

  /**
   * Notifies `onNodesChange` subscribers.
   *
   * This used to collect `query.serialize()` — a full walk of every Node plus a
   * JSON.stringify — on *every* dispatch, including ones that never touch node
   * data (select, hover, setIndicator). On a large tree that alone accounted for
   * most of the cost of a single click.
   *
   * Changes:
   * 1. Skip node comparisons while no callback is configured.
   * 2. Never serialize inside the collector. Consumers that need the JSON call
   *    `query.serialize()` themselves inside the callback, where they can debounce it.
   * 3. Notify only when serialized output *could* change. `serialize()` reads node ids, each
   *    `node.data` and `options.resolver` (see NodeHelpers.toSerializedNode), and
   *    every write goes through Immer, so comparing those references is exact.
   *    hover / select / setDOM / setIndicator leave them untouched and are skipped.
   *
   *    An earlier version collected a bare counter (`++version` on every call).
   *    That made the collector O(1) but also turned every dispatch — hover included —
   *    into an `onNodesChange` call, silently moving the serialize cost into the
   *    consumer's debounced callback instead of removing it.
   */
  React.useEffect(() => {
    let version = 0;
    let prevNodes = context.query.getNodes();
    let prevResolver = context.query.getOptions().resolver;

    return context.subscribe(
      (state) => {
        const { nodes } = state;
        const resolver = state.options.resolver;
        const callback = state.options.onNodesChange;

        if (
          !callback ||
          callback === editorInitialState.options.onNodesChange
        ) {
          prevNodes = nodes;
          prevResolver = resolver;
          return { version };
        }

        // nodes 引用没变（如 setIndicator / setOptions）直接跳过，省掉 O(n) 比较
        const changed =
          resolver !== prevResolver ||
          (nodes !== prevNodes && hasNodeDataChanged(prevNodes, nodes));

        if (changed) {
          version++;
        }

        prevNodes = nodes;
        prevResolver = resolver;

        return { version };
      },
      () => context.query.getOptions().onNodesChange(context.query),
      false,
      { initialCollected: { version } }
    );
  }, [context]);

  React.useEffect(() => {
    if (!context) return;
    optionsRef.current.onDocumentChange = options.onDocumentChange;
    const current = context.query.getOptions();
    const changePolicy =
      options.editAccess !== undefined &&
      current.editAccess !== options.editAccess;
    const changeCallback =
      options.onEditDenied !== undefined &&
      current.onEditDenied !== options.onEditDenied;
    const documentChangeCallback =
      options.onDocumentChange !== undefined &&
      current.onDocumentChange !== options.onDocumentChange;
    if (!changePolicy && !changeCallback && !documentChangeCallback) return;
    context.actions.setOptions((editorOptions) => {
      if (changePolicy) editorOptions.editAccess = options.editAccess;
      if (changeCallback) editorOptions.onEditDenied = options.onEditDenied;
      if (documentChangeCallback)
        editorOptions.onDocumentChange = options.onDocumentChange;
    });
  }, [
    context,
    options.editAccess,
    options.onEditDenied,
    options.onDocumentChange,
  ]);

  if (!context) {
    return null;
  }

  return (
    <EditorContext.Provider value={context}>
      <Events>{children}</Events>
    </EditorContext.Provider>
  );
};
