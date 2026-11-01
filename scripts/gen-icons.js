/* 生成摆摊记账的 PNG 图标（纯 Node，无第三方依赖） */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function drawIcon(size) {
  const W = size, H = size;
  const buf = Buffer.alloc(W * H * 4); // 全透明
  const orange = [234, 88, 12, 255];
  const white = [255, 255, 255, 255];
  const s = size / 512;

  function setPx(x, y, c) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
  }
  function inRoundRect(x, y, x0, y0, w, h, r) {
    const x1 = x0 + w - 1, y1 = y0 + h - 1;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return dx * dx + dy * dy <= r * r;
  }
  function rr(x0, y0, w, h, r, c) {
    const X0 = Math.round(x0 * s), Y0 = Math.round(y0 * s);
    const Ww = Math.round(w * s), Hh = Math.round(h * s), R = Math.round(r * s);
    for (let y = Y0; y < Y0 + Hh; y++) {
      for (let x = X0; x < X0 + Ww; x++) {
        if (inRoundRect(x, y, X0, Y0, Ww, Hh, R)) setPx(x, y, c);
      }
    }
  }

  rr(0, 0, 512, 512, 96, orange);          // 背景
  rr(64, 88, 48, 128, 6, white);           // 雨棚条纹
  rr(160, 88, 48, 128, 6, white);
  rr(256, 88, 48, 128, 6, white);
  rr(352, 88, 48, 128, 6, white);
  rr(64, 204, 384, 14, 7, white);          // 雨棚下沿
  rr(96, 330, 320, 64, 16, white);         // 柜台
  rr(136, 394, 24, 56, 8, white);          // 腿
  rr(352, 394, 24, 56, 8, white);

  return buf;
}

const outDir = path.join(__dirname, '..', 'icons');
[192, 512, 180].forEach((size) => {
  const png = encodePNG(size, size, drawIcon(size));
  const name = size === 180 ? 'icon-180.png' : 'icon-' + size + '.png';
  fs.writeFileSync(path.join(outDir, name), png);
  console.log('written', name, png.length, 'bytes');
});
