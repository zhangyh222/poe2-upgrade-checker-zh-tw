'use strict';

// A drawn passive route is the node list Path of Building traced for us, and
// "the shortest walk" is not the same thing as "a legal allocation". The walk can
// start on a node the build has not allocated, cross into another ascendancy, or
// need a cluster jewel that is not socketed. The draft may only take a route when
// that can be *proven*; when the rule or its data is missing the answer is
// "unverified", never a guess, and never a silent yes.
//
// Tree shape is what pob/server.lua passivetree() sends:
//   nodes: [ [id, x, y, name, flags, ascendancyName, stats], ... ]
//   edges: [ [a, b], ... ]
// flags: 1 notable, 2 keystone, 4 ascendancy, 8 allocated, 16 jewel socket,
//        32/64 per-weapon-set point.

const FLAG = {
  notable: 1,
  keystone: 2,
  ascendancy: 4,
  allocated: 8,
  jewelSocket: 16,
  set1: 32,
  set2: 64,
};

function readTree(tree) {
  const nodes = new Map();
  const list = (tree && Array.isArray(tree.nodes)) ? tree.nodes : [];
  for (const row of list) {
    if (!Array.isArray(row)) continue;
    const id = Number(row[0]);
    if (!Number.isFinite(id)) continue;
    nodes.set(id, {
      id,
      name: row[3] || '',
      flags: Number(row[4]) || 0,
      ascendancyName: row[5] || '',
    });
  }
  const adjacency = new Map();
  const edges = (tree && Array.isArray(tree.edges)) ? tree.edges : [];
  for (const edge of edges) {
    if (!Array.isArray(edge)) continue;
    const a = Number(edge[0]);
    const b = Number(edge[1]);
    if (!nodes.has(a) || !nodes.has(b)) continue;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }
  return { nodes, adjacency, jewels: (tree && tree.jewels) || null };
}

function flag(node, bit) { return (node.flags & bit) !== 0; }

// The player's ascendancy class, when the caller knows it. Without it an
// ascendancy node cannot be judged either way.
// Stable reason codes are the contract with the page and the draft: the detail
// (which node) is there for the log, the code is what a caller switches on.
const STABLE = {
  NO_TREE: 'TREE_MISSING',
  ASCENDANCY_UNKNOWN: 'ASCENDANCY_MISSING',
  JEWEL_UNKNOWN: 'JEWEL_DATA_MISSING',
  WEAPON_SET: 'WEAPON_SET_NODES',
};

function stableCodes(details) {
  const out = [];
  for (const d of details) {
    const code = STABLE[d.code] || d.code;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

function validatePath(input) {
  const { tree, path, ascendancy, weaponSet } = input || {};
  const ids = (Array.isArray(path) ? path : []).map(Number).filter(Number.isFinite);
  const reasons = [];
  const graph = readTree(tree);

  if (!graph.nodes.size) return { status: 'unverified', reasons: ['TREE_MISSING'], details: [], checked: 0 };
  if (!ids.length) return { status: 'invalid', reasons: ['EMPTY'], details: [], checked: 0 };

  // what the build already has; a route is legal relative to this
  const allocated = new Set();
  for (const [id, node] of graph.nodes) if (flag(node, FLAG.allocated)) allocated.add(id);

  let unverified = false;
  const invalidate = (code, node) => reasons.push({ code, node });

  const first = ids[0];
  if (!graph.nodes.has(first)) invalidate('UNKNOWN_NODE', first);
  else {
    const near = graph.adjacency.get(first) || new Set();
    let touched = false;
    for (const other of near) if (allocated.has(other)) { touched = true; break; }
    if (!allocated.has(first) && !touched) invalidate('NO_START', first);
  }

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const node = graph.nodes.get(id);
    if (!node) { invalidate('UNKNOWN_NODE', id); continue; }

    if (i > 0) {
      const near = graph.adjacency.get(id) || new Set();
      let touched = false;
      for (const other of near) if (allocated.has(other)) { touched = true; break; }
      if (!touched) invalidate('NOT_ADJACENT', id);
    }

    if (flag(node, FLAG.ascendancy)) {
      if (!ascendancy) { unverified = true; invalidate('ASCENDANCY_UNKNOWN', id); }
      else if (ascendancy !== node.ascendancyName) invalidate('WRONG_ASCENDANCY', id);
    }

    // A node behind a jewel socket is only reachable through a socketed jewel:
    // without the jewel data the walk cannot be proven, so it is unverified.
    if (flag(node, FLAG.jewelSocket) && !graph.jewels) { unverified = true; invalidate('JEWEL_UNKNOWN', id); }

    if (weaponSet && flag(node, weaponSet === 2 ? FLAG.set2 : FLAG.set1)) {
      // a point that belongs to the other weapon set is legal to take, but it does
      // not count for this one, so the cost the page quoted is not what is paid.
      unverified = true;
      invalidate('WEAPON_SET', id);
    }

    allocated.add(id);
  }

  const hasInvalid = reasons.some((r) => r.code !== 'ASCENDANCY_UNKNOWN' && r.code !== 'JEWEL_UNKNOWN' && r.code !== 'WEAPON_SET');
  const status = hasInvalid ? 'invalid' : (unverified ? 'unverified' : 'ok');
  return { status, reasons: stableCodes(reasons), details: reasons, checked: ids.length };
}

module.exports = { validatePath, FLAG };
