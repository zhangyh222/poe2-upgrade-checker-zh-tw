# PoB 引擎升级：v0.23.1 → 原生逐技能武器组

2026-11-03，分支 `agent/build-service-20261103`。

## 版本选择

- 上游最新的 0.x 正式 tag 仍是 **v0.23.1**（`git ls-remote --tags` 核对过），原生逐技能 `set1`/`set2` **没有发布版**。
- 因此固定到团队此前审过的 dev 提交 **`bb52d6b368307457eb9c54bb13f1829993d390b1`**（2026-10-01），在 `tools/get-pob.js` 里作为 `POB_TAG` 默认值，可用 `POB_REF=...` 覆盖。
- 抓取方式改为 `git init` + `sparse-checkout` + `fetch --depth 1 <ref>` + `checkout FETCH_HEAD`：tag 和 commit 都能取，按 commit 取才是"我们测过的那个版本"，不会跟着分支漂。
- 已核对下载结果：`vendor/pob/.pob-version` = bb52d6b，`SkillsTab.lua` 有 `set1/set2`，`CalcSetup.lua:1074` 起有 `GetSocketGroupWeaponSet`。

## 代码改动

- `pob/server.lua`：`sheet()` 的每个技能组增加 `set1`/`set2`（**引擎没有这两个字段时保持 nil**，旧引擎行为不变）。
- `src/pobengine.js`：`version()` 变成 `0.23.1+bb52d6b`——dev 分支里 PoB 自己的版本号还写着 0.23.x，证据指纹必须带上固定提交。
- `src/main.js`：主技能对齐只在"恰好属于一组"时发生；`set1 && set2`（两组都用）不再把整页拉到某一组。切组也不再把手动标记写回 `skillWeaponSets`（构筑自己管）。
- `src/ui/character.js`：有原生字段时显示"武器组 1／2"标签，**不再显示手动下拉**；没有原生字段的旧构筑仍用下拉。

## 验证（全部实跑）

| 项目 | 结果 |
|---|---|
| `tools/pob-smoke.js` | 通过（引擎 0.23.1 分支构建，冷抗 -50 → -20） |
| `pob-regression.js` | 通过（基线、换组、缓存、零 DPS） |
| `pob-transactions.js` | 通过（独占租约、部分失败恢复、取消恢复、旧排队任务拒绝） |
| `pob-drafts.js` | 通过，版本显示 `0.23.1+bb52d6b` |
| `node --test test/*.test.js` | 128 项通过 |
| 真实构筑导入（`tesdbd.txt.txt`，游侠 Deadeye 100 级） | 22 件物品、149 天赋点；技能组读取到原生组别 |

真实构筑上的技能组别（界面实测）：

```text
主旋風          武器组 1  武器组 2
主長矛投擲      武器组 1
主長矛投擲      武器组 2      ← 同一个技能两组各一份
精閃電淨化      武器组 2
主冰鏃箭矢      武器组 1  武器组 2
…
手动下拉剩余：0    原生标签：31
```

## 回滚

代码对两个版本都兼容（旧引擎没有 `set1/set2` 时自动退回原逻辑）。要退回引擎：

```powershell
$env:POB_REF='v0.23.1'; node tools/get-pob.js --force
```

`vendor/pob-v0231-backup/` 是升级前的完整副本（含 runtime），需要立刻回滚时可直接改回 `.pob-version` 并替换目录。

## 已知限制

- 固定的是 **dev 提交**，不是发布版：后续升级要重新跑上表全部回归，不能只看 smoke。
- PoB 版本字符串仍是 0.23.1，版本判断请用 `.pob-version`（引擎指纹已带上短提交）。
- `skillWeaponSets`（应用自己的手动设置）**保留但不再生效**（原生字段优先）；旧数据迁移到 XML 还没做，因此旧构筑里手动标过的组不会自动写进构筑文件。
- `weaponprobe` 死分派仍在（`server.lua` 分派了但函数不存在），未清理。
- 逐技能双组目前只是"读得到、显示对"；**让用户修改某个技能的组别并写回 XML** 还没做。
