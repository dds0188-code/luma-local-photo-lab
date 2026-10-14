const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist");
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of ["index.html", "manifest.webmanifest", "sw.js"]) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}
const builtIndex = path.join(out, "index.html");
const html = fs.readFileSync(builtIndex, "utf8");
const versionMeta = /<meta name="luma-app-version" content="[^"]*">/;
if (!versionMeta.test(html)) throw new Error("Luma app version meta tag is missing");
fs.writeFileSync(builtIndex, html.replace(versionMeta, '<meta name="luma-app-version" content="' + packageInfo.version + '">'));
fs.cpSync(path.join(root, "icons"), path.join(out, "icons"), { recursive: true });
console.log("Built Luma " + packageInfo.version + " into dist/");
