# 自动发布 `@deepctrls/craftjs`

## 日常发布：做这三步

### 1. 更新版本

确认待发布内容已合入 `hnldlsjzt/craft.js:main`，在最新 main 的仓库根目录执行：

```powershell
yarn version:logic:patch
```

该命令只将 `scripts/logic-package.json` 的本地 patch 版本加 1，不查询 npm。先确认本地版本与上次正式发布版本一致。例如 `0.2.16 → 0.2.17`。

- minor/major：直接修改该 JSON 的 `version` 为新的稳定 `x.y.z`。
- README：仅在需要说明功能、修复或兼容性变化时更新 `scripts/logic-package.README.md`。
- 不修改 `packages/core/package.json` 或生成目录 `release/logic-craftjs` 的版本。

### 2. 提交并推送 main

提交本次发布涉及的修改（包含版本号变更），然后推送目标仓库 main。可使用 IDE 或 Git 提交；提交后执行：

```powershell
git push <remote> main
```

将 `<remote>` 替换为本地实际指向 `hnldlsjzt/craft.js` 的远程名。先用 `git remote -v` 查看地址：如果 `origin` 指向目标仓库，执行 `git push origin main`；当前工作目录的目标远程名是 `deepctls`，因此这里执行 `git push deepctls main`。远程名可自定义，以仓库地址为准。

**只有目标仓库 main 上的 push 包含 `scripts/logic-package.json` 修改，才自动触发发布流程。** 只修改源码、README 或 workflow 不会触发。

### 3. 查看结果

打开 [GitHub Actions](https://github.com/hnldlsjzt/craft.js/actions)，选择本次 `Publish @deepctrls/craftjs` 运行：

- 新版本：`verify`、`publish`、`github_release` 全部成功，发布完成。
- 版本已存在：只执行验证，跳过发布；需要发布时选择新版本。
- 失败：查看失败 job 日志，按下方“失败处理”操作。

CI 自动完成预检、测试、构建、lint、打包、React 18/19 验证、发布同一个已验证 tarball，以及创建 tag 和 GitHub Release。无需手工记 SHA、执行 `npm publish` 或创建 tag/Release。

## 失败处理

| 失败位置 | 操作 |
| --- | --- |
| `verify` | 修复失败原因后重新运行；预检查询异常不能当作版本不存在。 |
| `publish` | 先核实 npm 是否已接收该版本，再根据日志处理；不要盲目重复发布。 |
| `publish` 成功、`github_release` 失败 | 在**原 run** 点击 `Re-run jobs` → `Re-run failed jobs`，只补建发布记录；不要另开同版本 run。 |
| tag/Release 冲突 | 停止重跑并调查，不强制移动 tag 或覆盖 Release。 |

## 首次配置（只做一次）

当前目标仓库已完成配置和 stage 验证；日常发布跳过本节。

1. 在目标仓库 Actions 页面启用 `Publish @deepctrls/craftjs`。
2. 在 npm → 包 Settings → Trusted publishing 添加 GitHub Actions publisher：

   | 字段 | 值 |
   | --- | --- |
   | Organization or user | `hnldlsjzt` |
   | Repository | `craft.js` |
   | Workflow filename | `release.yml` |
   | Environment name | 留空 |
   | Allowed actions | 允许 `npm publish` |

3. 如果状态为 Pending validation，执行下方 stage 验证，确认状态变为 `Valid`。

## Stage 验证（仅测试配置时执行）

1. Actions → `Publish @deepctrls/craftjs` → `Run workflow`。
2. 分支选 `main`，`release_mode` 选 **`stage`**。
3. `stage_version` 填未正式发布且未被 staged package 占用的稳定版本。
4. 运行后确认 `verify`、`publish` 成功，`github_release` 为 Skipped。
5. npm Trusted publishing 确认 `Valid`；在 Staged packages 中 **Reject** 测试包，不批准发布。

Stage 不修改仓库版本，不正式发包，也不创建 tag/Release。手动运行的默认模式是 `publish`，测试时必须明确选择 `stage`。

## 可选检查与记录

- 推送前检查版本：`node scripts/check-logic-release.cjs`；CI 会重复执行，无需每次本地运行。
- 发布后查询：`npm view "@deepctrls/craftjs@<version>" version --registry=https://registry.npmjs.org/`。
- 发布记录：查看 [GitHub Releases](https://github.com/hnldlsjzt/craft.js/releases) 和 Actions 日志。
- 补充业务或浏览器验收：按需参考 `docs/releases/0.2.14-validation.md` 保存记录。
