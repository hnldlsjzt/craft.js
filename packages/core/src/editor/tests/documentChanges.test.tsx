import { act, render, renderHook } from '@testing-library/react';
import React from 'react';

import { Editor, useEditor } from '../..';
import { createNode } from '../../utils/createNode';
import { useEditorStore } from '../store';

const serializedDocument = JSON.stringify({
  ROOT: {
    type: 'div',
    isCanvas: true,
    props: { children: 'initial' },
    displayName: 'div',
    custom: {},
    hidden: false,
    nodes: [],
    linkedNodes: {},
    parent: null,
  },
});

test('reports accepted document changes with monotonic revisions and sources', () => {
  const changes: any[] = [];
  let editor: any;
  function Probe() {
    editor = useEditor();
    return null;
  }

  render(
    <Editor
      resolver={{}}
      onRender={({ render: element }) => element}
      onDocumentChange={(change) => changes.push(change)}
    >
      <Probe />
    </Editor>
  );

  act(() => {
    editor.actions.transact({ source: 'document-load' }, (actions: any) => {
      actions.deserialize(serializedDocument);
    });
  });
  act(() => {
    editor.actions.setProp('ROOT', (props: any) => {
      props.children = 'edited';
    });
  });
  act(() => editor.actions.history.undo());
  act(() => editor.actions.history.redo());

  expect(changes.map((change) => change.source)).toEqual([
    'document-load',
    'user-edit',
    'history',
    'history',
  ]);
  expect(changes.map((change) => change.revision)).toEqual([1, 2, 3, 4]);
  expect(
    changes.every((change) => change.changedNodeIds.includes('ROOT'))
  ).toBe(true);
});

test('does not classify interaction-only patches as document changes', () => {
  const commits: any[] = [];
  const { result } = renderHook(() =>
    useEditorStore(
      {},
      () => undefined,
      (_next, _previous, action) => commits.push(action)
    )
  );
  const store = result.current;

  act(() => {
    store.actions.setNodeEvent('hovered', undefined);
    store.actions.setIndicator(null);
    store.actions.setDOM('missing', document.createElement('div'));
  });

  expect(commits).toHaveLength(0);
});

test('rejected changes do not reach the commit listener', () => {
  const commits: any[] = [];
  const { result } = renderHook(() =>
    useEditorStore(
      { editAccess: { scope: [] } },
      () => undefined,
      (_next, _previous, action) => commits.push(action)
    )
  );

  act(() => {
    result.current.actions.transact(
      { source: 'document-load' },
      (actions: any) => {
        actions.replaceNodes({
          ROOT: createNode({
            id: 'ROOT',
            data: { type: 'div', isCanvas: true, parent: null, props: {} },
          }),
        });
      }
    );
  });
  commits.length = 0;

  act(() => {
    result.current.actions.setProp('ROOT', (props: any) => {
      props.children = 'rejected';
    });
  });

  expect(commits).toHaveLength(0);
});
