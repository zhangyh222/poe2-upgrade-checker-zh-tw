# 换装必须满足的条件（三层模型）

2026-11-03。数据模型与存储接口已就绪；**还没有界面**。

## 三层

| 层 | 作用范围 | 示例 | 能否被临时层放宽 |
|---|---|---|---|
| `global` | 角色 | 冰抗 ≥ 75、生命不降 | 不能 |
| `slot` | 角色 + 部位（武器还要带武器组） | 鞋子移速不降、武器组 2 主技能 DPS 不降 | 不能 |
| `search` | 本次查询 | "这次允许牺牲生命换伤害" | 只能加严，不能放宽 |

`mergeGuards({ global, slot, search, slotName })` 把三层合成一张有效清单：

- 部位条件只在比较该部位时参与（`slotName` 不匹配就忽略）；
- 同一条指标在两个继承层里出现时取**更严**的那条；
- 临时层如果更松、换比较方向、或者试图推翻一条 `keep`，会进 `conflicts`，**不静默生效**——这正是"不能悄悄降低标准"的落点；
- 临时层更严时直接取代。

## 判定

`evaluateGuards(guards, before, after, { weaponSet })` 逐条给出 `pass | fail | unverified`：

- `keep`：`after >= before` 才是 pass，`before` 缺失则 unverified；
- `min` / `max`：与阈值比较；
- PoB 没有报这个数值 → **unverified**，绝不当作通过；
- 条件属于武器组 2、而当前比较的是组 1 → unverified 并说明原因。

`overall(results)`：有 fail 就是 fail；没有 fail 但有 unverified 就是 unverified；全部通过才 pass。

## 存储与接口

- `store.settings.guards = { [角色ID]: { global: [...], slots: { 部位: [...] } } }`，随角色切换加载。
- `guards:get(slotName)` → `{ global, slot, merged }`
- `guards:set('global'|'slot', slotName, conditions)` → 校验并保存（临时层不进存储）。
- 指标：`life / energyShield / ehp / dps / fireRes / coldRes / lightningRes / chaosRes / armour / evasion / spirit / str / dex / int / movementSpeed`。

## 尚未完成

- 装备面板上的勾选与保存入口（现在只有接口）。
- 把市集候选逐件跑 PoB 试算并填 `before/after`（`eval` 已有，缺串联）。
- 条件与词缀 Tier 面板的联动（"保留这条词缀"→ 生成条件）。
