"use strict";

// Minimal build helper that copies the EJS views and public assets from the
// TypeScript source tree into the compiled `dist/` tree so Node can serve them
// directly via `require.resolve('./views')` style paths. The TypeScript compiler
// only emits .js files, so we mirror the view/asset tree manually here.

const fs = require("fs");
const path = require("path");

const SRC_VIEWS = path.join(__dirname, "..", "src", "ui", "views");
const DST_VIEWS = path.join(__dirname, "..", "dist", "views");

const SRC_PUBLIC = path.join(__dirname, "..", "src", "ui", "public");
const DST_PUBLIC = path.join(__dirname, "..", "dist", "public");

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

copyDir(SRC_VIEWS, DST_VIEWS);
copyDir(SRC_PUBLIC, DST_PUBLIC);

console.log("[build] Copied views and public assets to dist/");
