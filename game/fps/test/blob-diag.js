/* 诊断：体积 NaN 到底从哪来 */
var BLOB = require('/root/nnnnlll/game/fps/test/blob.js');
function f(x, y, z) { return BLOB.sdSphere(x, y, z, [0, 0, 0], 1); }
var g = BLOB.surfaceNets(f, [-1.4, -1.4, -1.4], [1.4, 1.4, 1.4], 0.05);

var maxI = -1, minI = 1e18, firstBig = -1;
for (var i = 0; i < g.indices.length; i++) {
  var v = g.indices[i];
  if (v > maxI) maxI = v;
  if (v < minI) minI = v;
  if (v > g.vertexCount - 1 && firstBig < 0) firstBig = i;
}
var nanPos = 0, firstNaN = -1;
for (var j = 0; j < g.positions.length; j++) {
  if (isFinite(g.positions[j]) === false) { nanPos++; if (firstNaN < 0) firstNaN = j; }
}
console.log('vertexCount      =', g.vertexCount);
console.log('positions.length =', g.positions.length);
console.log('indices.length   =', g.indices.length);
console.log('index 范围       =', minI, '~', maxI);
console.log('首个越界索引位置 =', firstBig);
console.log('非有限坐标个数   =', nanPos, ' 首个位置 =', firstNaN);