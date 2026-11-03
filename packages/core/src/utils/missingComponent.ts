import { ComponentType, ElementType } from 'react';

import { Resolver } from '../interfaces';

const componentsByResolver = new WeakMap<
  Resolver,
  Map<string, ComponentType>
>();
const namesByComponent = new WeakMap<ComponentType, string>();

export const getMissingComponent = (
  resolver: Resolver,
  name: string
): ComponentType => {
  let components = componentsByResolver.get(resolver);
  if (!components) {
    components = new Map();
    componentsByResolver.set(resolver, components);
  }

  let component = components.get(name);
  if (!component) {
    // Ordinary functions retain identity through Immer history patches. Each
    // missing name needs its own reference so serialization can restore it.
    component = function MissingComponent() {
      return null;
    };
    components.set(name, component);
    namesByComponent.set(component, name);
    // Warn once per resolver/name, including production, without flooding reloads.
    // eslint-disable-next-line no-console
    console.warn(
      `[Craft.js] Component <${name} /> is not registered in the <Editor> resolver. ` +
        'It will render null because allowMissingComponents is enabled; its serialized data is preserved.'
    );
  }
  return component;
};

export const getMissingComponentName = (
  component: ElementType | string
): string | undefined =>
  typeof component === 'string' ? undefined : namesByComponent.get(component);
