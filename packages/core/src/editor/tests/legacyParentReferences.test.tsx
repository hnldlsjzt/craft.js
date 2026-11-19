import { act, renderHook } from '@testing-library/react';

import { SerializedNode, SerializedNodes } from '../../interfaces';
import { createNode } from '../../utils/createNode';
import { useEditorStore } from '../store';

function node(overrides: Partial<SerializedNode> = {}): SerializedNode {
  return {
    type: 'div',
    displayName: 'div',
    props: {},
    custom: {},
    isCanvas: true,
    hidden: false,
    parent: 'ROOT',
    nodes: [],
    linkedNodes: {},
    ...overrides,
  };
}

/** Mirrors pages copied by older designers: listings are right, `parent` is stale. */
function legacyDocument(): SerializedNodes {
  return {
    ROOT: node({ parent: null, nodes: ['container', 'sibling', 'shared'] }),
    container: node({ nodes: ['stale'], linkedNodes: { slot: 'linked' } }),
    sibling: node({ nodes: ['shared'] }),
    // Declares a parent that exists elsewhere in the tree.
    stale: node({ parent: 'sibling', nodes: ['nested'] }),
    nested: node({ parent: 'stale' }),
    // Declares a parent that no longer exists.
    linked: node({ parent: 'gone' }),
    // Listed twice: the real owner cannot be determined.
    shared: node({ parent: 'gone' }),
    // Detached from ROOT entirely.
    orphan: node({ parent: 'gone', nodes: ['orphanChild'] }),
    orphanChild: node({ parent: 'gone' }),
  };
}

function load(document: SerializedNodes) {
  const onEditDenied = jest.fn();
  const { result } = renderHook(() =>
    useEditorStore({ editAccess: true, onEditDenied }, () => {})
  );
  const store = result.current;
  act(() => {
    store.actions.history
      .ignore()
      .transact({ source: 'document-load' }, (tx) => tx.deserialize(document));
  });
  return { store, onEditDenied };
}

describe('documents loaded with inconsistent parent references', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const parentOf = (store: ReturnType<typeof load>['store'], id: string) =>
    store.query.node(id).get().data.parent;

  it('aligns parent with the node that actually lists the child', () => {
    const { store } = load(legacyDocument());
    expect(parentOf(store, 'stale')).toBe('container');
    expect(parentOf(store, 'linked')).toBe('container');
    expect(parentOf(store, 'orphanChild')).toBe('orphan');
    expect(JSON.parse(store.query.serialize()).stale.parent).toBe('container');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('stale, linked, orphanChild');
  });

  it('leaves ambiguous, detached and consistent nodes untouched', () => {
    const { store } = load(legacyDocument());
    expect(parentOf(store, 'shared')).toBe('gone');
    expect(parentOf(store, 'orphan')).toBe('gone');
    expect(parentOf(store, 'nested')).toBe('stale');
    expect(parentOf(store, 'ROOT')).toBeNull();
  });

  it('does not warn for a consistent document', () => {
    const document = legacyDocument();
    document.ROOT.nodes = ['container', 'sibling'];
    document.sibling.nodes = [];
    document.stale.parent = 'container';
    document.linked.parent = 'container';
    document.orphanChild.parent = 'orphan';
    load(document);
    expect(warn).not.toHaveBeenCalled();
  });

  describe('structural edits without a manual repair', () => {
    const repairable = () => {
      const document = legacyDocument();
      // Duplicate listings stay invalid; only stale parents and orphans remain.
      document.ROOT.nodes = ['container', 'sibling'];
      document.sibling.nodes = [];
      delete document.shared;
      return document;
    };

    it.each(['ROOT', 'sibling', 'container', 'stale', 'nested'])(
      'allows inserting a new node into %s',
      (parentId) => {
        const { store, onEditDenied } = load(repairable());
        const added = createNode({ id: 'added', data: { type: 'div' } });
        act(() =>
          store.actions.addNodeTree(
            { rootNodeId: 'added', nodes: { added } },
            parentId
          )
        );
        expect(store.query.node(parentId).get().data.nodes).toContain('added');
        expect(onEditDenied).not.toHaveBeenCalled();
      }
    );

    it('allows moving and deleting a node whose parent was stale', () => {
      const { store, onEditDenied } = load(repairable());
      act(() => store.actions.move('stale', 'sibling', 0));
      expect(store.query.node('container').get().data.nodes).toEqual([]);
      expect(store.query.node('sibling').get().data.nodes).toEqual(['stale']);
      act(() => store.actions.delete('stale'));
      expect(store.query.node('stale').get()).toBeUndefined();
      expect(store.query.node('nested').get()).toBeUndefined();
      expect(onEditDenied).not.toHaveBeenCalled();
    });
  });
});
