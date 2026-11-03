## Purpose

让包含已移除、未注册或暂时不可用物料的 Craft.js 文档仍能打开和编辑，同时保留原始数据以便组件恢复后继续使用。

## ADDED Requirements

### Requirement: 缺失物料必须可受控加载

当 Editor 的 \\`allowMissingComponents\\` 设置为 true 时，系统 MUST 将序列化文档中 resolver 无法解析的物料节点加载为不产生可见内容的占位节点，而不是因该物料缺失使整个文档加载失败。

#### Scenario: 缺失物料与已知节点同时加载
- **WHEN** 文档包含一个 resolver 未注册的物料节点和一个已注册节点，并以兼容模式加载
- **THEN** 已注册节点继续渲染，缺失物料不渲染可见内容，加载过程不抛出缺失物料错误

#### Scenario: 缺失容器的后代节点
- **WHEN** 缺失物料是容器并拥有子节点或 linked nodes
- **THEN** 缺失物料及其后代不产生可见渲染，但这些节点仍保留在编辑器文档模型中

### Requirement: 缺失物料数据必须可往返保留

兼容模式 MUST 保留缺失物料的原始 resolved name、props（包括 null 值、数组和业务对象）、custom 数据、子节点与 linked-node 引用，并在再次序列化时输出等价数据。

#### Scenario: 加载后再次序列化
- **WHEN** 兼容模式加载含缺失物料的序列化文档并立即序列化
- **THEN** 缺失物料名称和上述数据与输入保持等价，且 resolver 不因加载过程被添加占位条目

#### Scenario: 历史操作包装下加载
- **WHEN** 通过事务、history ignore、merge 或 throttle 包装反序列化
- **THEN** 缺失物料仍按同一兼容规则加载并可按对应历史语义撤销或保留

### Requirement: 兼容模式必须覆盖节点解析入口

兼容模式 MUST 同时作用于 Frame 文档加载、actions.deserialize、事务反序列化和 query.parseSerializedNode；缺失物料嵌套在已知组件 JSX children 中时也 MUST 使用相同规则。

#### Scenario: 直接解析缺失节点
- **WHEN** 调用 query.parseSerializedNode 解析 resolver 不存在的节点
- **THEN** 兼容模式返回可进入 Node 模型的占位节点，并保留其序列化数据

#### Scenario: 已知组件 children 中嵌套缺失物料
- **WHEN** 已知组件的 children 序列化值包含缺失物料
- **THEN** 已知组件仍可解析，缺失 child 不导致父节点解析失败，并可再次序列化

### Requirement: 默认严格行为和错误边界必须保持

`allowMissingComponents` 未设置或为 false 时，系统 MUST 保持当前缺失 resolver 组件的报错行为；无论开关取值如何，格式非法的节点类型或缺失/null props MUST 继续报错。

#### Scenario: 默认模式遇到缺失物料
- **WHEN** 未启用兼容模式并加载 resolver 不存在的物料
- **THEN** 反序列化抛出既有错误，且不产生部分文档状态

#### Scenario: 兼容模式遇到非法节点数据
- **WHEN** 兼容模式解析 null、空对象或 resolvedName 非字符串的节点类型，或 props 缺失/null
- **THEN** 解析仍抛出格式错误，而不是把非法输入伪装成缺失物料

### Requirement: 组件恢复后必须可恢复正常渲染

当真实物料以相同名称重新注册后，系统 MUST 在重新加载该序列化文档时使用真实组件，不得永久绑定到占位组件。

#### Scenario: 重新注册并重新加载
- **WHEN** 初次加载使用占位组件，随后 resolver 注册同名真实组件并重新解析文档
- **THEN** 新解析节点使用真实组件并按真实组件行为渲染
