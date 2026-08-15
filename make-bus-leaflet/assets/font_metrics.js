/*
 * font_metrics.js — Arial advance widths, in em units, baked at build time.
 *
 * WHY BAKED: the generators must stay deterministic and free of filesystem
 * dependence (changing-the-engine.md §1, invariants 5 and 4). Reading a font
 * file at render time would make output depend on which Arial is installed —
 * and the portal renders on a server that may have none.
 *
 * WHY IT EXISTS: label collision code used to guess width as
 * `text.length * size * 0.52` (gen_internal.js:648, :1485). Arial advances
 * span 0.222em ('i') to 0.944em ('W') — a factor of four — so the guess both
 * invented collisions (labels dropped that would have fitted) and missed real
 * ones (labels drawn over each other). See label-and-design-quality-plan.
 *
 * REGENERATE: node extract_font.js <charset.txt> font_metrics.js
 * (charset.txt = every character appearing in any shipped SVG's <text>).
 * Arial and Liberation Sans are metric-compatible, so these widths are correct
 * for a Linux renderer substituting Liberation Sans.
 *
 * Generated 2026-08-15 from Arial Version from C:/Windows/Fonts — 121 glyphs.
 */
'use strict';
const REGULAR = {"0":0.5562,"1":0.5562,"2":0.5562,"3":0.5562,"4":0.5562,"5":0.5562,"6":0.5562,"7":0.5562,"8":0.5562,"9":0.5562," ":0.2778,"!":0.2778,"\"":0.355,"#":0.5562,"$":0.5562,"%":0.8892,"&":0.667,"'":0.1909,"(":0.333,")":0.333,"*":0.3892,"+":0.584,",":0.2778,"-":0.333,".":0.2778,"/":0.2778,":":0.2778,";":0.2778,"<":0.584,"=":0.584,">":0.584,"?":0.5562,"@":1.0151,"A":0.667,"B":0.667,"C":0.7222,"D":0.7222,"E":0.667,"F":0.6108,"G":0.7778,"H":0.7222,"I":0.2778,"J":0.5,"K":0.667,"L":0.5562,"M":0.833,"N":0.7222,"O":0.7778,"P":0.667,"Q":0.7778,"R":0.7222,"S":0.667,"T":0.6108,"U":0.7222,"V":0.667,"W":0.9438,"X":0.667,"Y":0.667,"Z":0.6108,"[":0.2778,"\\":0.2778,"]":0.2778,"^":0.4692,"_":0.5562,"`":0.333,"a":0.5562,"b":0.5562,"c":0.5,"d":0.5562,"e":0.5562,"f":0.2778,"g":0.5562,"h":0.5562,"i":0.2222,"j":0.2222,"k":0.5,"l":0.2222,"m":0.833,"n":0.5562,"o":0.5562,"p":0.5562,"q":0.5562,"r":0.333,"s":0.5,"t":0.2778,"u":0.5562,"v":0.5,"w":0.7222,"x":0.5,"y":0.5,"z":0.5,"{":0.334,"|":0.2598,"}":0.334,"~":0.584,"£":0.5562,"©":0.7368,"®":0.7368,"°":0.3999,"·":0.333,"×":0.584,"à":0.5562,"á":0.5562,"ä":0.5562,"è":0.5562,"é":0.5562,"ñ":0.5562,"ó":0.5562,"ö":0.5562,"ú":0.5562,"ü":0.5562,"–":0.5562,"—":1,"‘":0.2222,"’":0.2222,"“":0.333,"”":0.333,"•":0.3501,"…":1,"€":0.5562,"→":1};
const BOLD = {"0":0.5562,"1":0.5562,"2":0.5562,"3":0.5562,"4":0.5562,"5":0.5562,"6":0.5562,"7":0.5562,"8":0.5562,"9":0.5562," ":0.2778,"!":0.333,"\"":0.4741,"#":0.5562,"$":0.5562,"%":0.8892,"&":0.7222,"'":0.2378,"(":0.333,")":0.333,"*":0.3892,"+":0.584,",":0.2778,"-":0.333,".":0.2778,"/":0.2778,":":0.333,";":0.333,"<":0.584,"=":0.584,">":0.584,"?":0.6108,"@":0.9751,"A":0.7222,"B":0.7222,"C":0.7222,"D":0.7222,"E":0.667,"F":0.6108,"G":0.7778,"H":0.7222,"I":0.2778,"J":0.5562,"K":0.7222,"L":0.6108,"M":0.833,"N":0.7222,"O":0.7778,"P":0.667,"Q":0.7778,"R":0.7222,"S":0.667,"T":0.6108,"U":0.7222,"V":0.667,"W":0.9438,"X":0.667,"Y":0.667,"Z":0.6108,"[":0.333,"\\":0.2778,"]":0.333,"^":0.584,"_":0.5562,"`":0.333,"a":0.5562,"b":0.6108,"c":0.5562,"d":0.6108,"e":0.5562,"f":0.333,"g":0.6108,"h":0.6108,"i":0.2778,"j":0.2778,"k":0.5562,"l":0.2778,"m":0.8892,"n":0.6108,"o":0.6108,"p":0.6108,"q":0.6108,"r":0.3892,"s":0.5562,"t":0.333,"u":0.6108,"v":0.5562,"w":0.7778,"x":0.5562,"y":0.5562,"z":0.5,"{":0.3892,"|":0.2798,"}":0.3892,"~":0.584,"£":0.5562,"©":0.7368,"®":0.7368,"°":0.3999,"·":0.333,"×":0.584,"à":0.5562,"á":0.5562,"ä":0.5562,"è":0.5562,"é":0.5562,"ñ":0.6108,"ó":0.6108,"ö":0.6108,"ú":0.6108,"ü":0.6108,"–":0.5562,"—":1,"‘":0.2778,"’":0.2778,"“":0.5,"”":0.5,"•":0.3501,"…":1,"€":0.5562,"→":1};
const FALLBACK = 0.556;   // 'n' — used for any character not in the table

// Width of `text` in mm at `size` mm, matching what the SVG renderer will draw.
function textWidth(text, size, bold) {
  const t = bold ? BOLD : REGULAR;
  let em = 0;
  for (const ch of String(text)) em += (ch in t) ? t[ch] : FALLBACK;
  return em * size;
}

// Cap height and descender as fractions of font size (Arial), for label boxes
// that hug the ink rather than the full em square.
const CAP_HEIGHT = 0.716;
const DESCENDER = 0.212;

module.exports = { textWidth, REGULAR, BOLD, FALLBACK, CAP_HEIGHT, DESCENDER };
