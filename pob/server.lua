-- PoE2 Upgrade Checker <-> Path of Building bridge.
-- Runs Path of Building's own calculations headless and answers JSON requests, one per line:
--   {"id":1,"cmd":"load","xml":"<PathOfBuilding2>…"}        -> summary of the build
--   {"id":2,"cmd":"eval","items":[{"slot":"Gloves","text":"Item Class: …"}]} -> what each item changes
-- Replies are single lines starting with "@@" (PoB's own log output goes to stderr).
-- Started with the PoB "src" folder as the working directory.

-- the standalone luajit sets the command line in `arg`; PoB reads it, and our Windows host doesn't set it
arg = arg or { [0] = "server.lua" }

-- where Path of Building's runtime libraries are (set by the app when it starts us)
local hostDir = os.getenv("POBHOST_DIR")
if hostDir and hostDir ~= "" then
  local sep = package.config:sub(1, 1)
  package.cpath = hostDir .. sep .. "?.dll;" .. hostDir .. sep .. "?.so;" .. package.cpath
end
local luaPath = os.getenv("POB_LUA_PATH")
if luaPath and luaPath ~= "" then package.path = luaPath .. ";" .. package.path end

local out = io.stdout
local function reply(t) out:write("@@", t, "\n"); out:flush() end
-- PoB prints a lot while it loads: keep stdout for replies only
local recent = {}
print = function(...)
  local n = select('#', ...); local p = {}
  for i = 1, n do p[i] = tostring((select(i, ...))) end
  local line = table.concat(p, "\t")
  io.stderr:write(line, "\n")
  recent[#recent + 1] = line
  if #recent > 30 then table.remove(recent, 1) end
end

-- PoB's files start with a "#@" line its own launcher understands; plain LuaJIT doesn't
local rawDofile = dofile
dofile = function(path)
  local f = io.open(path, "rb")
  if not f then return rawDofile(path) end
  local src = f:read("*a"); f:close()
  src = src:gsub("^#[^\n]*", "")
  return assert(loadstring(src, "@" .. path))()
end

-- lua-utf8 is a native module next to lua51.dll; if it won't load, a plain-Lua stand-in keeps
-- PoB working (it only uses it for a few string functions on item and skill names)
if not pcall(require, "lua-utf8") then
  io.stderr:write("lua-utf8 not available, using a plain Lua stand-in\n")
  package.loaded["lua-utf8"] = nil
  package.preload["lua-utf8"] = function()
    local u = {}
    u.find, u.gsub, u.match, u.sub, u.reverse, u.len, u.lower, u.upper, u.format, u.byte, u.char = string.find, string.gsub, string.match, string.sub, string.reverse, string.len, string.lower, string.upper, string.format, string.byte, string.char
    u.next = function(s, i) i = (i or 0) + 1; if i > #s then return nil end; local c = s:byte(i); local n = c >= 240 and 4 or c >= 224 and 3 or c >= 192 and 2 or 1; return i, s:sub(i, i + n - 1) end
    return u
  end
end

-- PoB waits for Enter when it can't start; we're not a console, so don't let it block
local rawRead = io.read
local starting = true
io.read = function(...) if starting then return nil end; return rawRead(...) end
dofile("HeadlessWrapper.lua")
starting = false
io.read = rawRead
local dkjson = require("dkjson")
if not build or (mainObject and mainObject.promptMsg) then
  local msg = tostring(mainObject and mainObject.promptMsg or table.concat(recent, "\n"))
  msg = msg:gsub("%^%d", ""):gsub("%^x%x%x%x%x%x%x", "")
  out:write("@@", dkjson.encode({ ready = false, error = msg }), "\n"); out:flush()
  os.exit(1)
end

local function enc(v) return dkjson.encode(v) end

-- the numbers we report, read safely from a PoB output table
local function num(v) v = tonumber(v); if v == nil or v ~= v or v == math.huge or v == -math.huge then return nil end; return v end
local function pick(o)
  if not o then return {} end
  local m = o.Minion or {}
  local r = {
    FullDPS = num(o.FullDPS), CombinedDPS = num(o.CombinedDPS), TotalDPS = num(o.TotalDPS),
    MinionDPS = num(m.CombinedDPS) or num(m.TotalDPS), MinionLife = num(m.Life), MinionES = num(m.EnergyShield),
    Life = num(o.Life), EnergyShield = num(o.EnergyShield), Mana = num(o.Mana), Ward = num(o.Ward),
    TotalEHP = num(o.TotalEHP), Armour = num(o.Armour), Evasion = num(o.Evasion),
    Spirit = num(o.Spirit), SpiritUnreserved = num(o.SpiritUnreserved), ManaUnreserved = num(o.ManaUnreserved),
    Str = num(o.Str), Dex = num(o.Dex), Int = num(o.Int),
    ReqStr = num(o.ReqStr), ReqDex = num(o.ReqDex), ReqInt = num(o.ReqInt),
    MovementSpeedMod = num(o.MovementSpeedMod),
  }
  for _, el in ipairs({ "Fire", "Cold", "Lightning", "Chaos" }) do
    r[el .. "Resist"] = num(o[el .. "Resist"])
    r[el .. "ResistTotal"] = num(o[el .. "ResistTotal"])
    r[el .. "ResistOverCap"] = num(o[el .. "ResistOverCap"])
    -- PoB doesn't output the max itself, but it does output how much you're missing
    local res, missing = r[el .. "Resist"], num(o["Missing" .. el .. "Resist"])
    r[el .. "ResistMax"] = (res and missing) and (res + missing) or nil
  end
  return r
end

-- PoB releases build items with new("Item", text); its dev branch with new("Item"):Item(text)
local function makeItem(text)
  local ok, item = pcall(new, "Item", text)
  if ok and item and item.base then return item end
  local ok2, item2 = pcall(function() return new("Item"):Item(text) end)
  if ok2 and item2 and item2.base then return item2 end
  return nil
end

-- a build set to weapon set II keeps its active weapons in PoB's "Weapon 1 Swap"/"Weapon 2 Swap" slots
local function pobSlot(name)
  local set = build.itemsTab.activeItemSet
  if name and name:match("^Weapon [12]$") and set and set.useSecondWeaponSet then return name .. " Swap" end
  return name
end

local SLOTS = { "Weapon 1", "Weapon 2", "Helmet", "Body Armour", "Gloves", "Boots", "Amulet", "Ring 1", "Ring 2", "Belt" }
local function gearNames()
  local g = {}
  for _, name in ipairs(SLOTS) do
    local slot = build.itemsTab.slots[pobSlot(name)]
    local it = slot and slot.selItemId and build.itemsTab.items[slot.selItemId]
    if it then g[name] = it.title or it.name end
  end
  return g
end

-- What each slot holds beyond its name. Quality matters for the tiers: the game raises every local
-- defence / damage roll with it, so a 106% mod can be the top tier even though the tier's range
-- says 92-100. An item copied in game may not carry "Quality: N" in its text, PoB always knows it.
local function gearInfo()
  local g = {}
  for _, name in ipairs(SLOTS) do
    local slot = build.itemsTab.slots[pobSlot(name)]
    local it = slot and slot.selItemId and build.itemsTab.items[slot.selItemId]
    if it then
      g[name] = {
        name = it.title or it.name,
        baseType = it.baseName,
        quality = it.quality,
        itemLevel = it.itemLevel,
        corrupted = it.corrupted and true or false,
      }
    end
  end
  return g
end

-- put items you copied in game into PoB's build, so it calculates with what you really wear
local function equip(list)
  local done = {}
  for _, e in ipairs(list or {}) do
    local item = makeItem(e.text)
    local slot = build.itemsTab.slots[pobSlot(e.slot)]
    if item and slot then
      build.itemsTab:AddItem(item, true)
      slot:SetSelItemId(item.id)
      done[#done + 1] = e.slot
    end
  end
  build.itemsTab:PopulateSlots()
  build.buildFlag = true
  runCallback("OnFrame")
  return done
end

-- your allocated jewel sockets on the passive tree, in PoB's order ("Socket #1"…), with what's in them
local function jewelSockets()
  local list = {}
  local it = build.itemsTab
  -- PoB refreshes activeSocketList only while drawing, so read the allocated sockets ourselves
  local ids = {}
  for nodeId in pairs(it.sockets or {}) do if build.spec.allocNodes[nodeId] then ids[#ids + 1] = nodeId end end
  table.sort(ids)
  for n, nodeId in ipairs(ids) do
    local sock = it.sockets[nodeId]
    sock.inactive = false
    if sock then
      local node = build.spec.nodes[nodeId]
      -- sockets made by cluster-style jewels (containJewelSocket) aren't on the main tree
      if not (node and node.containJewelSocket) then
        local jewel = sock.selItemId and sock.selItemId ~= 0 and it.items[sock.selItemId] or nil
        -- a jewel's own lines (e.g. "Allocates Versatile Arms") are what makes it worth showing
        local mods = {}
        if jewel then
          for _, set in ipairs({ jewel.implicitModLines or {}, jewel.enchantModLines or {}, jewel.explicitModLines or {}, jewel.runeModLines or {} }) do
            for _, line in ipairs(set) do
              local txt = line.line
              if type(txt) == "string" and txt ~= "" then mods[#mods + 1] = txt end
            end
          end
        end
        list[#list + 1] = {
          slot = sock.slotName, nodeId = nodeId, label = "Socket #" .. n,
          jewel = jewel and (jewel.title or jewel.name) or nil,
          baseType = jewel and jewel.baseName or nil,
          mods = mods,
        }
      end
    end
  end
  return list
end

-- what each of the two weapon sets wields, and how many set-only passives it spends
local function weaponSetsInfo()
  local function slotItem(name)
    local slot = build.itemsTab and build.itemsTab.slots and build.itemsTab.slots[name]
    local item = slot and slot.selItemId and build.itemsTab.items[slot.selItemId]
    if not item then return nil end
    return { name = item.name, baseType = item.baseType }
  end
  local function points(n)
    local c = 0
    for _, node in pairs((build.spec and build.spec.allocNodes) or {}) do
      if (node.allocMode or 0) == n then c = c + 1 end
    end
    return c
  end
  return {
    { set = 1, main = slotItem("Weapon 1"), off = slotItem("Weapon 2"), points = points(1) },
    { set = 2, main = slotItem("Weapon 1 Swap"), off = slotItem("Weapon 2 Swap"), points = points(2) },
  }
end

local function summary()
  local o = build.calcsTab.mainOutput
  local skill = build.mainSocketGroup and build.skillsTab.socketGroupList[build.mainSocketGroup]
  local set = build.itemsTab and build.itemsTab.activeItemSet
  local ws = nil
  pcall(function() ws = weaponSetsInfo() end)
  return {
    ok = true,
    className = build.spec and build.spec.curClassName, ascendancy = build.spec and build.spec.curAscendClassName,
    level = build.characterLevel,
    mainSkill = skill and skill.displayLabel or nil,
    -- with the second weapon set on, "Weapon 1" in gear above is really the swap weapon
    weaponSwap = not not (set and set.useSecondWeaponSet),
    weaponSets = ws,
    stats = pick(o),
    gear = gearNames(),
    gearInfo = gearInfo(),
    sockets = jewelSockets(),
  }
end

-- Everything worth showing on a character sheet: the PoB numbers (yours and your minions'),
-- skills with their gems, keystones and ascendancy notables. Each part is read on its own, so one
-- PoB version difference can't break the whole sheet.
local function grab(o, keys)
  local r = {}
  if not o then return r end
  for _, k in ipairs(keys) do
    local v = o[k]
    if type(v) == "boolean" then r[k] = v else r[k] = num(v) end
  end
  return r
end
local PLAYER_KEYS = {
  "FullDPS", "TotalDPS", "CombinedDPS", "TotalDotDPS", "AverageHit", "AverageDamage", "Speed", "CritChance", "CritMultiplier", "HitChance", "Accuracy",
  "Life", "LifeUnreserved", "LifeRegenRecovery", "EnergyShield", "EnergyShieldRecharge", "EnergyShieldRechargeDelay", "EnergyShieldRegenRecovery",
  "Mana", "ManaUnreserved", "ManaRegenRecovery", "Ward", "WardRechargeDelay",
  "Spirit", "SpiritReserved", "SpiritUnreserved",
  "TotalEHP", "EHPSurvivalTime", "Armour", "Evasion", "EvadeChance", "PhysicalDamageReduction",
  "BlockChance", "BlockChanceMax", "SpellBlockChance", "DeflectChance", "DeflectionRating", "StunAvoidChance", "StunThreshold", "AilmentThreshold",
  "PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken", "ChaosMaximumHitTaken",
  "Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt",
  "MovementSpeedMod", "EffectiveMovementSpeedMod",
  "PowerCharges", "PowerChargesMax", "FrenzyCharges", "FrenzyChargesMax", "EnduranceCharges", "EnduranceChargesMax",
  "ChaosInoculation", "TotalCompanionLife", "PresenceRadiusMetres",
}
local MINION_KEYS = {
  "CombinedDPS", "TotalDPS", "AverageHit", "Speed", "CastRate", "CritChance", "CritMultiplier", "HitChance", "Cooldown",
  "Life", "EnergyShield", "Armour", "Evasion", "TotalEHP", "PhysicalDamageReduction", "BlockChance",
  "FireResist", "ColdResist", "LightningResist", "ChaosResist", "AreaOfEffectRadiusMetres",
}
local function sheet()
  local o = build.calcsTab.mainOutput or {}
  local r = summary()
  r.player = grab(o, PLAYER_KEYS)
  r.res = {}
  for _, el in ipairs({ "Fire", "Cold", "Lightning", "Chaos" }) do
    local v, missing = num(o[el .. "Resist"]), num(o["Missing" .. el .. "Resist"])
    r.res[#r.res + 1] = { el = el, value = v, total = num(o[el .. "ResistTotal"]), over = num(o[el .. "ResistOverCap"]), max = (v and missing) and (v + missing) or nil }
  end
  if o.Minion then
    r.minion = grab(o.Minion, MINION_KEYS)
    pcall(function()
      local ms = build.calcsTab.mainEnv.player.mainSkill
      r.minion.name = ms and ms.minion and ms.minion.minionData and ms.minion.minionData.name or nil
    end)
  end
  -- skills: every socket group with its gems (the main one marked)
  pcall(function()
    r.skills = {}
    local activeSet = (build.itemsTab.activeItemSet and build.itemsTab.activeItemSet.useSecondWeaponSet) and 2 or 1
    r.activeWeaponSet = activeSet
    for i, g in ipairs(build.skillsTab.socketGroupList or {}) do
      local gems = {}
      for _, gem in ipairs(g.gemList or {}) do
        local name = gem.nameSpec or (gem.grantedEffect and gem.grantedEffect.name)
        if name and name ~= "" then
          local tags = (gem.gemData and gem.gemData.tags) or {}
          local support = not not ((gem.grantedEffect and gem.grantedEffect.support) or (gem.gemData and gem.gemData.grantedEffect and gem.gemData.grantedEffect.support) or tags.support)
          -- persistent buffs pay their cost with Spirit in PoE2
          local spirit = (not support) and (not not tags.persistent)
          gems[#gems + 1] = {
            name = name, level = num(gem.level), quality = num(gem.quality), enabled = gem.enabled ~= false,
            support = support, spirit = spirit, active = not support,
            -- an attack depends on the equipped weapon, so it follows the active weapon set
            -- (a persistent buff such as a herald also carries the tag: it doesn't swing anything)
            attack = not not (tags.attack and not tags.persistent and not support),
          }
        end
      end
      if #gems > 0 then
        -- PoE2 sockets a skill into a weapon slot, and a weapon slot belongs to one of the two
        -- weapon sets: only the active set's skills are calculated
        local slot = g.slot and build.itemsTab.slots and build.itemsTab.slots[g.slot]
        local wset = slot and slot.weaponSet or nil
        -- a stable name for the skill (its own gems, supports left out): the app keys the weapon
        -- set you picked for it by this, and the main skill's pick drives the whole page
        local keyGems, activeGems = {}, {}
        for _, x in ipairs(gems) do
          keyGems[#keyGems + 1] = x.name
          if not x.support then activeGems[#activeGems + 1] = x.name end
        end
        r.skills[#r.skills + 1] = {
          id = i, label = g.displayLabel or g.label, enabled = g.enabled ~= false, main = (i == build.mainSocketGroup),
          slot = g.slot, gems = gems,
          key = table.concat(#activeGems > 0 and activeGems or keyGems, "|"),
          weaponSet = wset, inActiveSet = (not wset) or wset == activeSet,
        }
      end
    end
  end)
  -- both weapon sets: what each one wields, and how many set-only passives it spends
  pcall(function() r.weaponSets = weaponSetsInfo() end)
  -- passive tree: keystones, ascendancy notables, notables and points used
  pcall(function()
    local key, asc, notables, points = {}, {}, {}, 0
    for _, node in pairs(build.spec.allocNodes or {}) do
      local t = node.type
      if t ~= "ClassStart" and t ~= "AscendClassStart" then
        if node.ascendancyName then
          if t == "Notable" or node.isNotable then asc[#asc + 1] = node.dn end
        else
          points = points + 1
          if t == "Keystone" then key[#key + 1] = node.dn
          elseif t == "Notable" then notables[#notables + 1] = node.dn end
        end
      end
    end
    local function uniq(t) table.sort(t); local o, last = {}, nil; for _, v in ipairs(t) do if v ~= last then o[#o + 1] = v end; last = v end; return o end
    key, asc, notables = uniq(key), uniq(asc), uniq(notables)
    -- every allocated passive, with its own stat lines (the Passive tree page lists them)
    local nodes = {}
    for _, node in pairs(build.spec.allocNodes or {}) do
      local t = node.type
      if t ~= "ClassStart" and t ~= "AscendClassStart" and node.dn then
        local stats = {}
        for _, line in ipairs(node.sd or {}) do
          if type(line) == "string" and line ~= "" then stats[#stats + 1] = line end
        end
        nodes[#nodes + 1] = { name = node.dn, type = t, asc = node.ascendancyName ~= nil, stats = stats }
      end
    end
    table.sort(nodes, function(a, b) return tostring(a.name) < tostring(b.name) end)
    r.tree = { keystones = key, ascendancy = asc, notables = notables, points = points, nodes = nodes }
  end)
  return r
end

local function evalItems(items)
  local calcFunc, base = build.calcsTab:GetMiscCalculator()
  local res = {}
  for i, it in ipairs(items) do
    local ok, r = pcall(function()
      local item = makeItem(it.text)
      if not item then return { ok = false, error = "Path of Building couldn't read this item" } end
      local slot = it.slot
      if slot == "Jewel" then
        -- try it in every allocated socket: replacing the jewel there, or in an empty one
        local multi = {}
        for _, s in ipairs(jewelSockets()) do
          if build.itemsTab:IsItemValidForSlot(item, s.slot) then
            local new_ = calcFunc({ repSlotName = s.slot, repItem = item })
            multi[#multi + 1] = { slot = s.slot, label = s.label, replacing = s.jewel, after = pick(new_) }
          end
        end
        if #multi == 0 then return { ok = false, error = "You have no allocated jewel socket this jewel fits" } end
        return { ok = true, slot = slot, before = pick(base), multi = multi }
      end
      local pslot = pobSlot(slot)
      -- PoB empties the offhand itself for most two-handers, but not crossbows or quarterstaves
      local off, offId
      local info = item.base and data.weaponTypeInfo[item.base.type]
      if pslot:match("^Weapon 1") and info and not info.oneHand and (item.base.type == "Crossbow" or item.base.type == "Warstaff" or item.base.type == "Fishing Rod") then
        off = build.itemsTab.slots[pslot:gsub("^Weapon 1", "Weapon 2")]
        if off then offId = off.selItemId; off.selItemId = 0 end
      end
      local okc, new_ = pcall(calcFunc, { repSlotName = pslot, repItem = item })
      if off then off.selItemId = offId end
      if not okc then error(new_) end
      return { ok = true, slot = slot, before = pick(base), after = pick(new_) }
    end)
    res[i] = ok and r or { ok = false, error = tostring(r) }
  end
  return res
end

-- Path of Building's own trade search generator ("Trader"): it tries every mod that can roll on
-- the slot's item type on your build and weights each by how much it raises your damage and
-- effective HP, then builds a weighted trade search from that.
--   req: { slot = "Gloves", weights = { {stat="MinionCombinedDPS", weightMult=0.6}, ... }, maxPrice, maxPriceType }
local function genQuery(req)
  local slot = build.itemsTab.slots[pobSlot(req.slot)]
  if not slot then return { ok = false, error = "unknown slot " .. tostring(req.slot) } end
  local gen = new("TradeQueryGenerator", { itemsTab = build.itemsTab })
  local result, err
  gen.requesterCallback = function(_, q, e) result = q; err = e end
  gen.requesterContext = {}
  local weights = {}
  for _, w in ipairs(req.weights or {}) do weights[#weights + 1] = { stat = w.stat, weightMult = w.weightMult, label = w.stat } end
  if #weights == 0 then weights = { { stat = "FullDPS", weightMult = 1.0 }, { stat = "TotalEHP", weightMult = 0.5 } } end
  local options = {
    statWeights = weights, includeCorrupted = req.includeCorrupted ~= false, includeMirrored = false, includeRunes = false,
    maxPrice = req.maxPrice, maxPriceType = req.maxPriceType, jewelType = req.jewelType or "Base",
  }
  local t0 = os.clock()
  gen:StartQuery(slot, options)
  local frames = 0
  while gen.calcContext and gen.calcContext.co and frames < 1000000 do gen:OnFrame(); frames = frames + 1 end
  if not result then return { ok = false, error = err or "Path of Building could not build a search for this slot" } end
  -- the per-mod weights it found, for showing and for trimming the search to the site's limits
  local mw = {}
  for i, e in ipairs(gen.modWeights or {}) do
    if i > 60 then break end
    mw[#mw + 1] = { id = e.tradeModId, weight = e.weight, invert = e.invert or nil, mean = e.meanStatDiff }
  end
  return { ok = true, query = result, error = err, modWeights = mw, seconds = os.clock() - t0 }
end

-- Where a stat comes from: PoB keeps every modifier with the thing that granted it
-- ("Item:17:Kraken Ward…", "Tree:43082", "Skill:…", "Quest:…"), which is what the
-- character page shows on hover.
local STAT_SPECS = {
  Life = { "Life" }, Mana = { "Mana" }, EnergyShield = { "EnergyShield" }, Ward = { "Ward" },
  Armour = { "Armour" }, Evasion = { "Evasion" }, Spirit = { "Spirit" },
  Str = { "Str" }, Dex = { "Dex" }, Int = { "Int" },
  FireResist = { "FireResist", "ElementalResist", "AllResist" },
  ColdResist = { "ColdResist", "ElementalResist", "AllResist" },
  LightningResist = { "LightningResist", "ElementalResist", "AllResist" },
  ChaosResist = { "ChaosResist", "AllResist" },
  BlockChance = { "BlockChance" }, StunThreshold = { "StunThreshold" },
  PowerChargesMax = { "PowerChargesMax" }, FrenzyChargesMax = { "FrenzyChargesMax" }, EnduranceChargesMax = { "EnduranceChargesMax" },
  ManaRegenRecovery = { "ManaRegen" },
  -- "15% of Damage is taken from Mana before Life": what puts mana into the hit pool
  MindOverMatter = {
    "DamageTakenFromManaBeforeLife", "PhysicalDamageTakenFromManaBeforeLife", "FireDamageTakenFromManaBeforeLife",
    "ColdDamageTakenFromManaBeforeLife", "LightningDamageTakenFromManaBeforeLife", "ChaosDamageTakenFromManaBeforeLife",
  },
  Strength = { "Str" }, Dexterity = { "Dex" }, Intelligence = { "Int" },
}

-- "Skill:SupportBlazingCriticalPlayer" -> the gem's name when we can find it
local skillNames = nil
local function skillLabel(id)
  local plain = tostring(id):gsub("Player$", "")
  if not skillNames then
    skillNames = {}
    pcall(function()
      for _, gem in pairs(build.data.gems or {}) do
        local label = gem.name or gem.baseName
        local eff = gem.grantedEffect
        if label and eff and eff.id and not skillNames[eff.id] then skillNames[eff.id] = label end
        if label and gem.grantedEffectId and not skillNames[gem.grantedEffectId] then skillNames[gem.grantedEffectId] = label end
      end
      for _, group in ipairs(build.skillsTab.socketGroupList or {}) do
        for _, gem in ipairs(group.gemList or {}) do
          local eff = gem.grantedEffect or {}
          local label = gem.nameSpec or eff.name
          if label and eff.id and not skillNames[eff.id] then skillNames[eff.id] = label end
        end
      end
    end)
  end
  if skillNames[id] then return skillNames[id] end
  if skillNames[plain] then return skillNames[plain] end
  -- fall back to the id, split back into words: ChargeRegulation -> Charge Regulation
  return (plain:gsub("(%l)(%u)", "%1 %2"))
end

local function sourceOf(src)
  src = tostring(src)
  if src == "Base" then return { kind = "base" } end
  local kind, rest = src:match("^(%a+):(.+)$")
  if kind == "Item" then
    local id, name = rest:match("^(%d+):(.+)$")
    return { kind = "item", name = name or rest, ref = id }
  elseif kind == "Tree" then
    local node = build.spec and build.spec.nodes[tonumber(rest)]
    local nm = node and node.dn or nil
    -- PoB writes jewel sockets as "[Jewel|珠寶]插槽": keep the readable half
    if nm then nm = nm:gsub("%[[^%]|]*|([^%]]+)%]", "%1") end
    return { kind = "tree", name = nm, ref = rest }
  elseif kind == "Skill" then
    return { kind = "skill", name = skillLabel(rest), ref = rest }
  elseif kind == "Quest" then
    return { kind = "quest", name = rest }
  elseif kind == "Config" then
    return { kind = "config", name = rest }
  end
  return { kind = "other", name = src }
end

local function plainLines(list, limit)
  local out, seen = {}, {}
  for i = 1, math.min(#(list or {}), limit or 14) do
    local line = list[i]
    if type(line) == "string" and line ~= "" then
      line = line:gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", ""):gsub("%s+$", "")
      if not seen[line] then
        seen[line] = true
        out[#out + 1] = line
      end
    end
  end
  return out
end

-- a damage modifier that actually scales the hit (not damage taken, mitigation, …)
local function damageMod(name)
  name = tostring(name)
  return name:find("Damage") and not name:find("Taken") and not name:find("Reduction")
    and not name:find("Avoid") and not name:find("Mitigat") and not name:find("Prevent")
end

-- The jewels sitting in your allocated sockets, with the radius a radius jewel reaches:
-- PoB keeps every socket's "nodes in radius" per radius index, so the page can draw the same circle.
local function treeJewels()
  local out = {}
  local it = build.itemsTab
  if not (it and it.sockets) then return out end
  local radii = data and data.jewelRadius or {}
  local mult = (data and data.gameConstants and data.gameConstants["PassiveTreeJewelDistanceMultiplier"]) or 1
  local keystones = (build.spec and build.spec.tree and build.spec.tree.keystoneMap) or {}
  for nodeId, sock in pairs(it.sockets) do
    if sock.selItemId and sock.selItemId ~= 0 then
      local jewel = it.items[sock.selItemId]
      local node = build.spec.nodes[nodeId]
      if jewel and node and node.x and node.y then
        local mods = {}
        for _, set in ipairs({ jewel.implicitModLines or {}, jewel.enchantModLines or {}, jewel.explicitModLines or {}, jewel.runeModLines or {} }) do
          for _, line in ipairs(set) do
            if type(line.line) == "string" and line.line ~= "" then mods[#mods + 1] = line.line end
          end
        end
        local idx = jewel.jewelRadiusIndex
        local info = idx and radii[idx] or nil
        local x, y = node.x, node.y
        local outer = info and info.outer * mult or nil
        local inner = info and info.inner * mult or 0
        -- "Passives in Radius of <keystone> can be Allocated…" (From Nothing): PoB draws that ring
        -- around the keystone itself, with a fixed small inner circle
        local keyName = nil
        if jewel.jewelData and jewel.jewelData.fromNothingKeystones then
          for name in pairs(jewel.jewelData.fromNothingKeystones) do keyName = name; break end
          local keyNode = keyName and keystones[keyName] or nil
          if keyNode and keyNode.x and keyNode.y then
            x, y = keyNode.x, keyNode.y
            inner = 150
          end
        end
        out[#out + 1] = {
          nodeId = nodeId, x = x, y = y, socketX = node.x, socketY = node.y,
          allocated = build.spec.allocNodes[nodeId] and true or false,
          name = jewel.title or jewel.name, baseType = jewel.baseName,
          mods = mods,
          radiusIndex = idx,
          outer = outer, inner = inner,
          keystone = keyName,
          label = info and info.label or nil,
          color = info and info.col and info.col:gsub("%^x", "#") or nil,
        }
      end
    end
  end
  return out
end

-- The whole passive tree, small enough to send: PoB has already worked out every node's
-- screen position (node.x / node.y), so the page can draw it directly.
local function passivetree()
  local spec = build.spec
  local tree = spec and spec.tree
  if not tree then return { ok = false, error = "Path of Building hasn't loaded a passive tree." } end
  local ids = {}
  for id in pairs(tree.nodes or {}) do ids[#ids + 1] = tonumber(id) end
  table.sort(ids)
  local nodes, edges, seen = {}, {}, {}
  local minX, minY, maxX, maxY = math.huge, math.huge, -math.huge, -math.huge
  for _, id in ipairs(ids) do
    local n = tree.nodes[id] or tree.nodes[tostring(id)]
    if n and n.x and n.y then
      local flags = 0
      if n.isNotable or n.type == "Notable" then flags = flags + 1 end
      if n.type == "Keystone" then flags = flags + 2 end
      if n.ascendancyName then flags = flags + 4 end
      if spec.allocNodes[id] or spec.allocNodes[tostring(id)] then flags = flags + 8 end
      if n.isJewelSocket then flags = flags + 16 end
      -- passive points spent per weapon set: 0 = both sets, 1 = set 1, 2 = set 2
      local mode = tonumber((spec.nodes[id] or spec.nodes[tostring(id)] or {}).allocMode) or 0
      if mode == 1 then flags = flags + 32 elseif mode == 2 then flags = flags + 64 end
      local stats = {}
      for _, line in ipairs(n.sd or n.stats or {}) do if type(line) == "string" and line ~= "" then stats[#stats + 1] = line end end
      nodes[#nodes + 1] = { id, n.x, n.y, n.name or "", flags, n.ascendancyName or "", stats }
      if n.x < minX then minX = n.x end
      if n.y < minY then minY = n.y end
      if n.x > maxX then maxX = n.x end
      if n.y > maxY then maxY = n.y end
      for _, c in ipairs(n.connections or {}) do
        local other = tonumber(c.id)
        if other then
          local a, b = math.min(id, other), math.max(id, other)
          if tree.nodes[other] or tree.nodes[tostring(other)] then
            local key = a .. ":" .. b
            if not seen[key] then seen[key] = true; edges[#edges + 1] = { a, b } end
          end
        end
      end
    end
  end
  local r = { ok = true, nodes = nodes, edges = edges, bounds = { minX, minY, maxX, maxY } }
  pcall(function() r.jewels = treeJewels() end)
  return r
end

-- PoB works out the biggest hit you can take by running its own damage chain backwards: pool ->
-- damage taken multipliers -> resistances / armour -> the incoming hit. It keeps that as a small
-- table plus the lines that add up to one number, which is exactly the "how is it calculated" answer.
local MAX_HIT_STAT = {
  PhysicalMaximumHitTaken = "Physical", FireMaximumHitTaken = "Fire", ColdMaximumHitTaken = "Cold",
  LightningMaximumHitTaken = "Lightning", ChaosMaximumHitTaken = "Chaos",
}

local function cleanText(s) return (tostring(s or ""):gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", ""):gsub("\t", "  "):gsub("%s+$", "")) end

local function maxHitSources(player, output, stat, dtype)
  local bd = player.breakdown and player.breakdown[stat]
  local rows, lines = {}, {}
  if type(bd) == "table" then
    for _, r in ipairs(bd.rowList or {}) do
      local row = {}
      for _, k in ipairs({ "type", "pool", "incoming", "multi", "taken" }) do row[k] = cleanText(r[k]) end
      rows[#rows + 1] = row
    end
    local seen = {}
    for i = 1, math.min(#bd, 40) do
      local line = bd[i]
      if type(line) == "string" then
        local txt = cleanText(line)
        if txt ~= "" and not seen[txt] then seen[txt] = true; lines[#lines + 1] = txt end
      end
    end
  end

  -- what the number is made of: the pools the hit would empty, then what it passes through
  local inputs = {}
  local function add(statName, key, value, suffix, dim, role)
    value = num(value)
    if value == nil then return end
    inputs[#inputs + 1] = { stat = statName, key = key, value = value, suffix = suffix, dim = dim or nil, role = role or "mit" }
  end
  local joined = table.concat(lines, "\n")
  local pools = { { "Life", "Life" }, { "EnergyShield", "Energy Shield" }, { "Mana", "Mana" }, { "Ward", "Ward" } }
  -- why mana is in this list at all: the "damage taken from mana before life" share
  local mom = (num(output.sharedMindOverMatter) or 0) + (num(output[dtype .. "MindOverMatter"]) or 0)
  local function addMom()
    if mom > 0 then add("MindOverMatter", "MindOverMatter", math.min(mom, 100), "%", nil, "mech") end
  end
  local anyPool = false
  if joined ~= "" then
    for _, p in ipairs(pools) do
      local v = num(output[p[1]])
      -- only pools that actually appear in the drained-resources list take part in this hit
      if v and v > 0 and joined:find("%d+ " .. p[2]) then
        add(p[1], p[1], v, nil, nil, "pool")
        anyPool = true
        if p[1] == "Mana" then addMom() end
      end
    end
  end
  if not anyPool then
    for _, p in ipairs(pools) do
      local v = num(output[p[1]])
      if v and v > 0 then
        add(p[1], p[1], v, nil, nil, "pool")
        if p[1] == "Mana" then addMom() end
      end
    end
  end

  -- PoB prints the conversion as a whole percent ("1% as Fire"); the real shares are fractions
  -- (1.67%), so take them from the damage shift table and make them add up to 100%.
  local shift = (player.damageShiftTable and player.damageShiftTable[dtype]) or {}
  local shares, order2 = {}, {}
  local function share(takenType, pct)
    pct = num(pct)
    if not pct or pct <= 0 then return end
    if shares[takenType] then return end
    shares[takenType] = pct
    order2[#order2 + 1] = takenType
  end
  for _, ty in ipairs({ "Physical", "Fire", "Cold", "Lightning", "Chaos" }) do share(ty, shift[ty]) end
  if #order2 == 0 then share(dtype, 100) end
  -- round to 2 decimals and put the remainder on the largest share so the column sums to 100
  local round2 = function(v) return math.floor(v * 100 + 0.5) / 100 end
  local sum, biggest, biggestAt = 0, -1, 1
  for i, ty in ipairs(order2) do
    shares[ty] = round2(shares[ty])
    sum = sum + shares[ty]
    if shares[ty] > biggest then biggest, biggestAt = shares[ty], i end
  end
  shares[order2[biggestAt]] = round2(shares[order2[biggestAt]] + (100 - sum))
  local rowByType = {}
  for _, r in ipairs(rows) do
    local ty = r.type and r.type:match("as (%a+)$")
    if ty then rowByType[ty] = r end
  end
  for _, ty in ipairs(order2) do
    local r = rowByType[ty]
    if r then
      local v = shares[ty]
      local label = string.format("%.2f", v):gsub("%.?0+$", "")
      r.type = label .. "% as " .. ty
      r.share = v
    end
  end
  local types, seenType = {}, {}
  local function addType(x) if x and not seenType[x] then seenType[x] = true; types[#types + 1] = x end end
  for _, ty in ipairs(order2) do addType(ty) end
  if #types == 0 then addType(dtype) end
  local anyPhysical = false
  for _, x in ipairs(types) do
    if x == "Physical" then anyPhysical = true end
    local res, missing = num(output[x .. "Resist"]), num(output["Missing" .. x .. "Resist"])
    -- physical has no resistance of its own in PoE2 (armour takes that place)
    if res and (res ~= 0 or x ~= "Physical") then
      add(x .. "Resist", x .. "Resist", res, "%")
      if missing then add(nil, x .. "ResistMax", res + missing, "%", true) end
    end
  end
  if anyPhysical then
    local armour = num(output.Armour)
    if armour and armour > 0 then add("Armour", "Armour", armour) end
    local maxDR = num(output[dtype .. "DamageReductionMax"])
    if maxDR and maxDR > 0 then add(nil, "DamageReductionMax", maxDR, "%", true) end
  end
  local enemyMult = num(output[dtype .. "EnemyDamageMult"])
  if enemyMult and math.abs(enemyMult - 1) > 0.001 then add(nil, "EnemyDamageMult", enemyMult, "x", true) end
  return { ok = true, stat = stat, kind = "maxhit", damageType = dtype, total = num(output[stat]), formula = { rows = rows, lines = lines }, inputs = inputs }
end

-- group a list of modifiers by the thing that granted them (item / tree / skill / quest / config)
local SRC_RANK = { base = 1, item = 2, tree = 3, skill = 4, quest = 5, config = 6, other = 7 }
local function groupEntries(entries, opts)
  opts = opts or {}
  local groups, order = {}, {}
  for _, mod in ipairs(entries) do
    local info = sourceOf(mod.source)
    local key = info.kind .. "|" .. tostring(info.name or info.ref or "")
    local g = groups[key]
    if not g then
      g = { kind = info.kind, name = info.name, ref = info.ref, mods = {} }
      groups[key] = g
      order[#order + 1] = key
    end
    local val = tonumber(mod.value)
    if val then
      local typ = tostring(mod.type)
      if typ == "BASE" or typ == "INC" or typ == "MORE" then
        if typ == "BASE" and opts.basePercent then val = val * 100 end
        g.mods[#g.mods + 1] = { type = typ, value = val }
      end
    end
  end
  table.sort(order, function(a, b) return (SRC_RANK[groups[a].kind] or 9) < (SRC_RANK[groups[b].kind] or 9) end)
  local out = {}
  for _, key in ipairs(order) do
    local g = groups[key]
    -- one line per kind of modifier: flat values and percentages add up, "more" ones stay separate
    local flat, inc, more = 0, 0, {}
    for _, m in ipairs(g.mods) do
      if m.type == "BASE" then flat = flat + m.value
      elseif m.type == "INC" then inc = inc + m.value
      elseif m.type == "MORE" then
        local seen = false
        for _, v in ipairs(more) do if math.abs(v - m.value) < 0.001 then seen = true end end
        if not seen then more[#more + 1] = m.value end
      end
    end
    if flat ~= 0 or inc ~= 0 or #more > 0 then
      g.flat, g.inc, g.more = flat, inc, more
      g.mods = nil
      if opts.suffix then g.suffix = opts.suffix end
      out[#out + 1] = g
    end
  end
  return out
end

-- the modifiers behind a set of stat names, as source groups
local function tabulate(db, names, opts)
  local entries = {}
  for _, name in ipairs(names) do
    local ok, list = pcall(function() return db:Tabulate(nil, nil, name) end)
    if ok and type(list) == "table" then
      for _, e in ipairs(list) do
        if e.mod then entries[#entries + 1] = { type = e.mod.type, value = e.value, source = e.mod.source } end
      end
    end
  end
  return groupEntries(entries, opts)
end

-- movement speed: (1 + added) x increased/reduced x more/less, then action speed on top of it
local function moveSources(player, output)
  local groups = player.modDB and tabulate(player.modDB, { "MovementSpeed" }, { basePercent = true, suffix = "%" }) or {}
  local flat, inc, more = 0, 0, {}
  for _, g in ipairs(groups) do
    flat = flat + (g.flat or 0)
    inc = inc + (g.inc or 0)
    for _, m in ipairs(g.more or {}) do more[#more + 1] = m end
  end
  local mod = num(output.MovementSpeedMod) or 1
  return {
    ok = true, stat = "MovementSpeed", kind = "move", total = (mod - 1) * 100,
    move = {
      flat = flat, inc = inc, more = more, mod = mod,
      action = num(output.ActionSpeedMod) or 1,
      effective = num(output.EffectiveMovementSpeedMod) or mod,
    },
    steps = plainLines(player.breakdown and player.breakdown.EffectiveMovementSpeedMod),
    groups = groups,
  }
end

-- every damage modifier the main skill can use, whatever store it came from
local function skillDamageGroups(player)
  local skill = player.mainSkill
  local list = skill and skill.skillModList
  if not list then return {} end
  local names, store = {}, list
  while store do
    for name in pairs(store.mods or {}) do
      if damageMod(name) then names[name] = true end
    end
    store = store.parent
  end
  local entries = {}
  for name in pairs(names) do
    local ok, tab = pcall(function() return list:Tabulate(nil, skill.skillCfg, name) end)
    if ok and type(tab) == "table" then
      for _, e in ipairs(tab) do
        if e.mod then entries[#entries + 1] = { type = e.mod.type, value = e.value, source = e.mod.source } end
      end
    end
  end
  return groupEntries(entries)
end

-- the damage PoB works out for the skill on the Calcs tab: the hit per damage type, then what scales it
local DAMAGE_STATS = { CombinedDPS = true, TotalDPS = true, FullDPS = true, AverageHit = true, AverageDamage = true }
local function damageSources(player, output, stat)
  local bd = player.breakdown or {}
  local steps = plainLines(type(bd[stat]) == "table" and bd[stat] or nil)
  if #steps == 0 and (stat == "CombinedDPS" or stat == "FullDPS") then steps = plainLines(bd.TotalDPS) end
  local src = output.MainHand or output
  local rows, sum = {}, 0
  for _, ty in ipairs({ "Physical", "Fire", "Cold", "Lightning", "Chaos" }) do
    local mn, mx, avg = num(src[ty .. "Min"]), num(src[ty .. "Max"]), num(src[ty .. "HitAverage"])
    if (mn or 0) > 0 or (mx or 0) > 0 or (avg or 0) > 0 then
      rows[#rows + 1] = { type = ty, min = mn, max = mx, average = avg }
      sum = sum + (avg or 0)
    end
  end
  for _, r in ipairs(rows) do if sum > 0 and r.average then r.portion = r.average / sum * 100 end end
  -- every modifier the skill can use, biggest first, then grouped by where it came from
  -- (the panel lays long lists out in two columns instead of dropping any)
  local groups = skillDamageGroups(player)
  local function score(g)
    local v = math.abs(g.flat or 0) + math.abs(g.inc or 0)
    for _, m in ipairs(g.more or {}) do v = v + math.abs(m) end
    return v
  end
  table.sort(groups, function(a, b) return score(a) > score(b) end)
  local groupCount = #groups
  table.sort(groups, function(a, b) return (SRC_RANK[a.kind] or 9) < (SRC_RANK[b.kind] or 9) end)
  local skill = player.mainSkill
  local total = num(output[stat])
  if total == nil and stat == "AverageHit" then total = num(output.AverageDamage) end
  local info = nil
  if skill and skill.activeEffect then
    local eff = skill.activeEffect.grantedEffect
    local gd = skill.activeEffect.gemData
    local level = tonumber(skill.activeEffect.level)
    local lv = eff and eff.levels and eff.levels[level or 1] or {}
    local tags = {}
    for k, v in pairs((gd and gd.tags) or {}) do if v then tags[#tags + 1] = k end end
    table.sort(tags)
    info = {
      name = (eff and (eff.name or eff.baseTypeName)) or nil,
      level = level, quality = tonumber(skill.activeEffect.quality),
      tags = tags,
      damageEffectiveness = num(lv.baseMultiplier),
      attackSpeedMultiplier = num(lv.attackSpeedMultiplier),
      cost = num(output.ManaCost),
      reserved = num(skill.skillData and skill.skillData.SpiritReservedBase),
    }
  end
  return {
    ok = true, stat = stat, kind = "damage", total = total, groupCount = groupCount,
    skill = skill and skill.activeEffect and skill.activeEffect.grantedEffect and skill.activeEffect.grantedEffect.name or nil,
    damage = {
      rows = rows,
      totalDps = num(output.TotalDPS),
      extra = (num(output[stat]) and num(output.TotalDPS)) and math.max(num(output[stat]) - num(output.TotalDPS), 0) or nil,
      average = num(output.AverageDamage) or num(output.AverageHit),
      hitChance = num(output.HitChance), critChance = num(output.CritChance), critMulti = num(output.CritMultiplier),
      speed = num(output.Speed) or num(output.HitSpeed), dpsMulti = num(output.DpsMultiplier),
    },
    steps = steps,
    groups = groups,
    info = info,
  }
end

-- The damage of one skill group. PoB works out the skill picked in its Calcs tab (input.skill_number),
-- so point that at the group, build the Calcs pass, read the numbers, then put it back.
-- PoB holds one weapon set for the whole build, so a skill that belongs to the other set is
-- calculated on that set (its own weapons and its own set-only passives) and the build is restored after.
local function skillSources(index, stat, wantSet)
  local groups = (build.skillsTab and build.skillsTab.socketGroupList) or {}
  if not groups[index] then return { ok = false, error = "no such skill" } end
  local tab = build.calcsTab
  local calc = tab.calcs
  local prevSkill = tab.input and tab.input.skill_number
  local itemSet = build.itemsTab and build.itemsTab.activeItemSet
  local curSet = (itemSet and itemSet.useSecondWeaponSet) and 2 or 1
  local function setPoints(n)
    local c = 0
    for _, node in pairs((build.spec and build.spec.allocNodes) or {}) do
      if (node.allocMode or 0) == n then c = c + 1 end
    end
    return c
  end
  local function buildCalcs()
    local env = calc.buildOutput(build, "CALCS")
    tab.calcsEnv = env
    tab.calcsOutput = env.player.output
    return env
  end
  local function read(env)
    local r = damageSources(env.player, env.player.output, "CombinedDPS")
    r.stat = stat
    if r.info then r.info.slot = groups[index].slot end
    r.skill = env.player.mainSkill and env.player.mainSkill.activeEffect
      and env.player.mainSkill.activeEffect.grantedEffect and env.player.mainSkill.activeEffect.grantedEffect.name or nil
    r.main = (index == (prevSkill or 1))
    local used = (itemSet and itemSet.useSecondWeaponSet) and 2 or 1
    local function itemName(slotName)
      local slot = build.itemsTab and build.itemsTab.slots and build.itemsTab.slots[slotName]
      local item = slot and slot.selItemId and build.itemsTab.items[slot.selItemId]
      return item and item.name or nil
    end
    r.weaponSet = used
    r.awakeSet = curSet
    r.switched = used ~= curSet
    r.weapons = { main = itemName(used == 2 and "Weapon 1 Swap" or "Weapon 1"), off = itemName(used == 2 and "Weapon 2 Swap" or "Weapon 2") }
    r.setPoints = setPoints(used)
    return r
  end
  local function onSet(n, fn)
    if not n or not itemSet or n == curSet then return fn() end
    itemSet.useSecondWeaponSet = (n == 2)
    build.buildFlag = true
    local ok, res = pcall(function()
      if tab.input then tab.input.skill_number = index end
      return fn(buildCalcs())
    end)
    itemSet.useSecondWeaponSet = (curSet == 2)
    build.buildFlag = true
    if tab.input and prevSkill then tab.input.skill_number = prevSkill end
    pcall(buildCalcs)
    if not ok then return nil, res end
    return res
  end
  -- the skill PoB already calculated on the right set: read it without building anything
  if prevSkill == index and (not wantSet or wantSet == curSet) and tab.calcsEnv and tab.calcsEnv.player then
    return read(tab.calcsEnv)
  end
  if wantSet and wantSet ~= curSet then
    local res, err = onSet(wantSet, read)
    if not res then return { ok = false, error = tostring(err) } end
    return res
  end
  local ok, res = pcall(function()
    if tab.input then tab.input.skill_number = index end
    build.buildFlag = true
    return read(buildCalcs())
  end)
  if tab.input and prevSkill then tab.input.skill_number = prevSkill end
  build.buildFlag = true
  pcall(buildCalcs)
  if not ok then return { ok = false, error = tostring(res) } end
  return res
end

-- Critical hit chance / damage of the skill PoB calculates: base, then increased and more
local CRIT_STATS = { CritChance = true, CritMultiplier = true }
local function critSources(player, stat)
  local ms = player.mainSkill
  local list = ms and ms.skillModList
  if not list or not ms.skillCfg then return { ok = false, error = "no main skill" } end
  local cfg = ms.skillCfg
  local entries = {}
  local ok, tab = pcall(function() return list:Tabulate(nil, cfg, stat) end)
  if ok and type(tab) == "table" then
    for _, e in ipairs(tab) do
      if e.mod then entries[#entries + 1] = { type = e.mod.type, value = e.value, source = e.mod.source } end
    end
  end
  local out = {
    ok = true, stat = stat, kind = "crit",
    total = num(player.output and player.output[stat]),
    groups = groupEntries(entries),
    steps = plainLines(player.breakdown and player.breakdown[stat]),
    skill = ms.activeEffect and ms.activeEffect.grantedEffect and ms.activeEffect.grantedEffect.name or nil,
  }
  if stat == "CritChance" then
    -- Where the base comes from is decided by PoB (CalcOffence): a spell starts from the skill's
    -- own crit chance (source = skillData), an attack from the weapon (source = weaponData), and
    -- a crit chance the skill defines itself wins in both cases. Reading the weapon first made a
    -- caster show its wand's 5% instead of the spell's base.
    local skillCrit = num(ms.skillData and ms.skillData.CritChance)
    local weaponCrit = num(player.weaponData1 and player.weaponData1.CritChance)
    local attack = false
    pcall(function()
      local eff = ms.activeEffect
      local flags = eff and ((eff.statSetCalcs and eff.statSetCalcs.skillFlags) or (eff.statSet and eff.statSet.skillFlags))
      attack = (flags and flags.attack) and true or false
    end)
    local baseCrit, fromWeapon
    if skillCrit and skillCrit > 0 then
      baseCrit, fromWeapon = skillCrit, false
    elseif attack and weaponCrit then
      baseCrit, fromWeapon = weaponCrit, true
    else
      baseCrit, fromWeapon = 0, false -- a spell that defines no base crit has none, weapon or not
    end
    local add = num(list:Sum("BASE", cfg, "CritChance")) or 0
    local inc = num(list:Sum("INC", cfg, "CritChance")) or 0
    local more = num(list:More(cfg, "CritChance")) or 1
    -- "Inevitable Critical Hits" support: every hit counts as a critical, so the sheet shows 100%
    -- however low the chance it computed (PoB adds the same line to its breakdown)
    local inevitable = false
    pcall(function() inevitable = list:Flag(cfg, "InevitableCriticalHits") and true or false end)
    out.crit = { base = baseCrit, fromWeapon = fromWeapon, isAttack = attack, inevitable = inevitable,
      add = add, inc = inc, more = more, cap = 100,
      raw = (baseCrit + add) * (1 + inc / 100) * more }
  else
    local base = num(list:Sum("BASE", cfg, "CritMultiplier")) or 0
    local inc = num(list:Sum("INC", cfg, "CritMultiplier")) or 0
    local more = num(list:More(cfg, "CritMultiplier")) or 1
    local eb = num(player.enemy and player.enemy.modDB:Sum("BASE", nil, "SelfCritMultiplier")) or 0
    local ei = 1 + (num(player.enemy and player.enemy.modDB:Sum("INC", nil, "SelfCritMultiplier")) or 0) / 100
    out.crit = { base = base, inc = inc, more = more, enemyBase = eb, enemyInc = ei,
      raw = 1 + (base / 100 * (1 + inc / 100) * more + eb / 100) * ei }
  end
  return out
end

-- Spirit: where it comes from, and which skills reserve it
local function spiritSources(player, output)
  local groups = player.modDB and tabulate(player.modDB, { "Spirit" }) or {}
  local socketGroups = (build.skillsTab and build.skillsTab.socketGroupList) or {}
  local used = {}
  local function slotFor(name)
    for i, g in ipairs(socketGroups) do
      if not used[i] then
        for _, gem in ipairs(g.gemList or {}) do
          local nm = gem.nameSpec or (gem.grantedEffect and gem.grantedEffect.name)
          if nm == name then used[i] = true; return g.slot end
        end
      end
    end
  end
  local list, sum = {}, 0
  local r = player.breakdown and player.breakdown.SpiritReserved and player.breakdown.SpiritReserved.reservations
  for _, e in ipairs(r or {}) do
    local v = num(e.total) or num(e.base)
    if v and v ~= 0 then
      list[#list + 1] = { name = tostring(e.skillName), value = v, slot = slotFor(e.skillName) }
      sum = sum + v
    end
  end
  table.sort(list, function(a, b) return a.value > b.value end)
  return {
    ok = true, stat = "Spirit", kind = "spirit", total = num(output.Spirit),
    groups = groups, reserved = num(output.SpiritReserved), free = num(output.SpiritUnreserved),
    reservations = list, reservedTotal = sum,
  }
end

local function sources(req)
  local tab = build.calcsTab
  local env = (tab.calcsEnv and next(tab.calcsEnv)) and tab.calcsEnv or tab.mainEnv or {}
  local player = env.player or {}
  local output = player.output or tab.mainOutput or {}
  local stat = tostring(req.stat or "")
  -- "SkillDPS#3@2": skill 3, calculated on weapon set 2
  local skillIndex, setSuffix = stat:match("^SkillDPS#(%d+)@(%d)$")
  if not skillIndex then skillIndex = stat:match("^SkillDPS#(%d+)$") end
  if skillIndex then
    local wantSet = tonumber(setSuffix) or tonumber(req.weaponSet) or nil
    return skillSources(tonumber(skillIndex), "SkillDPS#" .. skillIndex, wantSet)
  end
  local maxHitType = MAX_HIT_STAT[stat]
  if maxHitType then return maxHitSources(player, output, stat, maxHitType) end
  if stat == "MovementSpeed" then return moveSources(player, output) end
  if stat == "Spirit" then return spiritSources(player, output) end
  if CRIT_STATS[stat] then return critSources(player, stat) end
  if DAMAGE_STATS[stat] then return damageSources(player, output, stat) end
  local spec = STAT_SPECS[stat]
  if not spec then return { ok = false, error = "no sources for " .. stat } end

  local out = player.modDB and tabulate(player.modDB, spec) or {}
  -- armour / evasion / energy shield / ward mostly come from the items themselves, not modifiers
  local slots = player.breakdown and player.breakdown[stat] and player.breakdown[stat].slots
  if type(slots) == "table" then
    for _, slot in ipairs(slots) do
      local base = tonumber(slot.base)
      if base and base ~= 0 then
        local info = slot.source == "Global" and { kind = "base" } or { kind = "item", name = slot.sourceName or slot.source }
        out[#out + 1] = { kind = info.kind, name = info.name, flat = base, inc = 0, more = {} }
      end
    end
    table.sort(out, function(a, b) return (SRC_RANK[a.kind] or 9) < (SRC_RANK[b.kind] or 9) end)
  end

  local total = tonumber(output[stat])
  -- the mana share is stored per damage type (shared + one of each), so add up what a hit can meet
  if stat == "MindOverMatter" then
    local shared = num(output.sharedMindOverMatter) or 0
    local per = 0
    for _, dt in ipairs({ "Physical", "Fire", "Cold", "Lightning", "Chaos" }) do
      per = math.max(per, num(output[dt .. "MindOverMatter"]) or 0)
    end
    total = shared + per
  end
  local steps = player.breakdown and player.breakdown[stat]
  return {
    ok = true, stat = stat, total = total,
    steps = plainLines(type(steps) == "table" and steps or nil),
    groups = out
  }
end




-- Flip the whole build to the other weapon set: its weapons and its set-only passives. Everything
-- PoB reports from then on (life, resistances, damage) is calculated on that set.
local function useWeaponSet(n)
  local set = build.itemsTab and build.itemsTab.activeItemSet
  if not set then return { ok = false, error = "this build has no weapon sets" } end
  set.useSecondWeaponSet = (n == 2)
  build.buildFlag = true
  -- "MAIN" is the pass that fills the sheet's numbers (life, resistances, the main skill's damage);
  -- "CALCS" only fills the Calcs tab's own output
  local env = build.calcsTab.calcs.buildOutput(build, "MAIN")
  build.calcsTab.mainEnv = env
  build.calcsTab.mainOutput = env.player.output
  local r = summary()
  r.weaponSets = weaponSetsInfo()
  return r
end

reply(enc({ ready = true, version = launch and launch.versionNumber or nil }))

while true do
  local line = io.read("*l")
  if not line then break end
  local req = dkjson.decode(line)
  local id = req and req.id
  local ok, res = pcall(function()
    if req.cmd == "load" then
      local xml = tostring(req.xml or "")
      if not xml:match("^%s*<%?xml[^>]*>%s*<PathOfBuilding2[%s>]") and not xml:match("^%s*<PathOfBuilding2[%s>]") then
        if xml:match("<PathOfBuilding[%s>]") then return { ok = false, error = "That's a Path of Building build for Path of Exile 1. Export it from Path of Building 2 (PoE2) instead." } end
        return { ok = false, error = "That isn't a Path of Building 2 build." }
      end
      -- PoB's XML reader quietly accepts a cut-off export as an empty character
      if not xml:match("</PathOfBuilding2>%s*$") then return { ok = false, error = "That build looks cut off (the export code wasn't copied whole). Copy it again from Path of Building 2." } end
      if mainObject then mainObject.promptMsg = nil end
      loadBuildFromXML(xml, req.name or "build")
      local msg = mainObject and mainObject.promptMsg
      if msg then
        mainObject.promptMsg = nil
        msg = tostring(msg):gsub("%^%d", ""):gsub("%^x%x%x%x%x%x%x", "")
        return { ok = false, error = "Path of Building couldn't load this build: " .. msg }
      end
      if not (build and build.spec and build.calcsTab and build.calcsTab.mainOutput) then return { ok = false, error = "Path of Building couldn't load this build." } end
      return summary()
    elseif req.cmd == "equip" then
      local done = equip(req.items)
      local r = summary(); r.equipped = done
      return r
    elseif req.cmd == "query" then
      return genQuery(req)
    elseif req.cmd == "summary" then
      return summary()
    elseif req.cmd == "eval" then
      return { ok = true, results = evalItems(req.items or {}) }
    elseif req.cmd == "passivetree" then
      return passivetree()
    elseif req.cmd == "sources" then
      return sources(req)
    elseif req.cmd == "weaponset" then
      return useWeaponSet(tonumber(req.set) or 1)
    elseif req.cmd == "weaponprobe" then
      return weaponProbe(req)
    elseif req.cmd == "sheet" then
      return sheet()
    elseif req.cmd == "quit" then
      os.exit(0)
    end
    return { ok = false, error = "unknown command" }
  end)
  if not ok then res = { ok = false, error = tostring(res) } end
  res.id = id
  reply(enc(res))
end
