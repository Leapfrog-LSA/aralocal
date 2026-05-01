// Next.js standalone output places .next/static and public/ alongside server.js
// at runtime — but `next build --output standalone` only copies server.js +
// hoisted node_modules, not the static assets. Copy them in so the spawned
// server can serve them.
//
// See: https://nextjs.org/docs/app/api-reference/next-config-js/output#caveats

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const standalone = path.join(root, "frontend", ".next", "standalone");
const nextDir = path.join(standalone, ".next");
const publicSrc = path.join(root, "frontend", "public");
const publicDest = path.join(standalone, "public");
const staticSrc = path.join(root, "frontend", ".next", "static");
const staticDest = path.join(nextDir, "static");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(standalone)) {
  console.log(
    "[stage-frontend] standalone dir not found — did `next build` run?",
  );
  process.exit(0);
}

copyDir(publicSrc, publicDest);
copyDir(staticSrc, staticDest);
console.log("[stage-frontend] staged public/ and .next/static into standalone/");
