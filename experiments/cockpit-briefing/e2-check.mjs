// Host side of E2: read {doc} on stdin, expand semantic shorthands through the real builders, run the real checker.
import fs from 'node:fs';
import { PRESETS, checkBrief } from './brief-check.mjs';
const { doc } = JSON.parse(fs.readFileSync(0, 'utf8'));
if (doc && doc.radarSemantic) { doc.blocks = [...(doc.blocks ?? []), PRESETS.radar.build(doc.radarSemantic, doc)]; delete doc.radarSemantic; }
process.stdout.write(JSON.stringify({ doc, result: checkBrief(doc) }));
