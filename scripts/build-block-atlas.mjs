#!/usr/bin/env node
// Composes the voxel texture atlas consumed by the Android renderer.
//
// Two inputs, both replaceable without touching code:
//   - assets/block-textures/<pack>/blocks/*.png : the source textures
//   - assets/block-textures/block-mapping.json   : block id -> face texture names
//
// Adding a block or a material is a data change here, not a renderer change.
// The default pack is ProgrammerArt (CC0 1.0); any pack with 16x16 PNGs works.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { inflateSync, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mappingPath = join(root, "assets/block-textures/block-mapping.json");
const outputDir = join(root, "apps/android-ar-poc/app/src/main/assets/textures");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal 8-bit PNG reader: gray, RGB, palette, gray+alpha, RGBA. */
function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = Buffer.from(raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride));
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? line[index - channels] : 0;
      const up = previous[index];
      const upLeft = index >= channels ? previous[index - channels] : 0;
      let value = line[index];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[index] = value & 0xff;
    }
    previous = line;
    for (let column = 0; column < width; column += 1) {
      const source = column * channels;
      const target = (row * width + column) * 4;
      if (colorType === 0) {
        pixels[target] = line[source];
        pixels[target + 1] = line[source];
        pixels[target + 2] = line[source];
        pixels[target + 3] = 255;
      } else if (colorType === 2) {
        pixels[target] = line[source];
        pixels[target + 1] = line[source + 1];
        pixels[target + 2] = line[source + 2];
        pixels[target + 3] = 255;
      } else if (colorType === 3) {
        const entry = line[source] * 3;
        pixels[target] = palette[entry];
        pixels[target + 1] = palette[entry + 1];
        pixels[target + 2] = palette[entry + 2];
        pixels[target + 3] = transparency && line[source] < transparency.length ? transparency[line[source]] : 255;
      } else if (colorType === 4) {
        pixels[target] = line[source];
        pixels[target + 1] = line[source];
        pixels[target + 2] = line[source];
        pixels[target + 3] = line[source + 1];
      } else {
        pixels[target] = line[source];
        pixels[target + 1] = line[source + 1];
        pixels[target + 2] = line[source + 2];
        pixels[target + 3] = line[source + 3];
      }
    }
  }
  return { width, height, pixels };
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Minimal RGBA8 PNG writer (filter 0), enough for a pixel-art atlas. */
function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, row * stride + stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
const packDir = join(root, "assets/block-textures", mapping.pack ?? "programmerart", "blocks");

const textureNames = new Set();
for (const faces of Object.values(mapping.blocks)) {
  for (const name of Object.values(faces)) textureNames.add(name);
}
for (const name of mapping.extraTextures ?? []) textureNames.add(name);

const tiles = [...textureNames].sort();
const columns = Math.ceil(Math.sqrt(tiles.length));
const rows = Math.ceil(tiles.length / columns);
const tileSize = mapping.tileSize ?? 16;
const atlasWidth = columns * tileSize;
const atlasHeight = rows * tileSize;
const atlas = Buffer.alloc(atlasWidth * atlasHeight * 4);
const tileIndex = new Map();

tiles.forEach((name, index) => {
  const file = join(packDir, `${name}.png`);
  if (!existsSync(file)) throw new Error(`missing texture ${name}.png in ${packDir}`);
  const image = decodePng(readFileSync(file));
  if (image.width !== tileSize || image.height !== tileSize) {
    throw new Error(`texture ${name} is ${image.width}x${image.height}, expected ${tileSize}x${tileSize}`);
  }
  tileIndex.set(name, index);
  const originX = (index % columns) * tileSize;
  const originY = Math.floor(index / columns) * tileSize;
  for (let row = 0; row < tileSize; row += 1) {
    const from = row * tileSize * 4;
    const to = ((originY + row) * atlasWidth + originX) * 4;
    image.pixels.copy(atlas, to, from, from + tileSize * 4);
  }
});

const blockFaces = {};
for (const [blockId, faces] of Object.entries(mapping.blocks)) {
  blockFaces[blockId] = {};
  for (const [face, name] of Object.entries(faces)) blockFaces[blockId][face] = tileIndex.get(name);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "block-atlas.png"), encodePng(atlasWidth, atlasHeight, atlas));
writeFileSync(join(outputDir, "block-atlas.json"), JSON.stringify({
  schemaVersion: 1,
  pack: mapping.pack ?? "programmerart",
  tileSize,
  columns,
  rows,
  atlasWidth,
  atlasHeight,
  blocks: blockFaces,
}, null, 2) + "\n");

console.log(`atlas ${atlasWidth}x${atlasHeight}, ${tiles.length} tiles, ${Object.keys(blockFaces).length} blocks`);
