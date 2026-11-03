# 词缀阶级（Tier）

2026-11-03。数据来自固定版本的 Path of Building，不额外依赖 poe2db。

## 结论先行

PoB **自带**整套词缀池：`vendor/pob/src/Data/ModItem.lua`（1.07 MB）里每条都有前后缀、数值范围、**物品等级门槛**、`group`（同一条词缀的各级共享）、能出在哪些底材、交易站哈希。另有 `ModItemExclusive` / `ModJewel` / `ModRunes` / `ModCorrupted` / `ModVeiled` / `ModCharm` / `ModFlask` / `ModMap`。

但**没有字面的 `Tier` 字段**（`grep Tier` = 0）。阶级按游戏内的约定推导：**同一 `group` 内，物品等级最高的一档是 T1**。

## 接口

```lua
{ cmd = "tiers", kind = "Item", filter = "movement speed" }
→ { ok, kind, count, groups = [{ group, type = "Prefix"|"Suffix", tierCount,
      tiers = [{ tier, id, affix, text, level, bases }] }] }
```

- `kind`：`Item`（默认）/ `Flask` / `Charm` / `Jewel` / `IncursionLimb` / `Corruption` / `Runes` / `Exclusive` / `Deserialized`（实际为 `Desecrated`）。
- `filter`：对 `group` 与词缀文本做包含匹配，用来避免一次返回全量。
- 返回的 `tiers` 已按 T1（最好）→ Tn 排序，`tier` 就是游戏内看到的数字。

## 生成索引

```powershell
node tools/affix-tiers.js                       # vendor/pob/affix-tiers-Item.json（608 KB / 558 组 / 2550 档）
node tools/affix-tiers.js Jewel                 # 197 组 / 377 档
node tools/affix-tiers.js Item "movement speed" # 只导出匹配的组
```

生成物写在 `vendor/pob/` 下（该目录不入库）。要随应用分发需要单独确认数据许可，目前只在本地生成。

## 数值比较

`src/core/mod-text.js`：`ranges(text)` / `band(text)` / `positionInBand(text, value)`。

- `band('+(34-36) to Strength')` → `{min:34,max:36}`；
- `positionInBand('+(34-36) to Strength', 35)` → `0.5`（Tier 拖动条要知道实际数值落在档位的哪一端）；
- 落在范围外返回 `null`，表示"这一档对不上"，而不是 0 分。

## 实测

```
Strength: T1 lvl81 +(34-36) | T2 lvl74 +(31-33) | … | T9 lvl1 +(5-8)
IncreasedLife: T1 lvl80 +(200-214) | T2 lvl75 +(190-199) | T3 lvl70 +(175-189) | T4 lvl65 +(150-174)
```

## 尚未完成

- UI：词缀面板与 Tier 拖动条（数据与比较函数已就绪）。
- 中文名：PoB 自带繁体词条可直接用；缺的再查 poe2db `/tw/Modifiers`。
- 复合词缀、符文、腐化等来源的合并展示；`bases` 目前只是底材 key 列表，还没映射到中文底材名。
