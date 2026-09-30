import createXAtlas from 'xatlas-wasm';
const xa = await createXAtlas();

// welded cube: 8 verts, 12 tris
const P = new Float32Array([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, 1,-1,1, -1,-1,1, -1,1,1, 1,1,1]);
const I = Uint32Array.from([0,1,2,0,2,3, 4,5,6,4,6,7, 1,4,7,1,7,2, 5,0,3,5,3,6, 3,2,7,3,7,6, 5,4,1,5,1,0]);
let atlas = xa.createAtlas();
let err = atlas.addMesh({ positions: P, indices: I });
console.log('welded cube addMesh:', err);
atlas.generate();
let m = atlas.getMesh(0);
console.log('welded cube out verts:', m.vertexCount, '(expect split at seams, >8)');
// show that each tri corner resolves an xref that matches the *input* tri corner
let ok = 0;
for (let t=0;t<12;t++) for(let j=0;j<3;j++){
  const outIdx = m.indices[t*3+j];
  if (m.vertices[outIdx].xref === I[t*3+j]) ok++;
}
console.log('corner xref matches input tri corners:', ok, '/36');
atlas.destroy();

// non-manifold: 3 triangles sharing edge (0,1)
atlas = xa.createAtlas();
const P2 = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,1, -1,1,0]);
const I2 = Uint32Array.from([0,1,2, 0,1,3, 0,1,4]);
err = atlas.addMesh({ positions: P2, indices: I2 });
console.log('nonmanifold addMesh:', err, xa.addMeshErrorString(err));
try {
  atlas.generate();
  m = atlas.getMesh(0);
  console.log('nonmanifold output verts:', m.vertexCount, 'charts:', m.chartCount);
  let good = 0;
  for (let t=0;t<3;t++) for(let j=0;j<3;j++){
    if (m.vertices[m.indices[t*3+j]].xref === I2[t*3+j]) good++;
  }
  console.log('nonmanifold corner matches:', good, '/9');
} catch(e) {
  console.log('nonmanifold THREW:', e.message);
}
atlas.destroy();

// degenerate triangle: zero-area
atlas = xa.createAtlas();
const P3 = new Float32Array([0,0,0, 1,0,0, 1,0,0, 0,1,0]);
const I3 = Uint32Array.from([0,1,2, 0,2,3]);
err = atlas.addMesh({ positions: P3, indices: I3 });
console.log('degenerate addMesh:', err);
atlas.generate();
m = atlas.getMesh(0);
for(let i=0;i<m.vertexCount;i++) console.log(' deg v', i, m.vertices[i].uv.map(v=>v.toFixed(2)).join(','), 'xref', m.vertices[i].xref);
atlas.destroy();
