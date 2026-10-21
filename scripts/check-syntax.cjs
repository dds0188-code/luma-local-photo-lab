const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error("No inline application scripts found");

// Check static HTML IDs separately from JavaScript templates, where repeated template
// placeholders (for example id="area-") are not actual duplicate DOM IDs.
const staticMarkup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const staticIds = [...staticMarkup.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicateIds = [...new Set(staticIds.filter((id, index) => staticIds.indexOf(id) !== index))];
if (duplicateIds.length) throw new Error("Duplicate static HTML IDs: " + duplicateIds.join(", "));

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
// Guard the regressions repeatedly reported during mobile editing reviews.
// These checks verify the required wiring exists; they do not replace real-device testing.
const requiredMarkers = [
  ["fixed mobile photo preview", "#stage.stage{display:flex!important;position:fixed!important"],
  ["independently scrolling mobile controls", ".controls{display:block!important;position:fixed!important"],
  ["horizontal mobile submenu rails", "touch-action:pan-x!important;white-space:nowrap!important"],
  ["crop pointer-down handler", "cropOverlay.addEventListener('pointerdown'"],
  ["crop pointer-move handler", "cropOverlay.addEventListener('pointermove'"],
  ["relighting position overlay", "function drawRelightOverlay()"],
  ["AI smart-lasso implementation", "async function runAISmartLasso()"],
  ["AI area-lasso button binding", "querySelectorAll('[data-area-ai-lasso]')"],
  ["pattern-based cutout preview checkerboard", "ctx.createPattern(tile,'repeat')"],
  ["direct mask-boundary rendering", "drawSelectionBoundary(maskCanvas,'rgba(217,243,107,.24)')"],
];
for (const [label, marker] of requiredMarkers) {
  if (!html.includes(marker)) throw new Error("Missing required editor wiring: " + label);
}
console.log("Luma syntax, static IDs, configuration, and editor regression-guard checks passed.");
