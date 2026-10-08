## Context

动机和范围见 `proposal.md`。仓库中已有 `.github/workflows/release.yml` 文件，定义了验证、打包和 OIDC 发布 job；但 GitHub Actions 尚未启用，所以当前发布仍完全由人工执行命令，工作流不会运行。该文件也尚未定义创建 tag 或 GitHub Release 的阶段。

## Goals / Non-Goals

**Goals:**

- 保持验证和 npm 发布为独立 job，并在发布后增加可单独重跑的 GitHub 记录创建 job。
- 支持手动 stage-only 流程，用未发布版本验证 OIDC 发布身份，而不产生正式版本或 GitHub 发布记录。
- 将所有发布记录绑定到触发提交，并确保部分失败后重复执行是安全的。
- 将权限限制在确实需要它们的 job。

**Non-Goals:**

- 为 npm 中已经存在的版本补建 tag 或 GitHub Release。
- 将 staged test package 自动批准或自动转成正式版本。
- 改变版本选择、包内容、根目录 Changesets 流程或人工维护的验证记录。

## Decisions

1. **GitHub 记录 job 依赖成功的发布 job。** 验证 job 继续输出已验证版本及是否需要发布。版本已存在时 npm 发布 job 会跳过；记录 job 仅在发布 job 成功后运行，避免把后续 run 中 registry 已有的版本误认为本次 run 已成功发布。

2. **以原 run 的提交 SHA 和版本作为来源。** workflow run 固定对应触发它的提交；记录 job 使用该 SHA 和验证阶段输出的版本。恢复时重跑同一 run，不通过后续提交重新 dispatch。

3. **先创建 Git tag，再创建 GitHub Release，并核对已有记录。** 记录 job 检查 `v<version>` 是否存在。若 tag 指向触发 SHA，则复用；若指向其他 SHA，则失败。随后检查该 tag 的 Release：不存在时用 GitHub 自动生成说明创建；已存在但目标不匹配时失败。任何记录都不强制覆盖。

4. **按 job 授予凭据。** 只给 GitHub 记录 job `contents: write`。npm 发布 job 保留现有 registry 配置，并单独获得 `id-token: write`。不新增 PAT 或依赖。

5. **收窄 push 路径过滤器。** 保留 `workflow_dispatch`，自动 push 触发只匹配 `main` 上的 `scripts/logic-package.json`；job 级别的仓库和分支限制继续保护两类事件。

6. **将 staging 限定为手动 dispatch 模式。** 正式 push 和默认手动模式继续直接发布。只有显式选择 stage-only 并提供未发布版本时，版本预检、构建、消费者验证和打包才使用该版本；同一已验证 tarball 通过 `npm stage publish` 上传。stage 成功不触发 tag/Release job，发布人检查 Trusted Publisher 状态后手动拒绝 staged package，不批准它。

## Risks / Trade-offs

- [Tag 推送成功但 Release 创建失败] → 重跑时核对 tag 仍指向原提交，只创建缺失的 Release。
- [已有 tag 或 Release 与本次目标冲突] → 不强制更新任何记录，失败并要求人工调查。
- [npm 已接收包但发布命令返回失败] → 只有原 run 中发布 job 明确成功才创建记录；否则人工核对原 run 和 registry 状态。

## Migration Plan

1. 由发布人先在 `hnldlsjzt/craft.js` 的 Actions 页面启用 fork 中的工作流，并在 npm 配置匹配的 Trusted Publisher。
2. 修改 `.github/workflows/release.yml`：收窄触发条件、按 job 设置权限，并增加发布后的记录创建 job。
3. 更新 `docs/release.md`，说明首次配置、正常发布检查、重复版本行为及同一 run 的恢复步骤。
4. 校验工作流和文档变更，通过代码评审后合入 `hnldlsjzt/craft.js:main`，再进行首次自动发布。

回滚时恢复工作流和文档变更。已发布的 npm 版本、tag 和 Release 属于已产生的发布记录，需单独人工处理。
