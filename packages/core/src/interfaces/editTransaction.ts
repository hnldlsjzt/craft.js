import { Action } from '@craftjs/utils';
import { Patch } from 'immer';

import { EditAccessResult } from './editAccess';
import { EditorState } from './editor';
import { NodeId } from './nodes';

export type EditTransactionSource =
  | 'user-edit'
  | 'lock-control'
  | 'document-load'
  | 'derived-binding'
  | 'runtime-data';

export type DocumentChangeSource = EditTransactionSource | 'history';

export type DocumentChange = {
  revision: number;
  source: DocumentChangeSource;
  actionType: string;
  changedNodeIds: NodeId[];
};

export type EditTransactionContext = {
  source?: EditTransactionSource;
  /** Capture the current document revision before starting asynchronous work. */
  documentRevision?: string | number;
};

export type SystemEditChange = {
  context: EditTransactionContext;
  previousState: EditorState;
  nextState: EditorState;
  patches: readonly Patch[];
};

export type EditDenied = EditAccessResult & {
  nodeId?: NodeId;
  action: Action;
  context: EditTransactionContext;
};
