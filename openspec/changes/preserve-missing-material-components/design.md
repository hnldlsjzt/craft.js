## Context

当前反序列化链路会通过 resolver 将序列化的 `resolvedName` 还原为 React 组件；找不到组件时直接失败。现有工作区修改已经涉及 Editor options、store/query 入口、反序列化、序列化和文档说明。本设计只定义兼容模式的边界，不改变默认严格模式。

## Goals / Non-Goals

**Goals:**

- 在一个显式、默认关闭的 Editor 选项下容纳缺失物料。
- 使用稳定的按 resolver 和名称区分的空占位组件，使 React 节点仍能进入现有 Node 模型。
- 保留未知物料的原始 payload，并让序列化、历史和后续重新加载可恢复。
- 让缺失物料嵌套在 props/children 中时遵循同一开关。

**Non-Goals:**

- 不自动修改 resolver，不联网下载物料，不猜测或替换物料名称。
- 不掩盖非法序列化结构、缺失 props 或其他既有数据校验错误。
- 不改变默认关闭兼容模式时的错误消息和加载语义。

## Decisions

1. **选用显式 opt-in 开关。** `allowMissingComponents` 默认 false，避免静默改变已有调用方的错误检测；替代方案是始终容错，但会让数据损坏更难被发现。
2. **占位组件按 resolver/name 缓存。** 每个缺失名称得到稳定的函数引用，保证 Immer 历史和节点比较不会因每次解析生成新类型；使用反向弱映射在序列化时恢复原始名称。替代方案是把占位对象写入 resolver，会污染公开配置并可能覆盖真实组件。
3. **缺失物料 props 保持 opaque。** 对缺失物料本身不递归解释 `children` 或业务对象，避免把普通业务数据误当成 Craft JSX；已知组件的嵌套序列化 children 仍递归使用同一开关。
4. **在所有现有解析入口传递选项。** Frame/actions、事务和 history 最终复用同一反序列化逻辑；query.parseSerializedNode 直接传入当前 options，避免入口之间出现不同容错行为。
5. **序列化优先识别占位类型。** 占位节点输出原始 `resolvedName` 与 props，不走普通 React children 归一化，确保 null、数组和业务对象等数据不被改写。

## Risks / Trade-offs

- [Risk] 缺失物料在兼容模式下不可见，用户可能误以为数据丢失 → 文档明确说明占位行为，并保留查询/序列化数据供恢复。
- [Risk] 占位组件缓存只按 resolver 引用生效，替换整个 resolver 后会生成新占位类型 → 重新加载时按新 resolver 解析；不把缓存写入文档或全局状态。
- [Risk] 对缺失物料 props 不递归可能暂时无法访问其中嵌套的 Craft 元素 → 这是保护未知业务 payload 完整性的取舍，待真实组件注册后重新加载即可恢复。
- [Risk] 兼容模式可能放宽部分历史数据错误 → 保留节点类型和 props 的严格校验，并为默认模式和非法输入增加回归测试。

## Migration Plan

兼容模式首次为某个 resolver/name 创建占位组件时输出 console.warn，明确组件名称、空渲染和数据保留行为；生产构建同样告警。利用现有占位缓存去重，重复加载不会刷屏，不新增全局名称集合。

调用方无需迁移；需要打开旧文档的调用方显式设置 `allowMissingComponents: true`。默认行为保持不变。发布前运行核心测试、lint/build；若发现兼容模式引入回归，可将选项保持默认关闭并回滚相关实现，不涉及数据格式迁移。
