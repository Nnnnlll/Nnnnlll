var BLOB = require('/root/nnnnlll/game/fps/test/blob.js');
function f(x, y, z) { return BLOB.sdSphere(x, y, z, [0, 0, 0], 1); }
console.log('--- 外部起步：从 (0,0,5) 朝 -Z ---');
var d = [0, 0, -1];
var t = 0;
for (var i = 0; i < 14; i++) {
  var px = 0 + d[0] * t, py = 0 + d[1] * t, pz = 5 + d[2] * t;
  var dist = f(px, py, pz);
  console.log('  i=' + i + ' t=' + t.toFixed(8) + ' z=' + pz.toFixed(8) + ' dist=' + dist.toExponential(3));
  if (Math.abs(dist) < 1e-6) { console.log('  → 命中'); break; }
  t += Math.max(Math.abs(dist) * 0.9, 1e-4);
  if (t > 10) { console.log('  → 超限'); break; }
}
var hit = BLOB.raycast(f, [0, 0, 5], [0, 0, -1], 10);
console.log('raycast 结果:', JSON.stringify(hit));

console.log('--- 内部起步：从球心朝 +Z ---');
var hit2 = BLOB.raycast(f, [0, 0, 0], [0, 0, 1], 5);
console.log('raycast 结果:', JSON.stringify(hit2));

console.log('--- 内部起步：从球心朝 +Z（手动追踪）---');
var t2 = 0;
for (var j = 0; j < 16; j++) {
  var pz2 = 0 + t2;
  var dist2 = f(0, 0, pz2);
  console.log('  j=' + j + ' t=' + t2.toFixed(8) + ' dist=' + dist2.toExponential(3));
  if (Math.abs(dist2) < 1e-6) { console.log('  → 命中'); break; }
  t2 += Math.max(Math.abs(dist2) * 0.9, 1e-4);
  if (t2 > 5) { console.log('  → 超限'); break; }
}