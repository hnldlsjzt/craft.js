## Why

Craft.js 在加载或解析由其他版本、其他物料库或已移除组件生成的序列化文档时，只要 resolver 中找不到对应组件就会直接抛错，导致编辑器无法打开整份文档，即使其余节点仍然有效。需要提供受控的兼容模式，让文档可以先被打开、保留未知物料的数据，并在组件重新注册后恢复正常渲染，同时不改变现有默认的严格行为。

## What Changes

- 为 Editor 增加可选的 `allowMissingComponents` 配置，默认关闭。
- 在兼容模式下，`Frame`、`actions.deserialize`、事务/历史反序列化及 `query.parseSerializedNode` 遇到未注册的序列化物料时，使用稳定的空占位组件而不是让整个加载流程崩溃。
- 缺失物料的原始名称、props、custom 数据、子节点和 linked nodes 必须继续参与查询、撤销/重做和再次序列化；缺失容器的后代保持在文档中但不渲染。
- 已知组件、HTML 节点和格式错误的节点数据继续按现有规则处理；关闭兼容模式时保持原有报错行为。
- 补充 API 文档、单元测试和缺失物料恢复/序列化场景的验证。

## Capabilities

### New Capabilities

- `missing-material-component-tolerance`: 受控处理未注册或不可用物料组件，保留文档数据并允许后续恢复。

### Modified Capabilities

<!-- 当前 openspec/specs 下没有已存在能力；本变更以新能力规范定义行为。 -->

## Impact

- 影响 `packages/core` 的 Editor options、store/query 反序列化、组件解析与序列化路径。
- 新增公开的 `Editor` 配置项，不新增运行时依赖；默认值保持向后兼容。
- 更新 `site/docs/api/Editor.md` 与核心测试。
- 该行为随 `@deepctrls/craftjs` fork 的正常构建和发布流程交付；不改变根目录 Changesets 的上游多包发布流程。
