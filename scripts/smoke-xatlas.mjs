import createXAtlas from 'xatlas-wasm';

// A cube with duplicated vertices per face (like our OBJ subset: corners carry identity)
// Positions array (welded duplicates allowed)
const positions = new Float32Array(24 * 3);
const uvs = new Float32Array(24 * 2);
let p = 0;
function P(x, y, z) { positions[p*3]=x; positions[p*3+1]=y; positions[p*3+2]=z; p++; }
// 6 faces x 4 corners, cube of size 1 centered
const faces = [];
function quad(a,b,c,d){ faces.push(a,b,c, a,c,d); }
P(-1,-1,-1);P( 1,-1,-1);P( 1, 1,-1);P(-1, 1,-1); quad(0,1,2,3);          // front
P( 1,-1, 1);P(-1,-1, 1);P(-1, 1, 1);P( 1, 1, 1); quad(4,5,6,7);          // back
P( 1,-1,-1);P( 1,-1, 1);P( 1, 1, 1);P( 1, 1,-1); quad(8,9,10,11);        // right
P(-1,-1, 1);P(-1,-1,-1);P(-1, 1,-1);P(-1, 1, 1); quad(12,13,14,15);      // left
P(-1, 1,-1);P( 1, 1,-1);P( 1, 1, 1);P(-1, 1, 1); quad(16,17,18,19);      // top
P(-1,-1, 1);P( 1,-1, 1);P( 1,-1,-1);P(-1,-1,-1); quad(20,21,22,23);      // bottom
for (let i=0;i<24;i++){ uvs[i*2] = (i%2); uvs[i*2+1] = Math.floor(i/2)%2; }
const indices = Uint32Array.from(faces);

const xa = await createXAtlas();
const atlas = xa.createAtlas();
const err = atlas.addMesh({ positions, uvs, indices });
console.log('addMesh err:', err, xa.addMeshErrorString(err));
atlas.generate();
console.log('wh:', atlas.width, atlas.height, 'charts:', atlas.chartCount);
const m = atlas.getMesh(0);
console.log('verts:', m.vertexCount, 'idx:', m.indexCount, 'charts:', m.chartCount);
for (let i=0;i<Math.min(8,m.vertices.length);i++){
  const v=m.vertices[i];
  console.log('v', i, 'uv', v.uv.map(x=>x.toFixed(3)).join(','), 'xref', v.xref, 'chart', v.chartIndex);
}
console.log('first indices:', Array.from(m.indices.slice(0,12)));
console.log('chart0 faces len:', m.charts[0]?.faceCount, Array.from(m.charts[0]?.faces ?? []));
// Check: input tri count vs output
console.log('tri in/out:', indices.length/3, m.indexCount/3);
atlas.destroy();
