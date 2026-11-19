import {
  deprecationWarning,
  ERROR_INVALID_NODEID,
  ROOT_NODE,
  DEPRECATED_ROOT_NODE,
  QueryCallbacksFor,
  ERROR_NOPARENT,
  ERROR_DELETE_TOP_LEVEL_NODE,
  CallbacksFor,
  Delete,
  ERROR_NOT_IN_RESOLVER,
} from '@craftjs/utils';
import invariant from 'tiny-invariant';

import { QueryMethods } from './query';

import {
  EditorState,
  Indicator,
  NodeId,
  Node,
  Nodes,
  Options,
  NodeEventTypes,
  NodeTree,
  SerializedNodes,
  NodeSelector,
  NodeSelectorType,
  EditorLock,
  EditTransactionContext,
} from '../interfaces';
import { fromEntries } from '../utils/fromEntries';
import { getNodesFromSelector } from '../utils/getNodesFromSelector';
import { removeNodeFromEvents } from '../utils/removeNodeFromEvents';
import { repairParentReferences } from '../utils/repairParentReferences';

const Methods = (
  state: EditorState,
  query: QueryCallbacksFor<typeof QueryMethods>
) => {
  /** Helper functions */
  const addNodeTreeToParent = (
    tree: NodeTree,
    parentId?: NodeId,
    addNodeType?:
      | {
          type: 'child';
          index: number;
        }
      | {
          type: 'linked';
          id: string;
        }
  ) => {
    const iterateChildren = (id: NodeId, parentId?: NodeId) => {
      const node = tree.nodes[id];

      if (typeof node.data.type !== 'string') {
        invariant(
          state.options.resolver[node.data.name],
          ERROR_NOT_IN_RESOLVER.replace(
            '%node_type%',
            `${(node.data.type as any).name}`
          )
        );
      }

      state.nodes[id] = {
        ...node,
        data: {
          ...node.data,
          parent: parentId,
        },
      };

      if (node.data.nodes.length > 0) {
        delete state.nodes[id].data.props.children;
        node.data.nodes.forEach((childNodeId) =>
          iterateChildren(childNodeId, node.id)
        );
      }

      Object.values(node.data.linkedNodes).forEach((linkedNodeId) =>
        iterateChildren(linkedNodeId, node.id)
      );
    };

    iterateChildren(tree.rootNodeId, parentId);

    if (!parentId && tree.rootNodeId === ROOT_NODE) {
      return;
    }

    const parent = getParentAndValidate(parentId);

    if (addNodeType.type === 'child') {
      const index = addNodeType.index;

      if (index != null) {
        parent.data.nodes.splice(index, 0, tree.rootNodeId);
      } else {
        parent.data.nodes.push(tree.rootNodeId);
      }

      return;
    }

    parent.data.linkedNodes[addNodeType.id] = tree.rootNodeId;
  };

  const getParentAndValidate = (parentId: NodeId): Node => {
    invariant(parentId, ERROR_NOPARENT);
    const parent = state.nodes[parentId];
    invariant(parent, ERROR_INVALID_NODEID);
    return parent;
  };

  const deleteNode = (id: NodeId) => {
    const targetNode = state.nodes[id],
      parentNode = state.nodes[targetNode.data.parent];

    if (targetNode.data.nodes) {
      // we deep clone here because otherwise immer will mutate the node
      // object as we remove nodes
      [...targetNode.data.nodes].forEach((childId) => deleteNode(childId));
    }

    if (targetNode.data.linkedNodes) {
      Object.values(targetNode.data.linkedNodes).map((linkedNodeId) =>
        deleteNode(linkedNodeId)
      );
    }

    const isChildNode = parentNode.data.nodes.includes(id);

    if (isChildNode) {
      const parentChildren = parentNode.data.nodes;
      parentChildren.splice(parentChildren.indexOf(id), 1);
    } else {
      const linkedId = Object.keys(parentNode.data.linkedNodes).find(
        (id) => parentNode.data.linkedNodes[id] === id
      );
      if (linkedId) {
        delete parentNode.data.linkedNodes[linkedId];
      }
    }

    removeNodeFromEvents(state, id);
    delete state.nodes[id];
  };

  return {
    /**
     * @private
     * Add a new linked Node to the editor.
     * Only used internally by the <Element /> component
     *
     * @param tree
     * @param parentId
     * @param id
     */
    addLinkedNodeFromTree(tree: NodeTree, parentId: NodeId, id: string) {
      const parent = getParentAndValidate(parentId);

      const existingLinkedNode = parent.data.linkedNodes[id];

      if (existingLinkedNode) {
        deleteNode(existingLinkedNode);
      }

      addNodeTreeToParent(tree, parentId, { type: 'linked', id });
    },

    /**
     * Add a new Node to the editor.
     *
     * @param nodeToAdd
     * @param parentId
     * @param index
     */
    add(nodeToAdd: Node | Node[], parentId?: NodeId, index?: number) {
      // TODO: Deprecate adding array of Nodes to keep implementation simpler
      let nodes = [nodeToAdd];
      if (Array.isArray(nodeToAdd)) {
        deprecationWarning('actions.add(node: Node[])', {
          suggest: 'actions.add(node: Node)',
        });
        nodes = nodeToAdd;
      }
      nodes.forEach((node: Node) => {
        addNodeTreeToParent(
          {
            nodes: {
              [node.id]: node,
            },
            rootNodeId: node.id,
          },
          parentId,
          { type: 'child', index }
        );
      });
    },

    /**
     * Add a NodeTree to the editor
     *
     * @param tree
     * @param parentId
     * @param index
     */
    addNodeTree(tree: NodeTree, parentId?: NodeId, index?: number) {
      addNodeTreeToParent(tree, parentId, { type: 'child', index });
    },

    /**
     * Delete a Node
     * @param id
     */
    delete(selector: NodeSelector<NodeSelectorType.Id>) {
      const targets = getNodesFromSelector(state.nodes, selector, {
        existOnly: true,
        idOnly: true,
      });

      targets.forEach(({ node }) => {
        invariant(
          !query.node(node.id).isTopLevelNode(),
          ERROR_DELETE_TOP_LEVEL_NODE
        );
        deleteNode(node.id);
      });
    },

    deserialize(input: SerializedNodes | string) {
      const dehydratedNodes =
        typeof input == 'string' ? JSON.parse(input) : input;

      const nodePairs = Object.keys(dehydratedNodes).map((id) => {
        let nodeId = id;

        if (id === DEPRECATED_ROOT_NODE) {
          nodeId = ROOT_NODE;
        }

        return [
          nodeId,
          query
            .parseSerializedNode(dehydratedNodes[id])
            .toNode((node) => (node.id = nodeId)),
        ];
      });

      const nodes: Nodes = fromEntries(nodePairs);
      const repaired = repairParentReferences(nodes);
      if (repaired.length) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Craft.js] Repaired ${repaired.length} inconsistent parent reference(s) while loading the document: ` +
            repaired.join(', ')
        );
      }

      this.replaceNodes(nodes);
    },

    /**
     * Move a target Node to a new Parent at a given index
     * @param targetId
     * @param newParentId
     * @param index
     */
    move(selector: NodeSelector, newParentId: NodeId, index: number) {
      const targets = getNodesFromSelector(state.nodes, selector, {
        existOnly: true,
      });

      const newParent = state.nodes[newParentId];

      const nodesArrToCleanup = new Set<string[]>();

      targets.forEach(({ node: targetNode }, i) => {
        const targetId = targetNode.id;
        const currentParentId = targetNode.data.parent;

        query.node(newParentId).isDroppable([targetId], (err) => {
          throw new Error(err);
        });

        // modify node props
        state.options.onBeforeMoveEnd(
          targetNode,
          newParent,
          state.nodes[currentParentId]
        );

        const currentParent = state.nodes[currentParentId];
        const currentParentNodes = currentParent.data.nodes;

        nodesArrToCleanup.add(currentParentNodes);

        const oldIndex = currentParentNodes.indexOf(targetId);
        currentParentNodes[oldIndex] = '$$'; // mark for deletion

        newParent.data.nodes.splice(index + i, 0, targetId);

        state.nodes[targetId].data.parent = newParentId;
      });

      nodesArrToCleanup.forEach((nodes) => {
        const length = nodes.length;

        [...nodes].reverse().forEach((value, index) => {
          if (value !== '$$') {
            return;
          }

          nodes.splice(length - 1 - index, 1);
        });
      });
    },

    replaceNodes(nodes: Nodes) {
      this.clearEvents();
      state.nodes = nodes;
    },

    clearEvents() {
      this.setNodeEvent('selected', null);
      this.setNodeEvent('hovered', null);
      this.setNodeEvent('dragged', null);
      this.setIndicator(null);
    },

    /**
     * Resets all the editor state.
     */
    reset() {
      this.clearEvents();
      this.replaceNodes({});
    },

    /**
     * Set editor options via a callback function
     *
     * @param cb: function used to set the options.
     */
    setOptions(cb: (options: Partial<Options>) => void) {
      cb(state.options);
    },

    setNodeEvent(
      eventType: NodeEventTypes,
      nodeIdSelector: NodeSelector<NodeSelectorType.Id>
    ) {
      const targets = nodeIdSelector
        ? getNodesFromSelector(state.nodes, nodeIdSelector, {
            idOnly: true,
            existOnly: true,
          })
        : [];
      const nodeIds = new Set(targets.map(({ node }) => node.id));
      const previousIds = state.events[eventType];

      if (
        previousIds.size === nodeIds.size &&
        Array.from(previousIds).every((id) => nodeIds.has(id))
      ) {
        return;
      }

      state.events[eventType].forEach((id) => {
        if (state.nodes[id]) {
          state.nodes[id].events[eventType] = false;
        }
      });

      nodeIds.forEach((id) => {
        state.nodes[id].events[eventType] = true;
      });
      state.events[eventType] = nodeIds;
    },

    /**
     * Set custom values to a Node
     * @param id
     * @param cb
     */
    setCustom<T extends NodeId>(
      selector: NodeSelector<NodeSelectorType.Id>,
      cb: (data: EditorState['nodes'][T]['data']['custom']) => void
    ) {
      const targets = getNodesFromSelector(state.nodes, selector, {
        idOnly: true,
        existOnly: true,
      });

      targets.forEach(({ node }) => cb(state.nodes[node.id].data.custom));
    },

    /**
     * Given a `id`, it will set the `dom` porperty of that node.
     *
     * Also accepts a batch of `[id, dom]` pairs so that a whole subtree's DOM
     * registration can be applied in a single dispatch. Mounting N nodes used to
     * mean N dispatches, each one triggering a full subscriber broadcast.
     *
     * @param id of the node we want to set, or a batch of [id, dom] pairs
     * @param dom
     */
    setDOM(...args: [NodeId, HTMLElement] | [[NodeId, HTMLElement][]]) {
      if (Array.isArray(args[0])) {
        args[0].forEach(([id, dom]) => {
          if (state.nodes[id]) state.nodes[id].dom = dom;
        });
        return;
      }

      const [id, dom] = args;
      if (!state.nodes[id]) {
        return;
      }

      const nodeId = id as NodeId;

      if (!state.nodes[nodeId]) {
        return;
      }

      state.nodes[nodeId].dom = dom;
    },

    setIndicator(indicator: Indicator | null) {
      if (
        indicator &&
        (!indicator.placement.parent.dom ||
          (indicator.placement.currentNode &&
            !indicator.placement.currentNode.dom))
      )
        return;
      state.indicator = indicator;
    },

    /**
     * Hide a Node
     * @param id
     * @param bool
     */
    setHidden(id: NodeId, bool: boolean) {
      state.nodes[id].data.hidden = bool;
    },

    /**
     * Update the props of a Node
     * @param id
     * @param cb
     */
    setProp(
      selector: NodeSelector<NodeSelectorType.Id>,
      cb: (props: any) => void
    ) {
      const targets = getNodesFromSelector(state.nodes, selector, {
        idOnly: true,
        existOnly: true,
      });

      targets.forEach(({ node }) => cb(state.nodes[node.id].data.props));
    },

    selectNode(nodeIdSelector?: NodeSelector<NodeSelectorType.Id>) {
      if (nodeIdSelector) {
        const targets = getNodesFromSelector(state.nodes, nodeIdSelector, {
          idOnly: true,
          existOnly: true,
        });

        this.setNodeEvent(
          'selected',
          targets.map(({ node }) => node.id)
        );
      } else {
        this.setNodeEvent('selected', null);
      }

      this.setNodeEvent('hovered', null);
    },
  };
};

export const ActionMethods = (
  state: EditorState,
  query: QueryCallbacksFor<typeof QueryMethods>
) => {
  return {
    ...Methods(state, query),
    /** Update the persisted editing lock without changing other custom data. */
    setEditorLock(
      selector: NodeSelector<NodeSelectorType.Id>,
      lock: EditorLock
    ) {
      invariant(['', 'position', 'all'].includes(lock), 'Invalid editor lock');
      this.setCustom(selector, (custom) => {
        if (lock) custom.editorLock = lock;
        else delete custom.editorLock;
      });
    },
    /** One synchronous recipe, one permission decision, one history entry. */
    transact(
      context: EditTransactionContext,
      cb: (actions: Delete<CallbacksFor<typeof Methods>, 'history'>) => void
    ) {
      const result = cb(Methods(state, query)) as unknown;
      invariant(
        !result || typeof (result as any).then !== 'function',
        'Edit transactions must be synchronous'
      );
    },
    // Note: Beware: advanced method! You most likely don't need to use this
    // TODO: fix parameter types and cleanup the method
    setState(
      cb: (
        state: EditorState,
        actions: Delete<CallbacksFor<typeof Methods>, 'history'>
      ) => void
    ) {
      const { history, ...actions } = this;

      // We pass the other actions as the second parameter, so that devs could still make use of the predefined actions
      cb(state, actions);
    },
  };
};
