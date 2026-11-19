import { ROOT_NODE } from '@craftjs/utils';

import { NodeId, Nodes } from '../interfaces';

/**
 * 历史文档里节点自报的 `parent`，可能和真正把它列进 `nodes`/`linkedNodes` 的节点对不上。
 * 渲染以父节点的列表为准，所以这里把 `parent` 对齐到真正列出它的那个节点。
 * 被多个节点同时列出的无法判断真父，和没被任何节点列出的游离节点一样保持原样。
 */
export function repairParentReferences(nodes: Nodes): NodeId[] {
  const owners = new Map<NodeId, NodeId | null>();
  for (const id of Object.keys(nodes)) {
    const { nodes: childNodes, linkedNodes } = nodes[id].data;
    for (const childId of [
      ...(Array.isArray(childNodes) ? childNodes : []),
      ...Object.values(linkedNodes || {}),
    ]) {
      owners.set(childId, owners.has(childId) ? null : id);
    }
  }

  const repaired: NodeId[] = [];
  owners.forEach((ownerId, childId) => {
    const child = nodes[childId];
    if (
      !ownerId ||
      !child ||
      childId === ROOT_NODE ||
      childId === ownerId ||
      child.data.parent === ownerId
    ) {
      return;
    }
    child.data.parent = ownerId;
    repaired.push(childId);
  });
  return repaired;
}
