// Drag-to-override editor server for the bus leaflets (zero dependencies).
//
//   cd <town S4 run dir>            (has the data jsons + gen_*.js + routes.json)
//   node "<skill>/assets/edit-server.js" internal      (or: external)
//
// Opens a browser editor at http://localhost:5179 . Drag stops / POIs / termini,
// straighten a run of stops on ONE route (per-route, so other routes are not
// dragged), spread / recolour routes, edit linear features, zoom, undo. Edits are
// staged in the browser and PREVIEWED live (POST /preview, nothing written) until
// you click Save (POST /save), which writes overrides.json IN THE CURRENT DIR.
// Then copy it to your S3-config and re-run S4 to bake it into the real
// deliverable. The editor only authors overrides.json; the shipped image still
// comes from gen_*.js + render.js.
const http = require('http'); const fs = require('fs'); const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const MAP = (process.argv[2] || 'internal').toLowerCase() === 'external' ? 'external' : 'internal';
// run dir: 3rd CLI arg or EDITOR_DIR env, else the current working directory
const DIR = process.argv[3] ? path.resolve(process.argv[3]) : (process.env.EDITOR_DIR || process.cwd());
const SKILL = __dirname;
const PORT = 5179;
const GEN = MAP === 'external'
  ? (fs.existsSync(path.join(DIR,'gen_external.js')) ? path.join(DIR,'gen_external.js') : path.join(SKILL,'gen_external_radial.js'))
  : (fs.existsSync(path.join(DIR,'gen_internal.js')) ? path.join(DIR,'gen_internal.js') : path.join(SKILL,'gen_internal.js'));
const SVG = path.join(DIR, MAP + '.svg');
const OVF = path.join(DIR, 'overrides.json');
const PREVIEW_OVF = path.join(os.tmpdir(), 'bus-leaflet-preview-'+process.pid+'.json');

function readOverrides(){ try{ return JSON.parse(fs.readFileSync(OVF,'utf8')); }catch(e){ return {}; } }
function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){ return null; } }

// Build a KEYED svg (EDITOR_KEYS=1) reading overrides from `ovFile` (or the run-dir
// overrides.json when null). Captures the exported viewport (internal) from stderr.
function build(ovFile){
  const env = {...process.env, EDITOR_KEYS:'1'};
  if(ovFile) env.OVERRIDES_FILE = ovFile;
  let vp = null;
  try{
    const r = require('child_process').spawnSync('node',[GEN],{cwd:DIR, env, encoding:'utf8'});
    const m = (r.stderr||'').match(/VIEWPORT (\{.*\})/); if(m) vp = JSON.parse(m[1]);
  }catch(e){ /* generator prints to stderr; svg still written if it succeeded */ }
  return { svg: fs.readFileSync(SVG,'utf8'), viewport: vp };
}

// Compose a full overrides object for a staged map section + top-level routeColors.
function compose(section, routeColors){
  const o = {};
  o[MAP] = section || {};
  if(routeColors && Object.keys(routeColors).length) o.routeColors = routeColors;
  return o;
}

function send(res,code,type,body){ res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store'}); res.end(body); }
function collect(req,cb){ let b=''; req.on('data',c=>b+=c); req.on('end',()=>cb(b)); }

const server = http.createServer((req,res)=>{
  if(req.url === '/' || req.url.startsWith('/?')){
    return send(res,200,'text/html', fs.readFileSync(path.join(SKILL,'override-editor.html'),'utf8'));
  }
  if(req.url === '/data'){
    const b = build(null);                       // preview reflecting the saved overrides.json
    const rj = readJSON(path.join(DIR,'routes.json')) || {};
    const data = {
      map: MAP,
      svg: b.svg,
      viewport: b.viewport,
      overrides: readOverrides(),                // full object incl. top-level routeColors
      palette: rj.palette || {},                 // colour-picker defaults
      routes: readJSON(path.join(DIR,'routes_atco.json')) || {},
      atco2name: readJSON(path.join(DIR,'atco2name.json')) || {}
    };
    return send(res,200,'application/json', JSON.stringify(data));
  }
  if(req.url === '/preview' && req.method === 'POST'){
    return collect(req,body=>{
      let posted; try{ posted = JSON.parse(body); }catch(e){ return send(res,400,'text/plain','bad json'); }
      try{ fs.writeFileSync(PREVIEW_OVF, JSON.stringify(compose(posted.section, posted.routeColors))); }
      catch(e){ return send(res,500,'text/plain','preview write failed'); }
      const b = build(PREVIEW_OVF);              // build from staged state, do NOT touch overrides.json
      try{ fs.unlinkSync(PREVIEW_OVF); }catch(e){}
      return send(res,200,'application/json', JSON.stringify({ ok:true, svg:b.svg, viewport:b.viewport }));
    });
  }
  if(req.url === '/save' && req.method === 'POST'){
    return collect(req,body=>{
      let posted; try{ posted = JSON.parse(body); }catch(e){ return send(res,400,'text/plain','bad json'); }
      const ov = readOverrides();
      ov[MAP] = posted.section || {};
      // top-level routeColors apply to BOTH maps; drop the key when empty to keep the file clean
      if(posted.routeColors && Object.keys(posted.routeColors).length) ov.routeColors = posted.routeColors;
      else delete ov.routeColors;
      // freeze the viewport the first time internal gains manual stop positions
      if(MAP==='internal'){
        const sec = ov.internal||{};
        const hasManual = (sec.stops && Object.keys(sec.stops).length)
          || (sec.routeStops && Object.keys(sec.routeStops).length)
          || (sec.align && sec.align.length);
        if(hasManual && !sec.viewport && posted.viewport){ sec.viewport = posted.viewport; ov.internal = sec; }
      }
      fs.writeFileSync(OVF, JSON.stringify(ov,null,2));
      const b = build(null);
      return send(res,200,'application/json', JSON.stringify({ ok:true, svg:b.svg, viewport:b.viewport }));
    });
  }
  send(res,404,'text/plain','not found');
});

server.listen(PORT, ()=>{
  const url = 'http://localhost:'+PORT+'/';
  console.log('Bus-leaflet override editor ['+MAP+']  '+url);
  console.log('  generator:', GEN);
  console.log('  overrides:', OVF, '(copy to S3-config + re-run S4 to bake)');
  if(process.env.BUS_EDITOR_NOOPEN==='1'){ console.log('  (auto-open disabled) open the URL above in your browser.'); return; }
  try{ execFileSync('cmd',['/c','start','""', url]); }catch(e){ console.log('  open the URL above in your browser.'); }
});
