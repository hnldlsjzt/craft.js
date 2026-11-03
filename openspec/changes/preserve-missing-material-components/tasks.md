## 1. 解析选项与占位组件

- [x] 1.1 在 Editor options 和初始 store 状态中加入默认关闭的 `allowMissingComponents`，并验证 TypeScript 类型与现有调用方保持兼容
- [x] 1.2 实现按 resolver/name 缓存的缺失物料占位组件及反向名称识别，验证同一 resolver/name 得到稳定引用且不写入 resolver

## 2. 反序列化与序列化链路

- [x] 2.1 将兼容选项贯穿 Frame、actions.deserialize、事务/history 和 `query.parseSerializedNode`，验证所有入口对缺失物料使用一致行为
- [x] 2.2 更新反序列化逻辑：兼容模式保留缺失物料 opaque props、子节点和 linked nodes，同时继续拒绝非法 type/props；运行缺失物料单元测试覆盖默认严格模式和错误边界
- [x] 2.3 更新序列化逻辑以恢复占位物料的原始 resolved name 和 props，验证 null、数组、业务对象及嵌套 children 往返等价

## 3. 回归验证与文档

- [x] 3.1 补充/调整核心测试，覆盖已知兄弟节点渲染、缺失容器隐藏后代、历史操作、真实组件重新注册后重新加载，以及 resolver 不被污染；运行 `yarn jest packages/core/src/editor/tests/missingComponents.test.tsx packages/core/src/editor/tests/query.test.tsx --runInBand`
- [x] 3.2 更新 `site/docs/api/Editor.md`，说明开关、默认严格行为、占位渲染和恢复方式；检查文档示例与公开 `Editor` 类型一致
- [x] 3.3 运行 `yarn lint`、`yarn build` 及相关核心测试，记录与本变更无关的基线失败，不把未完成的浏览器/发布验收标记为已通过

## 验证记录

- [x] 补充生产环境可见的缺失物料 console warning，按 resolver/name 去重；新增告警与非告警场景测试，全量 23 个套件、309 项测试通过。

- 2026-11-02：全量 Jest 23 个套件、307 项测试通过；core/utils/layers 构建通过；改动文件 ESLint 和 core TypeScript 检查通过。
- 全量 Lint 因现有 CRLF 格式错误失败，用户明确暂不处理。
- 2026-11-03：项目端启用 allowMissingComponents 后，用户确认缺失 EnergyFlowAnalysis 的页面正常加载，符合预期；尚未执行正式发包。
