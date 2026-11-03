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

## 界面：装备行上的 Tier 标签（2026-11-03 追加）

角色页的「装备」卡里，每件已装备物品下面会列出它的词缀档位（`T1`…），悬停显示该行原文与所属组。

匹配方式（`src/core/affix-match.js`）：把数字统一成 `#` 比"形状"，再用实际数值落进哪一档决定 Tier——同一形状可能对应多档（例如 `+#% to Fire Resistance` 有两档），值落在哪一段就是哪一档；落在所有段外标为 `range-only`（灰色，表示"这不是那个档位"），形状完全认不出就不显示。

实测（导入 ranger-deadeye 后）：装备卡出现 26 个标签，如 `T1 Adds 1 to 109 Lightning Damage`、`T1 29% increased Attack Speed`、`T5 56% increased chance to Shock`、`T1 121% increased Evasion and Energy Shield`。

**覆盖率**：接入四个池（Item / Runes / Exclusive / Desecrated，共 3,763 组）并去掉解析器加的来源标签（`(enchant)` 等）后，三份构筑里 407 行"像词缀的行"命中 296 行（**73%**）。

剩下的 27% 主要是：
- `Grants Skill: …` 这类"授技"行（不是数值词缀）；
- 唯一物品的专属叙述句（不在 `ModItem` 池里，或在池里但文本带占位符）；
- 复合/混合行（例如同时含两个数值段的特殊词缀）。

这些**一律不显示标签**，而不是猜一个 Tier。

## 尚未完成

- UI：词缀面板与 Tier 拖动条（数据与比较函数已就绪）。
- 中文名：PoB 自带繁体词条可直接用；缺的再查 poe2db `/tw/Modifiers`。
- 复合词缀、符文、腐化等来源的合并展示；`bases` 目前只是底材 key 列表，还没映射到中文底材名。
