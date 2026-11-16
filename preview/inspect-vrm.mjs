import fs from 'node:fs';

const file = process.argv[2];
const buf = fs.readFileSync(file);

// ---- GLB 容器解析 ----
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546c67) { console.log('NOT GLB/VRM'); process.exit(1); }
const version = buf.readUInt32LE(4);
const total = buf.readUInt32LE(8);
let off = 12, json = null, binLen = 0;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4E4F534A) json = JSON.parse(data.toString('utf8'));
  if (type === 0x004E4942) binLen = len;
  off += 8 + len + ((4 - (len % 4)) % 4);
}

const g = json;
const ext = g.extensions || {};
const vrm1 = ext.VRMC_vrm;
const vrm0 = ext.VRM;
const meta = vrm1?.meta || vrm0?.meta || {};

// ---- 三角面 ----
let tris = 0, verts = 0;
for (const m of g.meshes || []) for (const p of m.primitives || []) {
  const acc = g.accessors[p.indices];
  if (acc) tris += acc.count / 3;
  const pos = g.accessors[p.attributes.POSITION];
  if (pos) verts += pos.count;
}

// ---- 贴图体积（bufferView 长度）----
let texBytes = 0;
const texDetail = [];
for (const im of g.images || []) {
  const bv = g.bufferViews[im.bufferView];
  if (bv) { texBytes += bv.byteLength; texDetail.push(`${im.name || im.mimeType}: ${(bv.byteLength / 1048576).toFixed(2)}MB`); }
}

// ---- 包围盒高度 ----
let minY = Infinity, maxY = -Infinity, minYall = Infinity, maxYall = -Infinity;
for (const m of g.meshes || []) for (const p of m.primitives || []) {
  const acc = g.accessors[p.attributes.POSITION];
  if (acc?.min && acc?.max) {
    minYall = Math.min(minYall, acc.min[1]);
    maxYall = Math.max(maxYall, acc.max[1]);
  }
}

// ---- 骨骼 ----
const humanBones = vrm1?.humanoid?.humanBones || vrm0?.humanoid?.humanBones || {};
const boneNames = Object.keys(humanBones);

// ---- 材质/贴图数 ----
const out = {
  文件: file.split('/').pop(),
  容器: `GLB v${version}, ${(total / 1048576).toFixed(2)} MB (bin ${(binLen / 1048576).toFixed(2)} MB)`,
  VRM版本: vrm1 ? 'VRM 1.0 (VRMC_vrm)' : (vrm0 ? 'VRM 0.x (VRM)' : '不是 VRM（普通 glTF）'),
  生成器: g.asset?.generator,
  模型名: meta.name,
  作者: meta.authors || (meta.author ? [meta.author] : []),
  '许可·头像使用': meta.avatarPermission,
  '许可·可再分发': meta.allowRedistribution ?? meta.allowExcessivelyViolentUsage,
  '许可·可修改': meta.modification,
  '许可·商用': meta.commercialUsage ?? meta.commercialUssageName,
  '许可·署名要求': meta.creditNotation,
  '许可·许可证URL': meta.licenseUrl,
  三角面: Math.round(tris).toLocaleString(),
  顶点: verts.toLocaleString(),
  网格数: (g.meshes || []).length,
  材质数: (g.materials || []).length,
  贴图数: (g.images || []).length,
  贴图体积: `${(texBytes / 1048576).toFixed(2)} MB`,
  骨骼数: boneNames.length,
  有尾巴骨: boneNames.filter(b => /tail|wei?ba|shippo/i.test(b)).length,
  动画数: (g.animations || []).length,
  包围盒Y: `${minYall.toFixed(3)} .. ${maxYall.toFixed(3)}  (高 ${(maxYall - minYall).toFixed(3)})`,
  extensionsUsed: (g.extensionsUsed || []).join(', '),
};
console.log(JSON.stringify(out, null, 2));
console.log('\n--- 贴图明细 ---');
texDetail.forEach(d => console.log('  ' + d));
console.log('\n--- 骨骼（前 40）---');
console.log('  ' + boneNames.slice(0, 40).join(', '));
