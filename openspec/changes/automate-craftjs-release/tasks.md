## 1. 先由发布人启用 Actions 并配置 npm Trusted Publisher

- [x] 1.1 登录 GitHub，打开 `https://github.com/hnldlsjzt/craft.js/actions`。若出现黄色 fork 提示 `Workflows aren't being run on this forked repository`，先确认页面列出的 workflow 文件已审阅，再点击 `I understand my workflows, go ahead and enable them`。此操作会启用 fork 中列出的工作流；确认提示消失，左侧可见 `Publish @deepctrls/craftjs` 且 workflow 已启用。此时不要手动运行发布 workflow。
- [x] 1.2 登录 npm 网站，进入 Packages → `@deepctrls/craftjs` → Settings → Trusted publishing，添加 GitHub Actions publisher；填写 Organization or user=`hnldlsjzt`、Repository=`craft.js`、Workflow filename=`release.yml`。文件名只填 `release.yml`，不要填 `.github/workflows/` 路径；Environment name 留空，因为 workflow 不使用 GitHub Environment。现有配置已过期，删除后重建；npm 要求新配置须在 2 天内首次成功发布才能验证并生效。
- [x] 1.3 在 npm Trusted Publisher 配置的 Allowed actions 中允许直接 `npm publish`，以保留正式发布路径；npm 对新 Trusted Publisher 默认允许 `npm stage publish`，无需单独勾选。保存后确认 publisher 的仓库、workflow 和直接发布权限正确。若已有配置过期或字段错误，按 npm 页面规则删除后重新添加。

## 2. 修改发布工作流

- [x] 2.1 修改 `.github/workflows/release.yml` 的 push 触发器：当前只监听 `main`，但 `paths` 同时包含 `scripts/logic-package.json` 和 `.github/workflows/release.yml`；删除 workflow 文件自身的 path 项，使自动 push 只由 `main` 上的版本元数据变更触发。保留 `workflow_dispatch` 和 job 级 `hnldlsjzt/craft.js:main` 限制；检查 YAML 中的 `branches`、`paths` 和仓库/ref 条件。
- [x] 2.2 保留验证 job 的版本预检、锁文件安装、测试、构建、lint、打包及 React 18/19 独立消费者验证；确保它上传通过验证的 tarball，版本已存在时输出仅验证结果，任一验证失败都会阻断后续发布；检查 job 依赖和产物上传配置。
- [x] 2.3 调整 npm 发布 job：仅在版本预检确认版本不存在且验证成功时运行；从验证 job 下载并发布同一个 tarball，继续使用 npm Trusted Publishing；确认 `id-token: write` 只授予该 job，且已存在版本不会重复发布。
- [x] 2.4 新增 GitHub 记录 job：仅在同一 workflow run 的 npm 发布 job 成功后运行，使用该 run 的版本和触发提交 SHA；再次确认 npm 中存在该版本，不从新 run 或后续提交推断发布来源。
- [x] 2.5 在 GitHub 记录 job 中创建或核对 `v<version>` tag：不存在时创建在触发 SHA 上；已存在且指向相同 SHA 时复用；指向其他 SHA 时失败且不移动 tag。检查匹配和冲突两种情况。
- [x] 2.6 在 GitHub 记录 job 中创建或核对对应 GitHub Release：新建时使用 GitHub 自动生成说明；已存在且与 tag/触发 SHA 匹配时复用；目标冲突时失败且不覆盖。确保 tag 创建后 Release 创建失败时可在原 run 中单独重跑记录 job。
- [x] 2.7 将 `contents: write` 只授予 GitHub 记录 job，将 `id-token: write` 只授予 npm 发布 job；检查其它 job 没有这两项写权限。

## 3. 更新发布操作文档

- [x] 3.1 更新 `docs/release.md`，说明当前 Actions 未启用的起始状态、首次启用与 npm Trusted Publisher 配置入口和字段、日常版本准备、版本预检结果处理、目标仓库提交/推送、workflow 运行与最终结果检查、registry 核验、发布记录归档及失败恢复；说明手动 `workflow_dispatch` 会执行同一发布流程，只在 `main` 上且确有需要时使用。对照 `.github/workflows/release.yml` 检查文档一致性。

## 4. 验证工作流与文档变更

- [x] 4.1 按 CI 使用锁定 Yarn 安装依赖并运行发布预检测试和仓库测试：`node .yarn/releases/yarn-3.6.3.cjs install --immutable --mode=skip-build`、`node --test scripts/check-logic-release.test.cjs`、`node .yarn/releases/yarn-3.6.3.cjs test --runInBand`；记录结果，失败时不得继续发布。
- [x] 4.2 在 `packages/layers` 执行 CI 中的 TypeScript 声明构建和 Rollup 构建，再运行 `npm run lint`；确认命令成功，失败时不得继续发布。
- [x] 4.3 验证 CI 打包、React 消费者与同一 tarball 发布链路。
  - [x] 4.3.1 本地设置 `RELEASE_MODE=stage`、`RELEASE_VERSION=0.2.17`，运行 `scripts/prepare-logic-release.cjs` 并对生成目录执行 `npm pack`；检查 tarball 内包名和版本为 `@deepctrls/craftjs@0.2.17`。结果：成功，生成 `release/deepctrls-craftjs-0.2.17.tgz`。
  - [x] 4.3.2 使用该 tarball 运行 `scripts/verify-logic-package.cjs`，验证 React 18.3.1。本次进程代理改为 `127.0.0.1:7897` 后安装成功；修正验证脚本中已过时的 DOM 注册通知断言，并确认节点数据变更仍触发通知；独立 CJS、ESM、声明、编辑权限和历史验证全部通过。
  - [x] 4.3.3 使用该 tarball 运行 `scripts/verify-logic-package.cjs`，验证 React 19.0.0。独立 CJS、ESM、声明、编辑权限和历史验证全部通过。
  - [x] 4.3.4 在合入后的 CI 中确认 React 18/19 验证通过，并确认上传 artifact 与 stage publish 下载的是同一个已验证 tarball。GitHub run `37735992447`（提交 `e47615c`）整体成功；消费者验证、上传/下载 `craftjs-package`、OIDC 发布步骤均成功，`github_release` 为 skipped。Artifact digest：`sha256:9802fa40db2ea3111f81d02a6ea5dfe7ac740d1d3d663089ccc8c33ba03ac51a`（artifact 摘要，不是 tarball 摘要）。
- [x] 4.4 验证工作流分支、版本门禁、权限和发布记录恢复。
  - [x] 4.4.1 解析 YAML，并静态断言 push 触发范围、仓库/main 限制、publish job 依赖和门禁、stage/publish 命令分支、GitHub Release job 条件，以及 `id-token: write` / `contents: write` 权限范围；通过。
  - [x] 4.4.2 运行 `node --test scripts/check-logic-release.test.cjs`：新版本、已存在版本、registry 错误 fail-closed、无效版本和 stage 版本输入检查共 5 项通过。
  - [x] 4.4.3 演练 stage 版本冲突、验证失败及成功时的工作流结果。
    - [x] 4.4.3.1 Stage 成功：run `37735992447`（#2）中 verify、publish 成功，github_release 跳过。
    - [x] 4.4.3.2 版本已正式发布：run #3 输入 `stage / 0.2.16`，Check release version 提示版本已存在并以 exit code 1 失败；后续验证步骤、publish 和 github_release 均跳过，符合预期。
    - [x] 4.4.3.3 版本被其他 staged package 占用：保留首次上传的 `0.2.17` 后重复运行 stage。Run `37737906644`（#5）中 verify 成功，publish 的 npm stage publish 返回 HTTP 409 / E409 版本冲突并以 exit code 1 失败，github_release 跳过；符合预期。发布人已确认在 npm Staged packages 中 Reject 本次演练保留的 `0.2.17`，清理完成，未正式发布。
    - [x] 4.4.3.4 必需验证失败门禁：测试分支 `test/verify-failure` 的提交 `c9f7e9c` 运行独立演练 workflow，保留正式 workflow 的 downstream needs/if，主动令验证步骤 exit 1。截图确认 verify 为 failure、publish/github_release 为 skipped、assert_failure_gate 为 success；这是 GitHub Actions 故障注入演练，不代表真实 React 消费者出现失败。
  - [x] 4.4.4 使用独立演练 workflow、临时 Git 仓库和模拟 npm/GitHub 接口，复用正式发布记录脚本验证以下场景；不创建目标仓库的真实发布记录。
    - CI 实测：测试分支提交 `e2dbf1f`，run `37741532616`。首次 attempt 中 scenarios、verify、publish 成功，github_release 在模拟 Release 创建处故意失败，并上传恢复状态；在同一 run 选择 `Re-run failed jobs` 后，attempt #2 整体成功，github_release 恢复通过。脚本断言同一 run/SHA、原 tag 对象未变化且仅补建缺失 Release；verify/publish 沿用首次成功结果。该结果为真实 Actions 调度与模拟发布接口演练，不涉及真实 npm publish 或目标仓库发布记录。
    - [x] 4.4.4.1 记录匹配和缺失：已有 tag/Release 与触发 SHA 匹配时复用，只补建缺失记录；重复执行不重复创建。
    - [x] 4.4.4.2 Tag 冲突：已有 tag 指向其他提交时失败，保持原 tag 不变，不创建 Release。
    - [x] 4.4.4.3 Release 冲突：关联 tag 不匹配、存在 draft/prerelease 或 Release 存在而 tag 缺失时失败，不覆盖已有记录。
    - [x] 4.4.4.4 同一 run 恢复：模拟 npm job 成功、tag 创建成功而 Release 创建失败，保存演练状态；在原 Actions run 点击 Re-run failed jobs，确认使用原 SHA/版本并只补建 Release，不重新运行 npm job、不移动已有 tag。
  - [x] 4.4.5 运行 `openspec validate automate-craftjs-release --strict --no-interactive`；通过。相关文件 Prettier 检查、YAML 解析与 `git diff --check` 也通过。
- [x] 4.5 在目标仓库真实验证 npm Trusted Publisher stage 流程。
  - [x] 4.5.1 确认 `hnldlsjzt/craft.js:main` 已包含本次 workflow 和文档。发布人直接推送 `main`；截图确认目标为 `github.com:hnldlsjzt/craft.js.git`，远端从 `c42400a` 更新至 `e47615c`。
  - [x] 4.5.2 确认测试版本未正式发布，也未被其他 staged package 占用。运行前 npm 查询 `0.2.17` 返回 404；随后 stage 上传成功，未出现 staged 版本占用冲突。
  - [x] 4.5.3 在 `release.yml` 手动选择 `stage` 和未占用版本，等待构建、React 18/19 验证及 OIDC `npm stage publish` 全部成功。已完成 run `37735992447`。
  - [x] 4.5.4 确认 Trusted Publisher 验证完成，且没有正式 npm 版本、Git tag 或 GitHub Release。发布人截图确认 Status 为 `Valid`；npm `0.2.17`、Git tag `v0.2.17`、GitHub Release `v0.2.17` 的公开接口均返回 404。
  - [x] 4.5.5 在 npm Staged packages 中核对并拒绝本次 `0.2.17` 测试包。发布人截图确认 `@deepctrls/craftjs@0.2.17 successfully removed`，且待审核列表已为空；未批准或正式发布该测试版本。

## 5. 评审并合入自动化改动

- [x] 5.1 按发布人确认的方式提交并将改动送入 `hnldlsjzt/craft.js:main`。本次发布人选择直接推送，已推送发布自动化提交 `1c195d1` 和命令适配提交 `e47615c`；未走 Pull Request 评审流程。

日常发布操作和失败恢复说明见 [自动发布指南](../../../docs/release.md)，不作为本次自动化改造的待完成任务。
