import { ERROR_DESERIALIZE_COMPONENT_NOT_IN_RESOLVER } from '@craftjs/utils';
import React from 'react';
import invariant from 'tiny-invariant';

import {
  getMissingComponent,
  getMissingComponentName,
} from './missingComponent';
import { resolveComponent } from './resolveComponent';

import {
  NodeData,
  SerializedNode,
  ReducedComp,
  ReduceCompType,
} from '../interfaces';
import { Resolver } from '../interfaces';
import { Canvas } from '../nodes/Canvas';

type DeserialisedType = React.JSX.Element & { name: string };

const restoreType = (
  type: ReduceCompType,
  resolver: Resolver,
  allowMissingComponents: boolean
) => {
  if (typeof type === 'string') return type;
  if (!type || typeof type.resolvedName !== 'string' || !type.resolvedName) {
    return null;
  }
  if (type.resolvedName === 'Canvas') return Canvas;

  const component = Object.prototype.hasOwnProperty.call(
    resolver,
    type.resolvedName
  )
    ? resolver[type.resolvedName]
    : undefined;
  return (
    component ||
    (allowMissingComponents
      ? getMissingComponent(resolver, type.resolvedName)
      : null)
  );
};

export const deserializeComp = (
  data: ReducedComp,
  resolver: Resolver,
  index?: number,
  allowMissingComponents = false
): DeserialisedType | undefined => {
  let { type, props } = data;

  const main = restoreType(type, resolver, allowMissingComponents);

  if (!main) {
    return;
  }

  const propKeys = Object.keys(props);
  const missingName = getMissingComponentName(main);
  if (missingName) {
    // A missing material's children/other props may be business data rather
    // than serialized JSX. Keep the payload opaque until the material exists.
    return {
      ...React.createElement(main, props),
      props,
      name: missingName,
    };
  }

  props = propKeys.reduce((result: Record<string, any>, key) => {
    const prop = props[key];
    if (prop === null || prop === undefined) {
      result[key] = null;
    } else if (typeof prop === 'object' && prop.resolvedName) {
      result[key] = deserializeComp(
        prop,
        resolver,
        undefined,
        allowMissingComponents
      );
    } else if (key === 'children' && Array.isArray(prop)) {
      result[key] = prop.map((child) => {
        if (typeof child === 'string') {
          return child;
        }
        return deserializeComp(
          child,
          resolver,
          undefined,
          allowMissingComponents
        );
      });
    } else {
      result[key] = prop;
    }
    return result;
  }, {});

  if (index) {
    props.key = index;
  }

  const jsx = {
    ...React.createElement(main, {
      ...props,
    }),
  };

  return {
    ...jsx,
    name: resolveComponent(resolver, jsx.type),
  };
};

export const deserializeNode = (
  data: SerializedNode,
  resolver: Resolver,
  allowMissingComponents = false
): Omit<NodeData, 'event'> => {
  const { type: Comp, ...nodeData } = data;

  const isCompAnHtmlElement = typeof Comp === 'string' && !!Comp;
  const isCompAUserComponent =
    Comp &&
    typeof Comp === 'object' &&
    typeof Comp.resolvedName === 'string' &&
    !!Comp.resolvedName;

  const errorMessage = ERROR_DESERIALIZE_COMPONENT_NOT_IN_RESOLVER.replace(
    '%displayName%',
    data.displayName
  ).replace('%availableComponents%', Object.keys(resolver).join(', '));

  invariant(isCompAnHtmlElement || isCompAUserComponent, errorMessage);

  const deserialized = deserializeComp(
    data,
    resolver,
    undefined,
    allowMissingComponents
  );
  invariant(deserialized, errorMessage);
  const { type, name, props } = deserialized;

  const { parent, custom, displayName, isCanvas, nodes, hidden } = nodeData;

  const linkedNodes = nodeData.linkedNodes || nodeData._childCanvas;

  return {
    type,
    name,
    displayName: displayName || name,
    props,
    custom: custom || {},
    isCanvas: !!isCanvas,
    hidden: !!hidden,
    parent,
    linkedNodes: linkedNodes || {},
    nodes: nodes || [],
  };
};
