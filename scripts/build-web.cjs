const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of ["index.html", "manifest.webmanifest", "sw.js"]) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}
fs.cpSync(path.join(root, "icons"), path.join(out, "icons"), { recursive: true });
console.log("Built shared Luma web app into dist/");
