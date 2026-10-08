## Why

目前 `@deepctrls/craftjs` 的发布完全依靠人工执行命令；仓库中的 `.github/workflows/release.yml` 尚未启用，因而当前不会自动验证或发布。启用并完善该 workflow 后，以推送到 `hnldlsjzt/craft.js:main` 的版本提交作为发布入口，保留人工选择版本和评审的步骤，并自动完成验证、npm 发包、Git tag 和 GitHub Release 创建及失败恢复。

## What Changes

- 将 `hnldlsjzt/craft.js` 的 `main` 上版本元数据提交作为正式发布入口；发布人仍负责选择版本、更新包 README，并将发布提交推送到目标仓库。
- 保留现有发布验证：版本预检、测试、构建、lint、打包和 React 18/19 独立消费者验证；npm 只发布验证阶段生成的同一个 tarball，并继续使用 OIDC。
- npm 发布成功后，为该 workflow run 的触发提交创建 `v<version>` Git tag，并创建使用 GitHub 自动生成说明的 GitHub Release。版本预检发现 npm 版本已存在时，本次 run 只做验证并跳过 npm 发布、tag 和 Release；不把既有 npm 版本自动关联到当前提交。若 tag 已存在且指向同一提交则视为已完成，指向其他提交则停止并报错；已存在的 Release 也必须与目标 tag 一致，否则停止，不覆盖。
- 让 tag / Release 阶段可单独重跑：该阶段只依赖同一 workflow run 中成功的 npm 发布 job，使用该 run 固定的版本、触发提交 SHA 和发布结果，不从重跑时的新提交或 registry 中的同版本包推断发布来源。阶段重跑时先核对 npm 版本确已存在，再幂等补齐 tag / Release；不能证明来源或发现记录冲突时停止并报错。
- 自动 push 触发只监听 `scripts/logic-package.json` 在 `main` 上的变更，避免仅修改 workflow 文件就触发旧版本发布；保留手动 workflow dispatch 作为维护入口，并限制在目标仓库和 `main`。
- 手动 workflow dispatch 增加 stage-only 验证模式，允许发布人输入一个未占用的稳定测试版本。该模式复用完整验证和 tarball artifact 流程，通过 OIDC 执行 `npm stage publish`，不执行正式 `npm publish`，也不创建 Git tag 或 GitHub Release；待审核的 staged package 不得批准，验证后由发布人拒绝。
- 更新手动发布文档，说明 Actions 启用、npm Trusted Publisher 配置、发布提交步骤、成功检查及失败恢复方式。根目录 Changesets 流程不纳入本次范围。

## 目标发布步骤

1. 首次启用时，在 `hnldlsjzt/craft.js` 的 Actions 页面启用 workflow；确认 npm `@deepctrls/craftjs` 的 Trusted Publisher 指向仓库 `hnldlsjzt/craft.js` 和 `.github/workflows/release.yml`。
2. 将功能与修复通过正常代码评审合入目标仓库的 `main`。
3. 准备发布提交：patch 版运行 `yarn version:logic:patch`；minor/major 版将 `scripts/logic-package.json` 改为新的稳定 `x.y.z` 版本；更新 `scripts/logic-package.README.md` 中的包说明和变更摘要。
4. 提交并 push 版本元数据变更到 `hnldlsjzt/craft.js:main`，由该提交启动发布 workflow。
5. 等待 workflow 完成版本预检、安装、测试、构建、lint、打包和消费者验证。任何验证失败都阻止 npm 发布。
6. 验证通过且版本预检显示尚未发布时，workflow 使用 npm Trusted Publishing 发布同一个已验证 tarball；仅在该发布 job 成功后，才在原触发提交上确保 `v<version>` tag 和 GitHub Release 存在，Release 说明由 GitHub 自动生成。若版本预检显示已存在，则本次只验证并明确跳过发布记录创建，不自动补历史 tag / Release。
7. 确认本次 Actions run 最终成功；只有 run 失败时才查看失败 job 日志。用 `npm view "@deepctrls/craftjs@<version>" version` 确认 registry 版本，并按现有发布记录约定补充 `docs/releases/<version>-validation.md`。
8. 如果 npm 发布 job 成功但 tag / Release 阶段失败，在原 workflow run 中只重跑失败的 tag / Release job；该 job 使用原 run 的成功依赖、版本、tarball 与触发提交 SHA，不重新发布 npm 包，也不读取新提交作为来源。重跑前核对该版本仍可从 npm 查询；同 SHA 的现有 tag / Release 可复用，指向不同提交或互相不匹配时停止并人工调查，不覆盖。若 npm 发布 job 本身失败，即使 registry 查询到该版本，也不能据此触发记录创建，应人工核对后再处理。

## Capabilities

### New Capabilities

- `release-automation`: 为 `@deepctrls/craftjs` 定义从 main 上的人工准备发布提交到 npm 发布、Git tag、GitHub Release 的自动化行为与恢复规则。

### Modified Capabilities

无。仓库当前没有 OpenSpec 主规格；发布自动化会作为新能力建立规格。

## Impact

- 工作流：`.github/workflows/release.yml`；增加创建 tag / Release 所需的最小 `contents: write` 权限，并保持 npm 的 `id-token: write` 只用于发布 job。
- 文档：`docs/release.md`；版本来源、发布 README、发布验证记录仍由发布人维护。
- 仓库外设置：GitHub Actions 需在 fork 上启用；npm Trusted Publisher 必须与 `hnldlsjzt/craft.js`、`release.yml` 和 OIDC 权限匹配。
- 不新增依赖，不改变根目录 Changesets 发布路径或 `@deepctrls/craftjs` 的包结构。
