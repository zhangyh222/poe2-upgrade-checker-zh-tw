# 草稿试算与采用证据（P1 第二批）

2026-11-03，基线 a5a2815，分支 `agent/build-service-20261103`，提交 bbc2269。仍使用 PoB v0.23.1。

## 已交付

**`engine.trialDocuments(docs, { signal })`**（`src/pobengine.js`）
- 在一次排队运行里依次装载多份构筑文档，每份按自己的 `weaponSet` 计算并返回整张 sheet。
- **立即恢复**被编辑的构筑（文档、覆盖装备、武器组），恢复后再次校验组别；恢复失败以 `TRIAL_RESTORE_FAILED` 明确报错并停引擎，不返回假成功。
- 为什么不是"下次用再重载"：没有 `<ItemSet>` 段的构筑会沿用引擎里已有的物品集，`weaponset` 改的是这个构筑本身——惰性恢复会把试算用的组泄漏到用户正在看的页面上。真机验证正是先在这个假设上失败，才改成立即恢复。
- `version()` 暴露就绪握手里的 PoB 版本，用于证据指纹。

**`createBuildDrafts({ repository, engine })`**（`src/core/build-drafts.js`）
- `start(characterId)`：从当前文档开草稿。
- `trial(draftId)`：只出证据，不落盘；可反复试。
- `adopt(draftId, draftRevision, currentRevision)`：把试算作为校验回调交给 repository，由它在锁内复核两个 revision 后才持久化。
- `engineDocument(characterId)`：采用后交给引擎的文档。

**判定口径**（刻意收窄）
- 两份文档都装载成功且都有数字 → `pass`；
- 引擎失败、超时、取消、缺 sheet → `unverified`（取消抛 `AbortError`，不转成证据）；
- 两侧 PoB 都没建模出伤害或防御 → `unverified`（缺数据，不是失败）；
- 基准有伤害、草稿伤害为 0 → `fail`（可复现的损失）。

## 验证

- `node --test test/*.test.js`：**127 项通过**（原 120 + 新增 7）。
- `node tools/pob-drafts.js`：真实引擎通过——`set1 -50 / set2 -20 / restored -50`，且恢复后 `weaponSet()` 仍为 0（跟随构筑）。
- `node tools/pob-regression.js`、`node tools/pob-transactions.js`：原有真机回归均通过。

## 尚未完成

- 没有 IPC、没有 Store 接入、没有界面：玩家还不能开草稿、看证据或点采用。
- 采用后如何写入 `pob/<profile>.xml` 与 `pobSync()` 仍是未接的最后一公里；当前 `engineDocument()` 只提供数据。
- 证据只比较伤害/防御等有限指标，不是逐字段差异；不做"关键变化/全部变化"分级。
- 原生逐技能双武器组仍未支持——试算是"同一份构筑换组算"，不是"每个技能各按自己的组算"。
