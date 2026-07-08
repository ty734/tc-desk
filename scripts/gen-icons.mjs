// Generates the PWA/app icon set from an inline SVG (violet gradient + kanban columns).
// Run: node scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "fs";

const svg = (size, pad = 0) => `
<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#c026d3"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g fill="#ffffff" opacity="0.96">
    <rect x="${118 + pad}" y="150" width="64" height="150" rx="16"/>
    <rect x="${224 + pad}" y="150" width="64" height="212" rx="16"/>
    <rect x="${330 + pad}" y="150" width="64" height="110" rx="16"/>
  </g>
</svg>`;

mkdirSync("public", { recursive: true });

const jobs = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["src/app/apple-icon.png", 180],
  ["src/app/icon.png", 64],
];

for (const [out, size] of jobs) {
  await sharp(Buffer.from(svg(512))).resize(size, size).png().toFile(out);
  console.log(`${out} (${size}x${size})`);
}
