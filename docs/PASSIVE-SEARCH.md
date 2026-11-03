# 天赋节点搜索（P2 的第一块）

2026-11-03，分支 `agent/build-service-20261103`。只做了引擎与接口，**没有界面**。

## 命令

```lua
{ cmd = "nodes", query = "energy shield", limit = 20 }
→ { ok, query, total, nodes = [{
      id, name, type, ascendancy,
      allocated,          -- 已经点了
      weaponSet,          -- 0 = 两组都用，1 / 2 = 只属于某组（节点自己的 allocMode）
      cost,               -- 从「已点节点」出发还要点几个未点节点才能到；nil = 走不到
      stats }] }
```

排序：已点的在前，然后按 `cost`，再按名字。查询少于两个字符直接拒绝。

## 路径成本怎么算

对天赋图做**0-1 BFS**（已点的边权 0，未点的边权 1），从所有已点节点同时出发。所以：

- 已经点过的节点 `cost = 0`；
- 隔一个未点节点的 `cost = 1`；
- 与当前区域不连通（比如另一个升华、或者需要穿过未开放区域）→ `cost = nil`，不会假装 1 点可达。

这一步只解决"要走几个点"，**不判断合法性**（起点、升华、武器组专属点、必须按顺序的前置等）。按设计文档的口径，这只是"候选路径"，不是可以替玩家做决定的结论。

## 实测（真实构筑 tesdbd，149 点）

```
"energy shield" → 294 个节点，耗时 6 ms
* Immortal Thirst [Notable] set 0 cost 0 — 15% increased maximum Energy Shield
  Evasion and Energy Shield [Normal] set 0 cost 1 — 12% increased Evasion Rating
  Ailment Threshold from Energy Shield [Normal] set 0 cost 2 — …
```

## 尚未完成

- 界面：天赋页高亮与定位（现在只有引擎接口 + `tools/pob-nodes.js`）。
- 意图层：把"加能量护盾"拆成最大护盾／百分比／充能速度／充能延迟四类；现在只是文本包含匹配。
- 武器组过滤：`weaponSet` 字段有了，但还没按当前组筛。
- 合法性验证与"选中路径"的交互；把方案放进草稿试算。
- 跨升华、cluster jewel 插槽节点的路径语义需要单独核对（当前用节点的 connections，未区分这些情况）。
