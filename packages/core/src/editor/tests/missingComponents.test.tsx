import { act, render, renderHook, screen } from '@testing-library/react';
import React from 'react';

import { Editor, Frame, useEditor } from '../..';
import { SerializedNode, SerializedNodes } from '../../interfaces';
import { serializeNode } from '../../utils/serializeNode';
import { useEditorStore } from '../store';

function Known({ label }: { label: string }) {
  return <span>{label}</span>;
}

function node(
  type: SerializedNode['type'],
  overrides: Partial<SerializedNode> = {}
): SerializedNode {
  return {
    type,
    displayName: typeof type === 'string' ? type : type.resolvedName,
    props: {},
    custom: {},
    isCanvas: false,
    hidden: false,
    parent: 'ROOT',
    nodes: [],
    linkedNodes: {},
    ...overrides,
  };
}

function document(): SerializedNodes {
  return {
    ROOT: node('div', {
      parent: null,
      isCanvas: true,
      nodes: ['known', 'missing'],
    }),
    known: node(
      { resolvedName: 'Known' },
      {
        props: { label: 'visible sibling' },
      }
    ),
    missing: node(
      { resolvedName: 'EnergyFlowAnalysis' },
      {
        displayName: 'Original display name',
        props: {
          value: null,
          key: 'persisted-key',
          children: [{ id: 'plain business data' }],
          record: { resolvedName: 'plain business value', value: 2 },
        },
        custom: { version: 2 },
        isCanvas: true,
        nodes: ['child'],
        linkedNodes: { content: 'linked' },
      }
    ),
    child: node(
      { resolvedName: 'Known' },
      {
        parent: 'missing',
        props: { label: 'hidden descendant' },
      }
    ),
    linked: node(
      { resolvedName: 'FutureChart' },
      {
        parent: 'missing',
        props: { nested: { value: null } },
      }
    ),
  };
}

function renderStore(allowMissingComponents = true) {
  const resolver = { Known };
  const options = { resolver, allowMissingComponents };
  const { result } = renderHook(() => useEditorStore(options, () => {}));
  return { store: result.current, resolver };
}

describe('optional missing component compatibility', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('warns once per missing name and resolver without losing data', () => {
    const { store, resolver } = renderStore();
    const input = document();
    act(() => store.actions.deserialize(input));
    act(() => store.actions.deserialize(input));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Component <EnergyFlowAnalysis /> is not registered')
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Component <FutureChart /> is not registered')
    );
    expect(store.query.getSerializedNodes()).toEqual(input);
    expect(Object.keys(resolver)).toEqual(['Known']);

    const other = renderStore();
    other.store.query.parseSerializedNode(input.missing).toNode();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('does not warn for registered components, HTML nodes or strict failures', () => {
    const { store } = renderStore();
    store.query.parseSerializedNode(node('div')).toNode();
    store.query.parseSerializedNode(node({ resolvedName: 'Known' })).toNode();
    const strict = renderStore(false);
    expect(() =>
      strict.store.query.parseSerializedNode(document().missing).toNode()
    ).toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps strict behavior when the option is disabled or omitted', () => {
    for (const options of [
      { resolver: { Known } },
      {
        resolver: { Known },
        allowMissingComponents: false,
      },
    ]) {
      const { result } = renderHook(() => useEditorStore(options, () => {}));
      expect(() => result.current.actions.deserialize(document())).toThrow();
      expect(result.current.query.getNodes()).toEqual({});
    }
  });

  it.each(['direct', 'json', 'ignore', 'merge', 'throttle', 'transaction'])(
    'handles %s loading without changing resolver or losing serialized data',
    (mode) => {
      const input = document();
      const before = JSON.stringify(input);
      const { store, resolver } = renderStore();
      act(() => {
        if (mode === 'transaction') {
          store.actions.transact({ source: 'document-load' }, (actions) => {
            actions.deserialize(input);
          });
        } else if (mode === 'json') {
          store.actions.deserialize(JSON.stringify(input));
        } else if (mode === 'ignore') {
          store.actions.history.ignore().deserialize(input);
        } else if (mode === 'merge') {
          store.actions.history.merge().deserialize(input);
        } else if (mode === 'throttle') {
          store.actions.history.throttle().deserialize(input);
        } else {
          store.actions.deserialize(input);
        }
      });

      expect(store.query.getSerializedNodes()).toEqual(input);
      expect(JSON.stringify(input)).toBe(before);
      expect(store.query.getOptions().resolver).toBe(resolver);
      expect(Object.keys(resolver)).toEqual(['Known']);
      expect(store.query.node('known').get().data.type).toBe(Known);
      expect(store.query.node('missing').get().data.type).not.toBe(
        store.query.node('linked').get().data.type
      );
      if (mode === 'ignore') expect(store.query.history.canUndo()).toBe(false);
    }
  );

  it('renders known siblings while a missing container hides its retained subtree', () => {
    let editor: ReturnType<typeof useEditor>;
    const onDocumentChange = jest.fn();
    function Probe() {
      editor = useEditor();
      return null;
    }
    const options = { resolver: { Known }, allowMissingComponents: true };
    const input = document();
    render(
      <Editor {...options} onDocumentChange={onDocumentChange}>
        <Frame data={input} />
        <Probe />
      </Editor>
    );

    expect(screen.getByText('visible sibling')).toBeTruthy();
    expect(screen.queryByText('hidden descendant')).toBeNull();
    expect(editor.query.getSerializedNodes()).toEqual(input);
    expect(editor.query.history.canUndo()).toBe(false);
    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    expect(onDocumentChange).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'document-load', revision: 1 })
    );
  });

  it('supports parseSerializedNode and reuses each name within a resolver', () => {
    const { store, resolver } = renderStore();
    const input = document().missing;
    const first = store.query.parseSerializedNode(input).toNode();
    const second = store.query.parseSerializedNode(input).toNode();
    expect(first.data.type).toBe(second.data.type);
    expect(serializeNode(first.data, resolver)).toEqual(input);
  });

  it('preserves names and function identity through edit, delete, undo and redo', () => {
    const { store } = renderStore();
    const input = document();
    act(() => store.actions.history.ignore().deserialize(input));
    const missingType = store.query.node('missing').get().data.type;
    act(() =>
      store.actions.setProp('missing', (props) => {
        props.value = 'edited';
      })
    );
    act(() => store.actions.history.undo());
    expect(store.query.getSerializedNodes()).toEqual(input);

    act(() => store.actions.delete('missing'));
    expect(store.query.getNodes().child).toBeUndefined();
    expect(store.query.getNodes().linked).toBeUndefined();
    act(() => store.actions.history.undo());
    expect(store.query.node('missing').get().data.type).toBe(missingType);
    expect(store.query.getSerializedNodes()).toEqual(input);
    act(() => store.actions.history.redo());
    expect(store.query.getNodes().missing).toBeUndefined();
    act(() => store.actions.history.undo());
    expect(store.query.getSerializedNodes()).toEqual(input);
  });

  it('keeps existing placeholders serializable when the resolver changes', () => {
    const { store } = renderStore();
    const input = document();
    act(() => store.actions.history.ignore().deserialize(input));
    act(() =>
      store.actions.setOptions((options) => {
        options.resolver = { ...options.resolver, AnotherKnown: Known };
      })
    );
    expect(store.query.getSerializedNodes().missing).toEqual(input.missing);
    expect(store.query.getSerializedNodes().linked).toEqual(input.linked);
  });

  it('continues to enforce edit-access locks on missing nodes', () => {
    const onEditDenied = jest.fn();
    const options = {
      resolver: { Known },
      allowMissingComponents: true,
      editAccess: true,
      onEditDenied,
    };
    const { result } = renderHook(() => useEditorStore(options, () => {}));
    const store = result.current;
    const input = document();
    input.missing.custom.editorLock = 'all';
    act(() =>
      store.actions.transact({ source: 'document-load' }, (actions) => {
        actions.deserialize(input);
      })
    );
    const before = store.query.serialize();

    act(() => store.actions.delete('missing'));

    expect(store.query.serialize()).toBe(before);
    expect(onEditDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed: false,
        lockOwnerId: 'missing',
      })
    );
  });

  it('applies strict mode to subsequent parsing after the option is disabled', () => {
    const { store } = renderStore();
    const input = document();
    act(() => store.actions.history.ignore().deserialize(input));
    act(() =>
      store.actions.setOptions((options) => {
        options.allowMissingComponents = false;
      })
    );
    expect(() =>
      store.query.parseSerializedNode(input.missing).toNode()
    ).toThrow();
    expect(store.query.getSerializedNodes()).toEqual(input);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'does not treat inherited resolver properties as registered components: %s',
    (name) => {
      const { store, resolver } = renderStore();
      const input = node({ resolvedName: name });
      const parsed = store.query.parseSerializedNode(input).toNode();
      expect(serializeNode(parsed.data, resolver)).toEqual(input);
      expect(Object.keys(resolver)).toEqual(['Known']);
    }
  );

  it.each(['undefined', 'null'])(
    'does not mask malformed props for a missing component: %s',
    (value) => {
      const { store } = renderStore();
      const input = node({ resolvedName: 'FutureMaterial' });
      input.props = value === 'null' ? null : undefined;
      expect(() => store.query.parseSerializedNode(input).toNode()).toThrow();
    }
  );

  it('uses a real component after it becomes available and the document is reloaded', () => {
    const { store } = renderStore();
    const input = node({ resolvedName: 'FutureMaterial' });
    const placeholder = store.query.parseSerializedNode(input).toNode().data
      .type;
    act(() =>
      store.actions.setOptions((options) => {
        options.resolver = { ...options.resolver, FutureMaterial: Known };
      })
    );
    const restored = store.query.parseSerializedNode(input).toNode();
    expect(restored.data.type).toBe(Known);
    expect(restored.data.type).not.toBe(placeholder);
  });

  it('propagates compatibility to missing components inside known JSX children', () => {
    const { store, resolver } = renderStore();
    const input = node('div', {
      parent: null,
      props: {
        children: [
          {
            type: { resolvedName: 'FutureInline' },
            isCanvas: false,
            props: { value: null, record: { resolvedName: 'business data' } },
          },
        ],
      },
    });
    const parsed = store.query.parseSerializedNode(input).toNode();
    expect(React.isValidElement(parsed.data.props.children[0])).toBe(true);
    expect(serializeNode(parsed.data, resolver)).toEqual(input);
  });

  it.each([
    '{}',
    '{"type":null}',
    '{"type":{}}',
    '{"type":{"resolvedName":42}}',
  ])('continues to reject malformed node types: %s', (json) => {
    const { store } = renderStore();
    expect(() =>
      store.query.parseSerializedNode(JSON.parse(json)).toNode()
    ).toThrow();
  });
});
