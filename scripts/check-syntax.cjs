const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");
const start = html.indexOf("<script");
const bodyStart = html.indexOf(">", start) + 1;
const end = html.indexOf("</script>", bodyStart);
if (start < 0 || bodyStart <= 0 || end < 0) throw new Error("Main application script was not found");
new Function(html.slice(bodyStart, end));
for (const file of ["desktop/main.cjs", "scripts/build-web.cjs"]) {
  new Function(fs.readFileSync(file, "utf8"));
}
JSON.parse(fs.readFileSync("package.json", "utf8"));
JSON.parse(fs.readFileSync("capacitor.config.json", "utf8"));
JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8"));
console.log("Luma syntax and configuration checks passed.");
