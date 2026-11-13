// Core game logic: level generation, rules, solver. Works in browser and Node.
(function (root) {
  'use strict';

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Difficulty curve for Journey levels.
  function levelConfig(n) {
    const colors = Math.min(14, 5 + Math.floor((n - 1) / 5));
    let capacity = 4;
    if (n >= 26) capacity = 5;
    if (n >= 70 && n % 2 === 0) capacity = 6;
    let empties = 2;
    if (n >= 10 && n % 3 === 0) empties = 1;
    if (n >= 45 && n % 3 !== 1) empties = 1;
    const hidden = (n >= 15 && n % 2 === 1) || n >= 55;
    const moveLimit = n >= 30 && n % 4 === 2;
    const undoLimit = n >= 40 ? 5 : n >= 20 ? 10 : Infinity;
    return { n, colors, capacity, empties, hidden, moveLimit, undoLimit };
  }

  function dailyConfig(dateStr) {
    let h = 0;
    for (const c of dateStr) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
    const r = rng(h);
    return {
      n: 'daily', seedBase: h,
      colors: 11 + Math.floor(r() * 4),
      capacity: r() < 0.5 ? 4 : 5,
      empties: 2, hidden: true, moveLimit: true, undoLimit: 5,
    };
  }

  const isComplete = (t, cap) => t.length === cap && t.every((c) => c === t[0]);
  const isSolved = (tubes, cap) => tubes.every((t) => t.length === 0 || isComplete(t, cap));
  const top = (t) => t[t.length - 1];
  function topRun(t) {
    if (!t.length) return 0;
    let k = 1;
    while (k < t.length && t[t.length - 1 - k] === top(t)) k++;
    return k;
  }

  function canPour(tubes, from, to, cap) {
    if (from === to) return 0;
    const a = tubes[from], b = tubes[to];
    if (!a.length || b.length >= cap) return 0;
    if (b.length && top(b) !== top(a)) return 0;
    return Math.min(topRun(a), cap - b.length);
  }

  function pour(tubes, from, to, cap) {
    const k = canPour(tubes, from, to, cap);
    for (let i = 0; i < k; i++) tubes[to].push(tubes[from].pop());
    return k;
  }

  const keyOf = (tubes) => tubes.map((t) => t.join(',')).sort().join('|');

  // Depth-first solver with pruning. Returns list of [from,to] or null.
  function solve(start, cap, nodeLimit = 120000) {
    const tubes = start.map((t) => t.slice());
    const seen = new Set();
    const path = [];
    let nodes = 0;

    function moves() {
      const out = [];
      let emptyUsed = false;
      for (let i = 0; i < tubes.length; i++) {
        const a = tubes[i];
        if (!a.length || isComplete(a, cap)) continue;
        const run = topRun(a);
        const uniform = run === a.length;
        for (let j = 0; j < tubes.length; j++) {
          if (i === j) continue;
          const b = tubes[j];
          if (b.length === 0) {
            if (uniform) continue;
            out.push([i, j, 1]);
            continue;
          }
          const k = canPour(tubes, i, j, cap);
          if (!k) continue;
          let score = 3;
          if (b.length + k === cap && topRun(b) === b.length) score = 6; // completes tube
          else if (k === run) score = 4; // moves whole run
          if (k === run && run === a.length) score += 1; // empties a tube
          out.push([i, j, score]);
        }
      }
      // keep only first empty target per source
      const dedup = [];
      const seenEmptySrc = new Set();
      for (const m of out) {
        if (tubes[m[1]].length === 0) {
          if (seenEmptySrc.has(m[0])) continue;
          seenEmptySrc.add(m[0]);
        }
        dedup.push(m);
      }
      dedup.sort((x, y) => y[2] - x[2]);
      return dedup;
    }

    function dfs() {
      if (isSolved(tubes, cap)) return true;
      if (++nodes > nodeLimit) return false;
      const k = keyOf(tubes);
      if (seen.has(k)) return false;
      seen.add(k);
      for (const [i, j] of moves()) {
        const amt = pour(tubes, i, j, cap);
        path.push([i, j]);
        if (dfs()) return true;
        path.pop();
        for (let x = 0; x < amt; x++) tubes[i].push(tubes[j].pop());
        if (nodes > nodeLimit) return false;
      }
      return false;
    }

    return dfs() ? path.slice() : null;
  }

  function generate(cfg, seedBase) {
    const base = seedBase != null ? seedBase : cfg.n * 7919 + 13;
    let { colors, capacity, empties } = cfg;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (attempt === 40) empties++; // safety valve
      const r = rng(base + attempt * 104729);
      const pool = [];
      for (let c = 0; c < colors; c++) for (let k = 0; k < capacity; k++) pool.push(c);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const tubes = [];
      for (let c = 0; c < colors; c++) tubes.push(pool.slice(c * capacity, (c + 1) * capacity));
      // reject too-easy mixes: count adjacent same-colour pairs
      let pairs = 0;
      tubes.forEach((t) => { for (let i = 1; i < t.length; i++) if (t[i] === t[i - 1]) pairs++; });
      if (pairs > Math.max(1, Math.floor(colors / 4))) continue;
      for (let e = 0; e < empties; e++) tubes.push([]);
      const sol = solve(tubes, capacity);
      if (sol) return { tubes, capacity, empties, par: sol.length };
    }
    return null;
  }

  const api = { rng, levelConfig, dailyConfig, isComplete, isSolved, canPour, pour, topRun, solve, generate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this);
