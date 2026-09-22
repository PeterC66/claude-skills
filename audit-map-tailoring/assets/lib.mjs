// Shared by every script in this skill: the estate, read once, the same way.
//
// The walk is NOT written here. It is `gate_lib.js`'s findTowns/findPlaces, the one
// enumeration the engine's conventions allow ("never write a readdirSync walk over
// Areas/ in a new tool"), required from the sibling make-bus-leaflet skill so the
// three standalone places under Places/_standalone are never silently left out.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const ENGINE = path.resolve(HERE, '..', '..', 'make-bus-leaflet', 'assets');
const gl = require(path.join(ENGINE, 'gate_lib.js'));
const cli = require(path.join(ENGINE, 'cli.js'));
export const { parseArgs, die, resolveBuses } = cli;

// Absent -> null; present but corrupt -> throws, naming the file (cli.readJson's rule:
// a fallback that also swallowed a syntax error would hide a corrupt config).
export const readJson = p => cli.readJson(p, null);

/** Every map on the board: towns, places under a town, standalone places. */
export function estate(buses) {
  const towns = gl.findTowns(buses);
  const places = gl.findPlaces(towns, buses);
  const maps = [
    ...towns.map(t => ({ name: t.name, kind: 'town', town: t.name, dir: t.dir })),
    ...places.map(p => ({ name: p.name, kind: p.standalone ? 'standalone place' : 'place', town: p.town, dir: p.dir })),
  ];
  for (const m of maps) {
    m.rel = path.relative(buses, m.dir).split(path.sep).join('/');
    m.manifest = readJson(path.join(m.dir, 'manifest.json'), {});
    const s3 = m.manifest.stages && m.manifest.stages.S3;
    m.s3Id = s3 && s3.latest;
    m.s3Dir = m.s3Id ? path.join(m.dir, 'S3-config', m.s3Id) : null;
    m.s3 = m.s3Dir ? readJson(path.join(m.s3Dir, 'routes.json')) : null;
    m.s3Files = m.s3Dir && fs.existsSync(m.s3Dir) ? fs.readdirSync(m.s3Dir) : [];
    m.ciDir = path.join(m.dir, 'ci-reference');
    m.ci = readJson(path.join(m.ciDir, 'routes.json'));
    m.ciFiles = fs.existsSync(m.ciDir) ? fs.readdirSync(m.ciDir) : [];
    m.s3Runs = (s3 && s3.runs) || [];
  }
  if (!maps.length) die(`no maps found under ${buses} — is --buses the estate root?`, 2);
  return maps;
}

export const short = m => m.kind === 'town' ? m.name : (m.town ? `${m.town} › ${m.name}` : m.name);
