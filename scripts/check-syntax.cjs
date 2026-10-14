const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error("No inline application scripts found");
scripts.forEach((match, index) => {
  if (match[1].trim()) {
    try { new Function(match[1]); }
    catch (error) { throw new Error("Inline script " + (index + 1) + ": " + error.message); }
  }
});
for (const file of ["desktop/main.cjs", "scripts/build-web.cjs"]) {
  new Function(fs.readFileSync(file, "utf8"));
}
for (const file of ["package.json", "capacitor.config.json", "manifest.webmanifest"]) {
  JSON.parse(fs.readFileSync(file, "utf8"));
}
console.log("Luma inline scripts, desktop shell, and configuration checks passed.");
