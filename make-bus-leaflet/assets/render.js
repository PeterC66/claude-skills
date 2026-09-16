// Renders an SVG to a print-ready A4 landscape JPG at 300 dpi (3508x2480 px).
// Usage: node render.js input.svg output.jpg
const sharp = require('sharp');
const fs = require('fs');
function main() {   // OA-344: the body is guarded, not re-indented — see test/asset_load.test.js
const [,, inSvg, outJpg] = process.argv;
if (!inSvg || !outJpg) { console.error('usage: node render.js in.svg out.jpg'); process.exit(1); }
// The SVG must declare width="3508" height="2480" so sharp rasterises natively (crisp text).
sharp(fs.readFileSync(inSvg))
  .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
  .withMetadata({ density: 300 })
  .toFile(outJpg)
  .then(() => sharp(outJpg).metadata())
  .then(m => console.log(`${outJpg}: ${m.width}x${m.height}px @ ${m.density}dpi`))
  .catch(e => { console.error(e); process.exit(1); });
}

if (require.main === module) main();
module.exports = { main };
