// Diagram PIN editor server — hand-tune the tube-map diagram's junction layout.
// Companion to diagram_internal.js (the octolinear tube-map diagram engine).
//
//   cd <town S4 run dir>          # has the data jsons + gen_internal.js + routes.json
//   node <assets>\diagram_edit.js [runDir] [port]   -> http://localhost:5180
//
// Shows the rendered internal-diagram.svg with a draggable handle on every
// solved JUNCTION. Dragging stages a PIN (a strong solver spring); the diagram
// re-solves live so you see the real result, not a wireframe. Nothing touches
// the run dir until Save, which writes diagram-layout.json (copy it into
// S3-config like overrides.json — it is re-applied on every regenerate and
// pins re-resolve by stored lat/lon if a data refresh changes node keys).
// Right-click a pinned handle to clear its pin. Zero dependencies.
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawnSync } = require('child_process');
const { scratchDir } = require('./scratch');

const RUN = path.resolve(process.argv[2] || process.cwd());
const PORT = +(process.argv[3] || 5180);
if (!fs.existsSync(path.join(RUN, 'routes.json'))) { console.error('no routes.json in ' + RUN); process.exit(1); }
const DIAG = path.join(__dirname, 'diagram_internal.js');

// preview sandbox: a temp copy of the run dir's inputs, so previews never
// touch the real outputs (same principle as edit-server.js's temp overrides)
const TMP = scratchDir('diagram-edit-');
for (const f of fs.readdirSync(RUN)) {
  if (!/\.(json|js)$/.test(f)) continue;
  try { if (fs.statSync(path.join(RUN, f)).isFile()) fs.copyFileSync(path.join(RUN, f), path.join(TMP, f)); } catch (e) { }
}
console.log('preview sandbox: ' + TMP);

function solve(dir, pins) {
  if (pins != null) fs.writeFileSync(path.join(dir, 'diagram-layout.json'), JSON.stringify({ pins }, null, 1));
  const res = spawnSync(process.execPath, [DIAG], { cwd: dir, env: process.env, encoding: 'utf8' });
  if (res.status !== 0) return { err: (res.stderr || '') + (res.stdout || '') };
  const wd = path.join(dir, 'diagram');
  return {
    svg: fs.readFileSync(path.join(dir, 'internal-diagram.svg'), 'utf8'),
    nodes: JSON.parse(fs.readFileSync(path.join(wd, 'solved-nodes.json'), 'utf8')),
    log: res.stdout
  };
}
const readPins = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'diagram-layout.json'), 'utf8')).pins || {}; } catch (e) { return {}; } };

const HTML = `<!doctype html><meta charset="utf-8"><title>Diagram pin editor</title>
<style>
 body{margin:0;font:13px system-ui;display:flex;flex-direction:column;height:100vh}
 #bar{padding:6px 10px;background:#1e2a38;color:#fff;display:flex;gap:10px;align-items:center;flex:0 0 auto}
 #bar button{font:13px system-ui;padding:4px 12px;border-radius:4px;border:0;cursor:pointer}
 #save{background:#2e9e44;color:#fff} #reset{background:#c94f4f;color:#fff}
 #status{opacity:.85} #wrap{flex:1;overflow:auto;background:#888;display:grid;place-items:center}
 #board{position:relative;background:#fff;box-shadow:0 0 12px #0006}
 #board svg{display:block}
 #ovl{position:absolute;inset:0}
 .jn{fill:#ffffff;stroke:#c00;stroke-width:.5;cursor:grab;opacity:.85}
 .jn.pinned{fill:#c00}
 .jn:hover{stroke-width:.9}
</style>
<div id=bar>
 <b>Diagram pin editor</b>
 <button id=save>Save diagram-layout.json</button>
 <button id=reset>Clear all pins</button>
 <label><input type=checkbox id=show checked> show handles</label>
 <span id=status>ready</span>
 <span style="margin-left:auto;opacity:.7">drag a junction = pin it &nbsp;·&nbsp; right-click a red handle = unpin &nbsp;·&nbsp; preview re-solves on drop</span>
</div>
<div id=wrap><div id=board>
 <div id=svgbox></div>
 <svg id=ovl viewBox="0 0 297 210" preserveAspectRatio="xMidYMid meet"></svg>
</div></div>
<script>
let nodes={}, pins={}, dirty=false;
const S=6.5;                                  // board scale (px per mm)
const board=document.getElementById('board');
board.style.width=(297*S)+'px'; board.style.height=(210*S)+'px';
const box=document.getElementById('svgbox'), ovl=document.getElementById('ovl');
const status=t=>document.getElementById('status').textContent=t;
function setSvg(t){ box.innerHTML=t; const s=box.querySelector('svg');
  s.removeAttribute('width'); s.removeAttribute('height');
  s.style.width=(297*S)+'px'; s.style.height=(210*S)+'px'; }
function mm(ev){ const p=ovl.createSVGPoint(); p.x=ev.clientX; p.y=ev.clientY;
  const q=p.matrixTransform(ovl.getScreenCTM().inverse()); return [q.x,q.y]; }
function drawHandles(){
  ovl.innerHTML='';
  if(!document.getElementById('show').checked) return;
  for(const k in nodes){ const n=nodes[k];
    const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx',n.x); c.setAttribute('cy',n.y); c.setAttribute('r',1.6);
    c.setAttribute('class','jn'+(pins[k]?' pinned':''));
    c.dataset.k=k;
    c.addEventListener('pointerdown',startDrag);
    c.addEventListener('contextmenu',ev=>{ev.preventDefault(); delete pins[k]; dirty=true; preview();});
    ovl.appendChild(c);
  }
}
let drag=null;
function startDrag(ev){ ev.preventDefault();
  drag={k:ev.target.dataset.k, el:ev.target};
  ev.target.setPointerCapture(ev.pointerId);
  ev.target.addEventListener('pointermove',moveDrag);
  ev.target.addEventListener('pointerup',endDrag,{once:true});
}
function moveDrag(ev){ if(!drag)return; const [x,y]=mm(ev);
  drag.el.setAttribute('cx',x); drag.el.setAttribute('cy',y); drag.pos=[x,y]; }
function endDrag(ev){ if(!drag)return;
  drag.el.removeEventListener('pointermove',moveDrag);
  if(drag.pos){ const n=nodes[drag.k];
    pins[drag.k]={x:+drag.pos[0].toFixed(2), y:+drag.pos[1].toFixed(2), ll:n.ll};
    dirty=true; preview(); }
  drag=null;
}
async function preview(){ status('solving…');
  const r=await fetch('/preview',{method:'POST',body:JSON.stringify({pins})}).then(r=>r.json());
  if(r.err){ status('ERROR — see console'); console.error(r.err); return; }
  nodes=r.nodes; setSvg(r.svg); drawHandles(); status(Object.keys(pins).length+' pin(s)'+(dirty?' (unsaved)':''));
}
document.getElementById('save').onclick=async()=>{ status('saving…');
  const r=await fetch('/save',{method:'POST',body:JSON.stringify({pins})}).then(r=>r.json());
  if(r.err){ status('SAVE FAILED'); console.error(r.err); return; }
  dirty=false; status('saved diagram-layout.json + re-generated');
};
document.getElementById('reset').onclick=()=>{ pins={}; dirty=true; preview(); };
document.getElementById('show').onchange=drawHandles;
window.addEventListener('beforeunload',e=>{ if(dirty){e.preventDefault(); e.returnValue='';} });
fetch('/state').then(r=>r.json()).then(r=>{ nodes=r.nodes; pins=r.pins||{}; setSvg(r.svg); drawHandles();
  status(Object.keys(pins).length+' pin(s)'); });
</script>`;

const server = http.createServer((req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  const readBody = cb => { let b = ''; req.on('data', d => b += d); req.on('end', () => cb(b)); };
  if (req.method === 'GET' && req.url === '/') return send(200, 'text/html', HTML);
  if (req.method === 'GET' && req.url === '/state') {
    const pins = readPins(RUN);
    const r = solve(TMP, pins);
    if (r.err) return send(500, 'application/json', JSON.stringify(r));
    return send(200, 'application/json', JSON.stringify({ svg: r.svg, nodes: r.nodes, pins }));
  }
  if (req.method === 'POST' && req.url === '/preview') return readBody(b => {
    const r = solve(TMP, (JSON.parse(b || '{}').pins) || {});
    send(r.err ? 500 : 200, 'application/json', JSON.stringify(r.err ? r : { svg: r.svg, nodes: r.nodes }));
  });
  if (req.method === 'POST' && req.url === '/save') return readBody(b => {
    const pins = (JSON.parse(b || '{}').pins) || {};
    fs.writeFileSync(path.join(RUN, 'diagram-layout.json'), JSON.stringify({ pins }, null, 1));
    const r = solve(RUN, null);           // regenerate the real outputs with the saved pins
    send(r.err ? 500 : 200, 'application/json', JSON.stringify(r.err ? r : { ok: 1 }));
  });
  send(404, 'text/plain', 'not found');
});
server.listen(PORT, () => console.log('diagram pin editor: http://localhost:' + PORT + '  (run dir: ' + RUN + ')'));
