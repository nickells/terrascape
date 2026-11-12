// Optional geometry preparation for large library seeds. Output stays plain GLB:
// no additional decoder is needed in Terrascape's browser or ray tracer.
import { NodeIO } from '@gltf-transform/core';
import { weld, simplify, prune, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [input, output, target = '80000'] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/simplify_model.mjs input.glb output.glb [triangle-budget]');
await MeshoptSimplifier.ready;
const io = new NodeIO();
const document = await io.read(input);
const count = () => document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n,p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount())/3, 0), 0);
const original = count();
if (original > Number(target)) {
  await document.transform(weld(), simplify({simplifier:MeshoptSimplifier, ratio:Number(target)/original, error:.001}), prune());
}
await io.write(output, document);
const bounds = getBounds(document.getRoot().listScenes()[0]);
console.log(JSON.stringify({original_polycount:original, polycount:count(), min:bounds.min, max:bounds.max}));
