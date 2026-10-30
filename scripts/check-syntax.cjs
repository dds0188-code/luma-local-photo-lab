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
for (const file of ["desktop/main.cjs", "scripts/build-web.cjs", "sw.js"]) {
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
  ["AI lasso prompt-aware candidate scoring", "positiveAgreement*.35+negativeAgreement*.25"],
  ["AI lasso prompt coordinate mapping", "point[0]/Math.max(1,iw-1)*(maskW-1)"],
  ["AI area-lasso button binding", "querySelectorAll('[data-area-ai-lasso]')"],
  ["cached pattern-based cutout preview checkerboard", "ctx.createPattern(checkerboardTile,'repeat')"],
  ["checkerboard tile alignment", "tileCtx.fillRect(12,0,12,12);tileCtx.fillRect(0,12,12,12)"],
  ["direct mask-boundary rendering", "drawSelectionBoundary(maskCanvas,'rgba(217,243,107,.24)')"],
  ["reused selection boundary canvas", "selectionBoundaryCanvas||(selectionBoundaryCanvas=document.createElement('canvas'))"],
  ["precomputed relight layer position", "_x:Number(layer.x||0)/100,_y:Number(layer.y||0)/100"],
  ["precomputed relight intensity", "_strength:Number(layer.intensity||0)/100*.85"],
  ["per-pixel relight coordinate reuse", "const relightX=activeRelightLayers.length?x/Math.max(1,w-1):0"],
  ["image loading pipeline", "function loadFile(file,savedRecipe=null)"],
  ["asynchronous image decode hint", "img.decoding='async';img.onload=async()=>"],
  ["non-destructive export pipeline", "function exportImage(type,quality=94,scale=100,options={})"],
  ["crop-aware output pipeline", "function cropProcessedCanvas(source)"],
  ["undo/redo wiring", "$('undo').onclick=()=>travelEditorHistory('undo')"],
  ["histogram rendering", "function updateHistogram(source)"],
  ["HSL adjustment pipeline", "function applyHsl("],
  ["color grading pipeline", "function applyColorGrade("],
  ["mask layer rendering", "function renderMaskLayer("],
  ["desktop permission denial", "setPermissionRequestHandler"],
  ["desktop permission checks denied", "setPermissionCheckHandler"],
  ["desktop navigation guard", "will-navigate"],
  ["desktop embedded webview guard", "will-attach-webview"],
  ["desktop context isolation", "contextIsolation: true"],
  ["desktop renderer sandbox", "sandbox: true"],
];
for (const [label, marker] of requiredMarkers) {
  if (!html.includes(marker)) throw new Error("Missing required editor wiring: " + label);
}

const staticIdSet = new Set(staticIds);
const dynamicIdSet = new Set(["maskExposure", "maskSaturation"]);
const optionalIdSet = new Set(["togglePanelGroups"]);
const idBindingPattern = new RegExp("\\$\\(['\"]([^'\"]+)['\"]\\)", "g");
const directIdRefs = [...html.matchAll(idBindingPattern)].map(match => match[1]);
const missingBindings = [...new Set(directIdRefs)].filter(id =>
  !staticIdSet.has(id) && !dynamicIdSet.has(id) && !optionalIdSet.has(id)
);
if (missingBindings.length) {
  throw new Error("UI references missing DOM IDs: " + missingBindings.join(", "));
}
console.log("Luma syntax, static IDs, UI binding integrity, configuration, and editor regression-guard checks passed.");
