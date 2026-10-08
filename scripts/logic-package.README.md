# @deepctrls/craftjs

A maintained fork of [Craft.js](https://github.com/prevwong/craft.js), based on
`@craftjs/core@0.2.12`. This package contains the core React page editor framework.
It retains the upstream MIT license. The release includes its matching utilities
internally so core and transaction validation always use the same implementation.

## Install

```sh
npm install @deepctrls/craftjs
```

```tsx
import { Editor, Frame, Element, useEditor, useNode } from '@deepctrls/craftjs';
```

React 16.8, 17, 18, and 19 are supported by the upstream peer dependency range.

## Migrate an existing Craft.js project

To preserve existing imports and share the same core instance with integrations
such as `@craftjs/layers`, install this fork under the original package name:

```sh
npm install @craftjs/core@npm:@deepctrls/craftjs@0.2.14
```

Continue importing from `@craftjs/core` in that project. Choose either direct
installation or the alias; do not install both core packages in one application,
because their React contexts would be separate.

## Changes in 0.2.14

- Opt-in editing access for persisted layer locks and temporary subtree isolation.
- Atomic synchronous transactions, checked after normalization and before state,
  history, or subscriber updates. Rejected batches leave no partial writes.
- Live canvas selection/drag/drop checks, including locks changed during a drag.
- Explicit document-load and application-authorized runtime update contexts.
- Local utility runtime and declarations are included in the release tarball.
- Port all three Designer `@craftjs/core@0.2.12` patch changes to maintained source:
  microtask DOM batching, batch `setDOM`, and serialization-free notifications.

## Designer patch compatibility

Connector DOM registrations are collected per editor store and flushed in one
`queueMicrotask`. For duplicate node IDs, the last DOM wins. Missing/deleted nodes
are skipped. Internal `store.actions.setDOM(id, dom)` remains synchronous and
also accepts `store.actions.setDOM([[id, dom], ...])`. Neither form adds history.
Code reading a newly connected node's DOM must allow the microtask to flush.

`onNodesChange` now follows the Designer patch: each store notification invokes
the current configured callback, including DOM, selection and option updates.
The framework does **not** serialize the tree or compare document contents first.
Rejected edits do not notify. This differs from upstream and fork 0.2.13, where
the serialized document was compared when a callback was present. Callers that
need persistence-only notifications must decide when to save; avoid unconditional
store writes inside this callback, which can recursively notify again.

Dynamic callback changes through `setOptions`, unmount cleanup and StrictMode
cleanup from the fork are retained. These patch changes apply independently of
the optional editing-access feature below.

## Editing access

The feature is disabled by default. Existing documents and programmatic actions
retain their previous behavior until `editAccess` is enabled:

```tsx
<Editor
  editAccess={{ documentRevision: 'page-42' }}
  onEditDenied={({ reason, nodeId }) => showEditMessage(reason, nodeId)}
>
  <Frame>{/* your document */}</Frame>
</Editor>
```

`editAccess` accepts `true`, `false`, or an `EditAccessPolicy`. It can be changed
through the Editor prop or `actions.setOptions`. `enabled: false` also rejects
user edits and history replay when this policy is enabled.

### Locks and temporary isolation

```ts
actions.setEditorLock(nodeId, 'position');
actions.setEditorLock(nodeId, 'all');
actions.setEditorLock(nodeId, ''); // unlock

actions.setOptions((options) => {
  options.editAccess = { scope: [containerId], documentRevision: 'page-42' };
});
```

Locks are stored as `node.data.custom.editorLock` and survive serialization.
`position` allows content and ordinary appearance edits, but prevents geometry
and structure edits. `all` additionally prevents props, other custom metadata,
and canvas selection. Ancestor locks apply to descendants, including linked nodes.
A node can change its own lock; a locked ancestor must be unlocked first.
The root cannot be locked.

`scope` is session configuration, not document data. Omit it to allow the full
document; `[]` disables editing everywhere; entries include their subtrees.
Layer panels can still inspect/select locked or out-of-scope nodes with
`actions.selectNode`. Query access before enabling their edit controls:

```ts
const access = query.node(nodeId).getEditAccess({ operation: 'geometry' });
// { allowed, reason?, lockOwnerId? }
query.node(nodeId).getEditAccess({ operation: 'select', selectionSource: 'layer' });
```

Operations are `select`, `props`, `geometry`, `structure`, and `lock`.
Geometry/structure checks conservatively protect locked descendants too. Thus
changing a container's child order or inserting into it is rejected if it contains
a locked descendant, including the root. Unlock the affected subtree before such
structural edits. This protects flow-layout positions as well as absolute layouts.

### Geometry and pipes

The default classifier covers top-level `props.style` positioning, sizes,
transforms, spacing, flex/grid layout and related geometry. It inspects actual
changed leaves: replacing a style object just to change color is allowed under
a position lock. Component-specific fields need a classifier:

```ts
import { isDefaultGeometryProp } from '@craftjs/core';

const editAccess = {
  isGeometryProp: (path, node) =>
    ['points', 'startPoint', 'endPoint', 'rotation'].includes(String(path[0])) ||
    isDefaultGeometryProp(path, node),
};
```

Adapt these field names to your pipe schema. This framework provides the editing
contract; pipe handle geometry, snapping, endpoint binding and panels remain
application responsibilities. Custom drag tools should query access before
showing handles, then write through the guarded actions.

`getLock(node)` can read a custom lock format. `setEditorLock` always writes the
default `custom.editorLock` field; use `setCustom` if your storage format differs.
All policy callbacks must be synchronous and free of side effects.

### Transactions, history and delayed updates

```ts
actions.transact({ documentRevision: 'page-42' }, (tx) => {
  tx.setProp(selectedIds, (props) => { props.style.width = 200; });
  tx.setProp(labelId, (props) => { props.text = 'Updated'; });
});
```

One denied change rejects the entire transaction. It produces one history entry
when accepted. The callback receives ordinary actions; nested transactions,
history methods and `setState` are not exposed on `tx`. Use `tx.setCustom` for
lock changes inside a transaction. The API returns `void`; rejection is reported
through `onEditDenied`. Do not dispatch further actions from a denial callback.

Callbacks and recipes must finish synchronously. Capture the application's
document revision for delayed dialogs and compare it by supplying it in the
transaction context. Transactions with a stale revision are rejected; the
framework does not generate or increment revisions for the application.

`history.ignore()`, `merge()` and `throttle()` do not bypass editing access.
Undo/redo replay previously accepted entries in full, even if the current locks
or isolation scope differ. Page-level `enabled: false` still blocks replay.

### Loading and live data

```ts
actions.history.ignore().transact({ source: 'document-load' }, (tx) => {
  tx.deserialize(savedDocument);
});
actions.history.clear(); // clear the old document's undo stack when switching pages
```

Frame and Element initialization use document-load internally. Direct
`actions.deserialize` remains a user edit when access is enabled. Document-load
is a trusted host capability that bypasses editing locks; it must only receive
validated application documents. This is an editor consistency feature, not a
security boundary against JavaScript with access to the store.

`source: 'derived-binding'` and `source: 'runtime-data'` are denied by default.
Use `canApplySystemChange({ context, previousState, nextState, patches })` to
authorize only the actual fields your application needs to update. For example:

```ts
const editAccess = {
  canApplySystemChange: ({ context, patches }) =>
    context.source === 'runtime-data' && patches.every(({ path }) =>
      path.length === 5 && path[0] === 'nodes' && path[2] === 'data' &&
      path[3] === 'props' && path[4] === 'liveValue'
    ),
};
actions.history.ignore().transact({ source: 'runtime-data' }, (tx) => {
  tx.setProp(sensorId, (props) => { props.liveValue = latestValue; });
});
```

Scope this authorization further by node/type as appropriate. This allows live
values or authorized endpoint-following updates without allowing manual edits
to locked geometry. Viewer data held outside the Craft document is unaffected.
`source: 'lock-control'` limits a transaction to the default lock field only.

## Changes in 0.2.13

- Avoid full-tree serialization when no node-change callback is configured.
- Support callbacks added or replaced at runtime with `actions.setOptions`.
- Unsubscribe on unmount and during React StrictMode effect cleanup.

## Development and publishing

### Automatic publishing with GitHub OIDC

`.github/workflows/release.yml` publishes only `@deepctrls/craftjs`. Bump the
stable version in `scripts/logic-package.json` and push to `main`, or run the
workflow manually from the Actions page. Existing npm versions are verified but
never republished. Registry failures stop the workflow rather than being treated
as a missing version.

The verification job runs the release checks, complete Jest suite, builds, lint,
and independent React 18/19 tarball checks. The publish job downloads that exact
artifact and uses `id-token: write` with npm 11.20.0 to publish with provenance.
No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is required. The GitHub-hosted runner
and workflow identity must match the package's Trusted Publisher configuration:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Owner | `hnldlsjzt` |
| Repository | `craft.js` |
| Workflow filename | `release.yml` |
| Environment | Leave empty |

A package maintainer can establish this one-time trust from an interactive
terminal (npm may require 2FA for changing account/package settings):

```sh
npx --yes --registry=https://registry.npmjs.org/ npm@11.20.0 trust github @deepctrls/craftjs --repo=hnldlsjzt/craft.js --file=release.yml --allow-publish --yes --registry=https://registry.npmjs.org/
```

See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers).

### Local build and manual publishing

The monorepo keeps the upstream workspace names so examples and internal
dependencies continue to resolve. The release process builds the utilities and
core, then stages the renamed core package with CommonJS, ES modules, and
TypeScript declarations in `release/logic-craftjs`.

For release preparation, automated publishing and failure recovery, follow the [automated release guide](https://github.com/hnldlsjzt/craft.js/blob/main/docs/release.md).
Release metadata and the fork version are maintained in
`scripts/logic-package.json`.

## Documentation and license

- [Craft.js documentation](https://craft.js.org/docs/overview)
- [Fork source and issues](https://github.com/hnldlsjzt/craft.js)
- MIT, original copyright retained in `LICENSE`.
