/**
 * e_voxel_budget.js — 体素世界几何预算计算器（可复现，无第三方依赖）
 *
 * 目的：为「桌面 AR 微缩 MC」给出可信的 triangles / vertices / draw call / 显存 预算，
 * 而不是凭感觉写"大概几万个面"。
 *
 * 运行：node scripts/e_voxel_budget.js
 *
 * 世界模型：W x D 水平、H 高；地形用 2D 值噪声 + 分层（草/土/石），
 * 保证"有起伏、有暴露侧面"，接近真实 diorama 的几何分布。
 */

'use strict';

// ---------- 1. 一个确定性的 2D 值噪声（无依赖） ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise2D(seed) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) val[i] = rnd();
  const fade = t => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  return function (x, y) {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = val[perm[xi + perm[yi]]], ba = val[perm[xi + 1 + perm[yi]]];
    const ab = val[perm[xi + perm[yi + 1]]], bb = val[perm[xi + 1 + perm[yi + 1]]];
    return lerp(lerp(aa, ba, u), lerp(ab, bb, u), v);
  };
}

// ---------- 2. 生成体素世界 ----------
// 0 = 空气, 1 = 草, 2 = 土, 3 = 石
function genWorld(W, D, H, seed = 42, opts = {}) {
  const nz = makeNoise2D(seed);
  const nz2 = makeNoise2D(seed * 7 + 13);
  const world = new Uint8Array(W * D * H);
  const idx = (x, y, z) => (y * D + z) * W + x; // y 向上
  const heights = new Int32Array(W * D);
  const base = Math.floor(H * 0.45);
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      // 三层噪声叠加，做出小丘
      let n = nz(x / 9, z / 9) * 0.6 + nz2(x / 4.5, z / 4.5) * 0.3 + nz(x / 2.2, z / 2.2) * 0.1;
      let h = base + Math.round((n - 0.5) * (H * 0.55));
      h = Math.max(2, Math.min(H - 2, h));
      heights[z * W + x] = h;
      for (let y = 0; y < h; y++) {
        const depth = h - 1 - y;
        world[idx(x, y, z)] = depth === 0 ? 1 : depth <= 3 ? 2 : 3;
      }
    }
  }
  // 挖一个 3x3 的洞（模拟"露天矿坑"，产生额外的可见面）
  if (opts.pit !== false) {
    const cx = Math.floor(W / 2), cz = Math.floor(D / 2);
    for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) {
      const h = heights[z * W + x];
      for (let y = h - 4; y < h; y++) if (y >= 0) world[idx(x, y, z)] = 0;
    }
  }
  // 种几棵树（树干 + 3x3x2 叶冠），产生非地形几何
  if (opts.trees !== false) {
    const treeCount = Math.max(2, Math.floor(W * D / 220));
    for (let t = 0; t < treeCount; t++) {
      const tx = 3 + Math.floor(nz(t * 3.7, 1.1) * (W - 6));
      const tz = 3 + Math.floor(nz(2.3, t * 5.1) * (D - 6));
      const th = heights[tz * W + tx];
      if (th + 6 >= H) continue;
      for (let y = th; y < th + 4; y++) world[idx(tx, y, tz)] = 4; // 树干
      for (let dy = 3; dy <= 5; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx, y = th + dy, z = tz + dz;
        if (x < 0 || z < 0 || x >= W || z >= D || y >= H) continue;
        if (world[idx(x, y, z)] === 0) world[idx(x, y, z)] = 5; // 树叶
      }
    }
  }
  return { world, idx, heightAt: (x, z) => heights[z * W + x] };
}

// ---------- 3. 三种渲染策略的几何量 ----------
const FACE_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** 策略 A：每个非空方块一个 InstancedMesh 实例（6 面全渲染，不做面剔除） */
function budgetInstanced(W, D, H, world, idx) {
  let solid = 0;
  for (let i = 0; i < world.length; i++) if (world[i] !== 0) solid++;
  // 单位立方体 6 面 = 12 三角形 / 24 顶点（独立面法线需拆点）
  return {
    name: 'InstancedMesh(每方块1实例, 6面全渲染)',
    instances: solid,
    drawCalls: 6,                       // 按材质/面朝向分组：6 个 InstancedMesh
    triangles: solid * 12,
    vertices: solid * 24,
    note: 'CPU 侧极省（1 次矩阵更新/方块），GPU 侧有 ~2/3 隐藏面浪费；透明排序困难'
  };
}

/** 策略 B：逐方块、仅渲染暴露面，每面独立 4 顶点（不合并共面） */
function budgetPerFace(W, D, H, world, idx) {
  let faces = 0;
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (world[idx(x, y, z)] === 0) continue;
    for (const [dx, dy, dz] of FACE_DIRS) {
      const nx = x + dx, ny = y + dy, nz2 = z + dz;
      const out = nx < 0 || ny < 0 || nz2 < 0 || nx >= W || ny >= H || nz2 >= D;
      if (out || world[idx(nx, ny, nz2)] === 0) faces++;
    }
  }
  return {
    name: '仅暴露面 + 面不合并（每面4顶点）',
    faces,
    drawCalls: 1,                        // 合成一个 BufferGeometry + 一个图集材质
    triangles: faces * 2,
    vertices: faces * 4,
    indices: faces * 6,
    note: '顶点数约为 greedy 的 4 倍，但实现最简单、UV 可任意裁切'
  };
}

/** 策略 C：greedy meshing（贪心合并同材质共面矩形） */
function budgetGreedy(W, D, H, world, idx) {
  let quads = 0;
  // 分别沿三个轴做 2D greedy
  const axes = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]; // [法线轴, u, v]
  const dims = [W, H, D];
  for (const [na, ua, va] of axes) {
    const nd = dims[na], ud = dims[ua], vd = dims[va];
    for (let n = 0; n < nd; n++) {
      // 两个方向的切片都要合并：正向 (+n) 和反向 (-n)
      for (const dir of [1, -1]) {
        const mask = new Int32Array(ud * vd);
        for (let v = 0; v < vd; v++) for (let u = 0; u < ud; u++) {
          const p = [0, 0, 0]; p[na] = n; p[ua] = u; p[va] = v;
          const q = [0, 0, 0]; q[na] = n + dir; q[ua] = u; q[va] = v;
          const inA = p[0] >= 0 && p[1] >= 0 && p[2] >= 0 && p[0] < W && p[1] < H && p[2] < D;
          const inB = q[0] >= 0 && q[1] >= 0 && q[2] >= 0 && q[0] < W && q[1] < H && q[2] < D;
          const a = inA ? world[idx(p[0], p[1], p[2])] : 0;
          const b = inB ? world[idx(q[0], q[1], q[2])] : 0;
          // 该面可见的条件：a 实、b 空（dir>0 时法线朝 +n）
          mask[v * ud + u] = (a !== 0 && b === 0) ? a * dir : 0;
        }
        // greedy 合并
        for (let v = 0; v < vd; v++) {
          for (let u = 0; u < ud;) {
            const m = mask[v * ud + u];
            if (m === 0) { u++; continue; }
            let w = 1;
            while (u + w < ud && mask[v * ud + u + w] === m) w++;
            let h = 1;
            outer: while (v + h < vd) {
              for (let k = 0; k < w; k++) if (mask[(v + h) * ud + u + k] !== m) break outer;
              h++;
            }
            for (let dv = 0; dv < h; dv++) for (let du = 0; du < w; du++) mask[(v + dv) * ud + u + du] = 0;
            quads++;
            u += w;
          }
        }
      }
    }
  }
  return {
    name: 'greedy meshing(贪心合并共面)',
    quads,
    drawCalls: 1,
    triangles: quads * 2,
    vertices: quads * 4,
    indices: quads * 6,
    note: '顶点最省；但纹理必须在图集内平铺(UV>1 需 repeat/atlas 技巧)，且编辑一个方块要重建整块 mesh'
  };
}

// ---------- 4. 内存换算 ----------
const BYTES = {
  pos3f: 12, normal3f: 12, uv2f: 8, color3u8: 3, // 顶点属性
};
function vramMB(vertices, indices) {
  const v = vertices * (BYTES.pos3f + BYTES.normal3f + BYTES.uv2f);
  const i = indices * 4; // Uint32
  return (v + i) / 1048576;
}

// ---------- 5. 跑几个典型尺寸 ----------
const configs = [
  { label: '16 x 16 x 8   (一小块草坪岛)', W: 16, D: 16, H: 8 },
  { label: '32 x 32 x 16  (目标 diorama)', W: 32, D: 32, H: 16 },
  { label: '48 x 48 x 24  (想做大一点)', W: 48, D: 48, H: 24 },
  { label: '64 x 64 x 32  (激进)', W: 64, D: 64, H: 32 },
];

const lines = [];
lines.push('体素世界几何预算（确定性噪声地形 + 1 个矿坑 + 若干树，seed=42）');
lines.push('');
const HDR = ['世界尺寸', '非空方块', '暴露面', 'InstancedMesh三角形', '暴露面三角形', 'greedy四边形', 'greedy三角形', 'greedy顶点缓冲', '面数节省'];
lines.push('| ' + HDR.join(' | ') + ' |');
lines.push('|' + HDR.map(function () { return '---'; }).join('|') + '|');

const detail = [];
for (const c of configs) {
  const { world, idx } = genWorld(c.W, c.D, c.H);
  const A = budgetInstanced(c.W, c.D, c.H, world, idx);
  const B = budgetPerFace(c.W, c.D, c.H, world, idx);
  const C = budgetGreedy(c.W, c.D, c.H, world, idx);
  const mbB = vramMB(B.vertices, B.indices || B.vertices * 1.5);
  const mbC = vramMB(C.vertices, C.indices || C.vertices * 1.5);
  const save = ((1 - C.quads / B.faces) * 100).toFixed(1);
  lines.push(`| ${c.W}x${c.D}x${c.H} | ${A.instances} | ${B.faces} | ${A.triangles} | ${B.triangles} | ${C.quads} | ${C.triangles} | ${mbC.toFixed(2)} MB | ${save}% 面数 |`);
  detail.push({ c, A, B, C, mbB, mbC });
}

console.log(lines.join('\n'));
console.log('\n--- 单配置明细 ---');
for (const d of detail) {
  console.log(`\n[${d.c.label}]`);
  console.log(`  A ${d.A.name}: instances=${d.A.instances} drawCalls=${d.A.drawCalls} tris=${d.A.triangles}`);
  console.log(`  B ${d.B.name}: faces=${d.B.faces} drawCalls=${d.B.drawCalls} tris=${d.B.triangles} verts=${d.B.vertices} vram=${d.mbB.toFixed(2)}MB`);
  console.log(`  C ${d.C.name}: quads=${d.C.quads} drawCalls=${d.C.drawCalls} tris=${d.C.triangles} verts=${d.C.vertices} vram=${d.mbC.toFixed(2)}MB`);
}

// ---------- 6. 动态实体（角色/粒子）占比估算 ----------
console.log('\n--- 附加对象（按目标 diorama 的清单估） ---');
const extra = [
  ['2 个 Q 版角色 (VRM/glTF, 每只 ~15k tris)', 2 * 15000, 2],
  ['房子骨架 (木板/门洞/火把) greedy 后', 1200, 1],
  ['箱子 + TNT + 花 + 草 (合并为一个 mesh)', 900, 1],
  ['阴影贴图渲染 pass', 0, 0],
  ['弹幕字幕 (DOM 或 canvas 精灵)', 40, 1],
];
let extraTris = 0, extraDC = 0;
for (const [n, t, d] of extra) { console.log(`  ${n}: ${t} tris, ${d} drawCalls`); extraTris += t; extraDC += d; }
console.log(`  合计: ${extraTris} tris, ${extraDC} drawCalls`);

// 目标世界 32x32x16 的总账
const target = detail.find(d => d.c.W === 32);
if (target) {
  const totalTris = target.C.triangles + extraTris;
  const totalDC = target.C.drawCalls + extraDC;
  console.log(`\n=== 32x32x16 目标世界总账 ===`);
  console.log(`  体素 greedy: ${target.C.triangles} tris / ${target.C.drawCalls} DC`);
  console.log(`  附加对象:    ${extraTris} tris / ${extraDC} DC`);
  console.log(`  合计:        ${totalTris} tris / ${totalDC} DC  → 含阴影 pass 再 x2 三角形 ≈ ${totalTris * 2}`);
}
