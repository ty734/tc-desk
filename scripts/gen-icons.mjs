// Generates the PWA/app icon set from the Living Well favicon (webp source
// pulled from the live store's Shopify CDN). Run: node scripts/gen-icons.mjs <source-image>
import sharp from "sharp";
import { mkdirSync } from "fs";

const src = process.argv[2] ?? "brand/lw-favicon-512.webp";

mkdirSync("public", { recursive: true });

const jobs = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["src/app/apple-icon.png", 180],
  ["src/app/icon.png", 64],
];

for (const [out, size] of jobs) {
  await sharp(src)
    .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(out);
  console.log(`${out} (${size}x${size})`);
}
