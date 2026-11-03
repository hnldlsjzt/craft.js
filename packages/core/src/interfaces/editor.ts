import { QueryCallbacksFor, Delete, PatchListenerAction } from '@craftjs/utils';

import { EditAccessPolicy } from './editAccess';
import { DocumentChange, EditDenied } from './editTransaction';
import { Placement } from './events';
import { Nodes, NodeEventTypes, NodeId, Node } from './nodes';

import { QueryMethods } from '../editor/query';
import { EditorStore, ActionMethodsWithConfig } from '../editor/store';
import { useInternalEditorReturnType } from '../editor/useInternalEditor';
import { CoreEventHandlers } from '../events';

export type Options = {
  onEditDenied?: (denial: EditDenied) => void;
  /** Called after an accepted change modifies persisted node data. */
  onDocumentChange?: (change: DocumentChange) => void;
  onRender: React.ComponentType<{ render: React.ReactElement }>;
  onBeforeMoveEnd: (
    targetNode: Node,
    newParentNode: Node,
    existingParentNode: Node
  ) => void;
  /** Called on store notifications, including DOM/events; does not serialize or diff nodes. */
  onNodesChange: (query: QueryCallbacksFor<typeof QueryMethods>) => void;
  resolver: Resolver;
  /** Render unregistered serialized components as null while retaining their data. Disabled by default. */
  allowMissingComponents?: boolean;
  enabled: boolean;
  /** Opt-in node editing protection. Omit or use false for legacy behavior. */
  editAccess?: boolean | EditAccessPolicy;
  indicator: Partial<{
    success: string;
    error: string;
    transition: string;
    thickness: number;
    className: string;
    style: React.CSSProperties;
  }>;
  handlers: (store: EditorStore) => CoreEventHandlers;
  normalizeNodes: (
    state: EditorState,
    previousState: EditorState,
    actionPerformed: Delete<
      PatchListenerAction<typeof ActionMethodsWithConfig>,
      'patches'
    >,
    query: QueryCallbacksFor<typeof QueryMethods>
  ) => void;
};

export type Resolver = Record<string, string | React.ElementType>;

export interface Indicator {
  placement: Placement;
  error: string | null;
}

export type EditorEvents = Record<NodeEventTypes, Set<NodeId>>;

export type EditorState = {
  nodes: Nodes;
  events: EditorEvents;
  options: Options;
  indicator: Indicator;
};

export type ConnectedEditor<S = null> = useInternalEditorReturnType<S>;
