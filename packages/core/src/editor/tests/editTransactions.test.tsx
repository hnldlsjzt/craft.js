import { act, renderHook } from '@testing-library/react';

import { EditAccessPolicy, EditorLock, Nodes } from '../../interfaces';
import { createNode } from '../../utils/createNode';
import { useEditorStore } from '../store';

function makeNodes(): Nodes {
  const nodes: Nodes = {};
  for (const id of ['ROOT', 'parent', 'child', 'linked', 'outside']) {
    nodes[id] = createNode({
      id,
      data: {
        type: 'div',
        isCanvas: true,
        parent: id === 'ROOT' ? null : 'ROOT',
        props: { style: { width: 100, color: 'black' }, label: id },
      },
    });
  }
  nodes.ROOT.data.nodes = ['parent', 'outside'];
  nodes.parent.data.nodes = ['child'];
  nodes.parent.data.linkedNodes = { content: 'linked' };
  nodes.child.data.parent = 'parent';
  nodes.linked.data.parent = 'parent';
  return nodes;
}

function renderStore(
  policy: boolean | EditAccessPolicy = true,
  locks: Record<string, EditorLock> = {},
  prepare?: (nodes: Nodes) => void
) {
  const onEditDenied = jest.fn();
  const nodes = makeNodes();
  for (const [id, lock] of Object.entries(locks)) {
    nodes[id].data.custom.editorLock = lock;
  }
  prepare?.(nodes);
  const { result, unmount } = renderHook(() =>
    useEditorStore({ editAccess: policy, onEditDenied }, () => {})
  );
  const store = result.current;
  act(() => {
    store.actions.transact({ source: 'document-load' }, (actions) => {
      actions.replaceNodes(nodes);
    });
    store.actions.history.clear();
  });
  return { store, onEditDenied, unmount };
}

type Store = ReturnType<typeof renderStore>['store'];

function capture(store: Store) {
  return {
    nodes: store.query.getNodes(),
    json: store.query.serialize(),
    history: [...store.history.timeline],
    pointer: store.history.pointer,
  };
}

function expectUnchanged(store: Store, before: ReturnType<typeof capture>) {
  expect(store.query.getNodes()).toBe(before.nodes);
  expect(store.query.serialize()).toBe(before.json);
  expect(store.history.timeline).toEqual(before.history);
  expect(store.history.pointer).toBe(before.pointer);
}

const props = (store: Store, id = 'child') =>
  store.query.node(id).get().data.props;

describe('editor edit transactions', () => {
  it('allows position-locked content updates and rejects geometry updates', () => {
    const { store, onEditDenied } = renderStore(true, { child: 'position' });
    act(() =>
      store.actions.setProp('child', (value) => {
        value.style.color = 'red';
      })
    );
    expect(props(store).style).toEqual({ width: 100, color: 'red' });
    const before = capture(store);
    act(() =>
      store.actions.setProp('child', (value) => {
        value.style.width = 200;
      })
    );
    expectUnchanged(store, before);
    expect(onEditDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed: false,
        nodeId: 'child',
        reason: 'node-locked',
        lockOwnerId: 'child',
      })
    );
  });

  it('classifies actual leaf changes when an entire style is replaced', () => {
    const { store } = renderStore(true, { child: 'position' });
    act(() =>
      store.actions.setProp('child', (value) => {
        value.style = { width: 100, color: 'red' };
      })
    );
    expect(props(store).style.color).toBe('red');
    const before = capture(store);
    act(() =>
      store.actions.setProp('child', (value) => {
        value.style = { width: 200, color: 'blue' };
      })
    );
    expectUnchanged(store, before);
  });

  it.each([
    'null-props',
    'delete-props',
    'empty-props',
    'null-style',
    'delete-style',
  ])('rejects removal of position-locked geometry through %s', (change) => {
    const { store } = renderStore(true, { child: 'position' });
    const before = capture(store);
    act(() =>
      store.actions.setState((draft) => {
        const data = draft.nodes.child.data;
        switch (change) {
          case 'null-props':
            data.props = null;
            break;
          case 'delete-props':
            delete data.props;
            break;
          case 'empty-props':
            data.props = {};
            break;
          case 'null-style':
            data.props.style = null;
            break;
          case 'delete-style':
            delete data.props.style;
            break;
        }
      })
    );
    expectUnchanged(store, before);
  });

  it('rejects a batch atomically when one selected node is locked', () => {
    const { store } = renderStore(true, { child: 'all' });
    const before = capture(store);
    act(() =>
      store.actions.setProp(['outside', 'child'], (value) => {
        value.label = 'changed';
      })
    );
    expectUnchanged(store, before);
  });

  it('rejects geometry from a whole node map replacement through setState', () => {
    const { store } = renderStore(true, { child: 'position' });
    const before = capture(store);
    act(() =>
      store.actions.setState((draft) => {
        draft.nodes = {
          ...draft.nodes,
          child: {
            ...draft.nodes.child,
            data: {
              ...draft.nodes.child.data,
              props: { style: { width: 999 } },
            },
          },
        };
      })
    );
    expectUnchanged(store, before);
  });

  it('does not permit setState to disable its own protection', () => {
    const { store, onEditDenied } = renderStore(true, { child: 'all' });
    const before = capture(store);
    act(() =>
      store.actions.setState((draft) => {
        draft.options.editAccess = false;
        draft.nodes.child.data.props.label = 'changed';
      })
    );
    expectUnchanged(store, before);
    expect(store.query.getOptions().editAccess).toBe(true);
    expect(onEditDenied.mock.calls[0][0].reason).toBe('configuration-in-edit');
  });

  it('rejects node identity rewrites that could impersonate an editable scope', () => {
    const { store } = renderStore({ scope: ['parent'] });
    const before = capture(store);
    act(() =>
      store.actions.setState((draft) => {
        draft.nodes.outside.id = 'parent';
      })
    );
    expectUnchanged(store, before);
  });

  it('does not permit unlocking and editing locked content in one transaction', () => {
    const { store } = renderStore(true, { child: 'all' });
    const before = capture(store);
    act(() =>
      store.actions.transact({}, (actions) => {
        actions.setCustom('child', (custom) => {
          custom.editorLock = '';
        });
        actions.setProp('child', (value) => {
          value.label = 'changed';
        });
      })
    );
    expectUnchanged(store, before);
    act(() => store.actions.setEditorLock('child', ''));
    act(() =>
      store.actions.setProp('child', (value) => {
        value.label = 'changed';
      })
    );
    expect(props(store).label).toBe('changed');
  });

  it('preserves unrelated custom metadata when changing a lock', () => {
    const { store } = renderStore();
    act(() =>
      store.actions.setCustom('child', (custom) => {
        custom.name = 'tag';
      })
    );
    act(() => store.actions.setEditorLock('child', 'all'));
    expect(store.query.node('child').get().data.custom).toEqual({
      name: 'tag',
      editorLock: 'all',
    });
    act(() => store.actions.setEditorLock('child', ''));
    expect(store.query.node('child').get().data.custom.name).toBe('tag');
  });

  it('does not allow lock-control transactions to write ordinary props', () => {
    const { store, onEditDenied } = renderStore();
    const before = capture(store);
    act(() =>
      store.actions.transact({ source: 'lock-control' }, (actions) => {
        actions.setProp('child', (value) => {
          value.label = 'changed';
        });
      })
    );
    expectUnchanged(store, before);
    expect(onEditDenied.mock.calls[0][0].reason).toBe('invalid-lock-change');
  });

  it.each(['ignore', 'merge', 'throttle'] as const)(
    'keeps history.%s from bypassing node protection',
    (wrapper) => {
      const { store } = renderStore(true, { child: 'all' });
      const before = capture(store);
      act(() => {
        const actions =
          wrapper === 'throttle'
            ? store.actions.history.throttle(1000)
            : store.actions.history[wrapper]();
        actions.setProp('child', (value) => {
          value.label = 'changed';
        });
      });
      expectUnchanged(store, before);
    }
  );

  it('commits a multi-action transaction as one undoable change', () => {
    const { store } = renderStore();
    act(() =>
      store.actions.transact({}, (actions) => {
        actions.setProp('child', (value) => {
          value.style.width = 200;
        });
        actions.setProp('outside', (value) => {
          value.label = 'changed';
        });
      })
    );
    expect(store.history.timeline).toHaveLength(1);
    expect(props(store).style.width).toBe(200);
    act(() => store.actions.history.undo());
    expect(props(store).style.width).toBe(100);
    expect(props(store, 'outside').label).toBe('outside');
    act(() => store.actions.history.redo());
    expect(props(store, 'outside').label).toBe('changed');
  });

  it('replays accepted changes intact while retaining page readonly protection', () => {
    const { store } = renderStore();
    act(() =>
      store.actions.transact({}, (actions) => {
        actions.setProp('child', (value) => {
          value.label = 'changed';
        });
        actions.setCustom('child', (custom) => {
          custom.editorLock = 'all';
        });
      })
    );
    act(() => store.actions.history.undo());
    expect(props(store).label).toBe('child');
    act(() => store.actions.history.redo());
    expect(props(store).label).toBe('changed');
    expect(store.query.node('child').get().data.custom.editorLock).toBe('all');
    act(() =>
      store.actions.setOptions((options) => {
        options.enabled = false;
      })
    );
    const before = capture(store);
    act(() => store.actions.history.undo());
    expectUnchanged(store, before);
  });

  it('allows scope descendants and rejects edits to siblings', () => {
    const { store } = renderStore({ scope: ['parent'] });
    act(() =>
      store.actions.setProp('linked', (value) => {
        value.label = 'inside';
      })
    );
    expect(props(store, 'linked').label).toBe('inside');
    const before = capture(store);
    act(() =>
      store.actions.setProp('outside', (value) => {
        value.label = 'outside change';
      })
    );
    expectUnchanged(store, before);
  });

  it('checks current locks when a previously captured callback is invoked', () => {
    const { store } = renderStore();
    const delayed = () =>
      store.actions.setProp('child', (value) => {
        value.label = 'late';
      });
    act(() => store.actions.setEditorLock('child', 'all'));
    const before = capture(store);
    act(delayed);
    expectUnchanged(store, before);
  });

  it('rejects a delayed transaction from an earlier document revision', () => {
    const { store, onEditDenied } = renderStore({ documentRevision: 'page-A' });
    const context = { documentRevision: 'page-A' };
    act(() =>
      store.actions.setOptions((options) => {
        options.editAccess = { documentRevision: 'page-B' };
      })
    );
    const before = capture(store);
    act(() =>
      store.actions.transact(context, (actions) => {
        actions.setProp('child', (value) => {
          value.label = 'late';
        });
      })
    );
    expectUnchanged(store, before);
    expect(onEditDenied.mock.calls[0][0].reason).toBe('stale-document');
  });

  it.each(['derived-binding', 'runtime-data'] as const)(
    'requires explicit host authorization for %s',
    (source) => {
      const { store, onEditDenied } = renderStore(true, { child: 'all' });
      const before = capture(store);
      act(() =>
        store.actions.transact({ source }, (actions) => {
          actions.setProp('child', (value) => {
            value.label = 'runtime';
          });
        })
      );
      expectUnchanged(store, before);
      expect(onEditDenied.mock.calls[0][0].reason).toBe(
        'system-change-not-authorized'
      );
      act(() =>
        store.actions.setOptions((options) => {
          options.editAccess = {
            canApplySystemChange: ({ context }) => context.source === source,
          };
        })
      );
      act(() =>
        store.actions.transact({ source }, (actions) => {
          actions.setProp('child', (value) => {
            value.label = 'runtime';
          });
        })
      );
      expect(props(store).label).toBe('runtime');
    }
  );

  it('permits explicit document loading even when editing is disabled', () => {
    const { store } = renderStore(true, { child: 'all' });
    act(() =>
      store.actions.setOptions((options) => {
        options.enabled = false;
      })
    );
    const next = makeNodes();
    next.child.data.props.label = 'loaded';
    act(() =>
      store.actions.transact({ source: 'document-load' }, (actions) => {
        actions.replaceNodes(next);
      })
    );
    expect(props(store).label).toBe('loaded');
  });

  it('does not treat direct deserialize as an authorized document load', () => {
    const { store } = renderStore(true, { child: 'all' });
    const data = JSON.parse(store.query.serialize());
    data.child.props.label = 'bypass';
    const before = capture(store);
    act(() => store.actions.deserialize(data));
    expectUnchanged(store, before);
  });

  it('extends geometry classification for application fields', () => {
    const { store } = renderStore(
      { isGeometryProp: (path) => path[0] === 'points' },
      { child: 'position' }
    );
    const before = capture(store);
    act(() =>
      store.actions.setProp('child', (value) => {
        value.points = [{ x: 10 }];
      })
    );
    expectUnchanged(store, before);
  });

  it('does not commit or record history when a policy incorrectly returns a promise', () => {
    const { store } = renderStore({
      // @ts-expect-error JavaScript callers can supply an async policy hook.
      getLock: async () => '',
    });
    const before = capture(store);
    expect(() =>
      act(() =>
        store.actions.setProp('child', (value) => {
          value.label = 'changed';
        })
      )
    ).toThrow(/synchronous/i);
    expectUnchanged(store, before);
  });

  it('retains legacy programmatic editing when editAccess is disabled', () => {
    const { store } = renderStore(false, { child: 'all' });
    act(() =>
      store.actions.setOptions((options) => {
        options.enabled = false;
      })
    );
    act(() =>
      store.actions.setProp('child', (value) => {
        value.style.width = 999;
      })
    );
    expect(props(store).style.width).toBe(999);
  });

  it('rejects asynchronous transaction callbacks without committing draft changes', () => {
    const { store } = renderStore();
    const before = capture(store);
    expect(() =>
      act(() =>
        store.actions.transact({}, async (actions) => {
          actions.setProp('child', (value) => {
            value.label = 'async';
          });
        })
      )
    ).toThrow(/synchronous/i);
    expectUnchanged(store, before);
  });
});

describe('editor structural access', () => {
  it.each(['missing-parent', 'parent-cycle', 'missing-linked', 'linked-cycle'])(
    'rejects setState introducing an invalid tree: %s',
    (change) => {
      const { store } = renderStore();
      const before = capture(store);
      act(() =>
        store.actions.setState((draft) => {
          switch (change) {
            case 'missing-parent':
              draft.nodes.child.data.parent = 'missing';
              break;
            case 'missing-linked':
              draft.nodes.parent.data.linkedNodes.content = 'missing';
              break;
            case 'parent-cycle':
            case 'linked-cycle':
              draft.nodes.ROOT.data.nodes = ['outside'];
              draft.nodes.parent.data.parent = 'child';
              if (change === 'parent-cycle') {
                draft.nodes.child.data.nodes = ['parent'];
              } else {
                draft.nodes.child.data.linkedNodes.loop = 'parent';
              }
              break;
          }
        })
      );
      expectUnchanged(store, before);
    }
  );

  describe('documents loaded with detached nodes', () => {
    const withOrphans = (nodes: Nodes) => {
      for (const [id, parent] of [
        ['orphan', 'gone'],
        ['orphanChild', 'orphan'],
      ]) {
        nodes[id] = createNode({ id, data: { type: 'div', parent } });
      }
      nodes.orphan.data.nodes = ['orphanChild'];
    };

    it('still allows structural edits', () => {
      const { store, onEditDenied } = renderStore(true, {}, withOrphans);
      act(() => store.actions.move('child', 'outside', 0));
      expect(store.query.node('outside').get().data.nodes).toEqual(['child']);
      act(() => store.actions.delete('outside'));
      expect(store.query.node('outside').get()).toBeUndefined();
      expect(store.query.node('orphan').get()).toBeDefined();
      expect(onEditDenied).not.toHaveBeenCalled();
    });

    it('rejects edits that detach further nodes', () => {
      const { store, onEditDenied } = renderStore(true, {}, withOrphans);
      const before = capture(store);
      act(() =>
        store.actions.setState((draft) => {
          draft.nodes.parent.data.nodes = [];
        })
      );
      expectUnchanged(store, before);
      expect(onEditDenied.mock.calls[0][0].reason).toBe('invalid-tree');
    });
  });

  it('allows a complete parent reassignment in one setState transaction', () => {
    const { store } = renderStore();
    act(() =>
      store.actions.setState((draft) => {
        draft.nodes.parent.data.nodes = [];
        draft.nodes.outside.data.nodes = ['child'];
        draft.nodes.child.data.parent = 'outside';
      })
    );
    expect(store.query.node('child').get().data.parent).toBe('outside');
    expect(store.query.node('outside').get().data.nodes).toEqual(['child']);
    expect(store.history.timeline).toHaveLength(1);
  });

  it.each(['child', 'linked'])(
    'rejects ancestor removal when its %s descendant is locked',
    (id) => {
      const { store } = renderStore(true, { [id]: 'position' });
      const before = capture(store);
      act(() => store.actions.delete('parent'));
      expectUnchanged(store, before);
    }
  );

  it('rejects moving a node out of its locked parent', () => {
    const { store } = renderStore(true, { parent: 'position' });
    const before = capture(store);
    act(() => store.actions.move('child', 'outside', 0));
    expectUnchanged(store, before);
  });

  it('rejects moving into a destination containing a locked linked node', () => {
    const { store } = renderStore(true, { linked: 'all' });
    const before = capture(store);
    act(() => store.actions.move('outside', 'parent', 0));
    expectUnchanged(store, before);
  });

  it('rejects inserts into a locked subtree and accepts them after unlocking', () => {
    const { store } = renderStore(true, { parent: 'all' });
    const added = createNode({ id: 'added', data: { type: 'div' } });
    const tree = { rootNodeId: added.id, nodes: { added } };
    const before = capture(store);
    act(() => store.actions.addNodeTree(tree, 'parent'));
    expectUnchanged(store, before);
    act(() => store.actions.setEditorLock('parent', ''));
    act(() => store.actions.addNodeTree(tree, 'parent'));
    expect(store.query.node('parent').get().data.nodes).toContain('added');
  });

  it('inherits a parent lock for linked-node props', () => {
    const { store } = renderStore(true, { parent: 'all' });
    const before = capture(store);
    act(() =>
      store.actions.setProp('linked', (value) => {
        value.label = 'changed';
      })
    );
    expectUnchanged(store, before);
  });
});
