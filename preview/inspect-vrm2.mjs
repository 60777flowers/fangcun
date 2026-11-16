import fs from 'node:fs';
const file = process.argv[2];
const buf = fs.readFileSync(file);
let off = 12, json = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  if (type === 0x4E4F534A) json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
  off += 8 + len + ((4 - (len % 4)) % 4);
}
const g = json;

// ---- 尾巴/非 humanoid 骨骼 ----
const nodeNames = (g.nodes || []).map((n, i) => n.name || `node${i}`);
const tailish = nodeNames.filter(n => /tail|wei?ba|shippo|尾/i.test(n));
console.log('节点总数:', nodeNames.length);
console.log('尾巴相关节点:', tailish.length, tailish.slice(0, 20).join(', ') || '(无)');

// ---- spring bone ----
const sb = g.extensions?.VRMC_springBone?.springs || [];
console.log('spring 链数:', sb.length, '（关节合计', sb.reduce((a, s) => a + (s.joints?.length || 0), 0), '）');
sb.slice(0, 10).forEach((s, i) => {
  const j0 = s.joints?.[0]?.node;
  console.log(`  链${i}: ${s.joints?.length} 节, 根=${nodeNames[j0] ?? j0}`);
});

// ---- 贴图尺寸（PNG 头）----
const binStart = (() => { let o = 12; while (o < buf.length) { const len = buf.readUInt32LE(o), t = buf.readUInt32LE(o + 4); if (t === 0x004E4942) return o + 8; o += 8 + len + ((4 - (len % 4)) % 4); } })();
console.log('\n贴图尺寸:');
for (const im of g.images || []) {
  const bv = g.bufferViews[im.bufferView];
  const d = buf.subarray(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + Math.min(bv.byteLength, 64));
  let dim = '?';
  if (d[0] === 0x89 && d[1] === 0x50) { // PNG
    dim = `${d.readUInt32BE(16)}×${d.readUInt32BE(20)}`;
  } else if (d[0] === 0xFF && d[1] === 0xD8) { // JPEG: scan SOF
    let p = 2, w = 0, h = 0;
    const all = buf.subarray(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + bv.byteLength);
    while (p < all.length - 9) {
      if (all[p] !== 0xFF) { p++; continue; }
      const m = all[p + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { h = all.readUInt16BE(p + 5); w = all.readUInt16BE(p + 7); break; }
      p += 2 + all.readUInt16BE(p + 2);
    }
    dim = w ? `${w}×${h}` : 'jpeg';
  }
  const vram = (() => { const m = dim.match(/(\d+)×(\d+)/); return m ? ((+m[1] * +m[2] * 4) / 1048576).toFixed(1) : '?'; })();
  console.log(`  ${(im.name || im.mimeType).padEnd(28)} ${dim.padEnd(12)} ${(bv.byteLength / 1048576).toFixed(2)} MB   RGBA显存≈${vram} MB`);
}

// ---- 材质 ----
console.log('\n材质:');
for (const m of g.materials || []) {
  const mt = m.extensions?.VRMC_materials_mtoon;
  console.log(`  ${m.name}  doubleSided=${m.doubleSided}  mtoon=${!!mt}  alphaMode=${m.alphaMode || 'OPAQUE'}`);
}
