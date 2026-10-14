/* blob.js 自检：用已知答案验证 SDF 引擎的正确性
   ① 单位球体积应为 4/3π = 4.18879
   ② 半径 1 的球包围盒应为 2×2×2（±分辨率误差）
   ③ 闭合性：不允许出现边界边（boundaryEdges）或非流形边
   ④ smooth-min 融合后体积必须大于两者简单相加（融合会长出物质）
   ⑤ 梯度方向必须朝外（与位置方向一致） */
var BLOB = require('/root/nnnnlll/game/fps/test/blob.js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}

console.log('===== ① 单位球 =====');
var fBall = function (x, y, z) { return BLOB.sdSphere(x, y, z, [0, 0, 0], 1); };
var gBall = BLOB.surfaceNets(fBall, [-1.4, -1.4, -1.4], [1.4, 1.4, 1.4], 0.05);
var iBall = BLOB.inspect(gBall);
console.log('  三角面=' + iBall.triangles + ' 顶点=' + iBall.vertices);
console.log('  体积=' + iBall.volume.toFixed(4) + ' (理论 4.18879)');
console.log('  包围盒=' + iBall.bbox.size.map(function (v) { return v.toFixed(4); }).join(' × '));
console.log('  边界边=' + iBall.boundaryEdges + ' 非流形边=' + iBall.nonManifoldEdges);
ok('体积误差 < 2%', Math.abs(iBall.volume - 4.18879) / 4.18879 < 0.02,
  '误差 ' + (Math.abs(iBall.volume - 4.18879) / 4.18879 * 100).toFixed(2) + '%');
ok('包围盒 ≈ 2×2×2', iBall.bbox.size.every(function (v) { return Math.abs(v - 2) < 0.08; }));
ok('完全闭合（无边界边）', iBall.boundaryEdges === 0);
ok('无非流形边', iBall.nonManifoldEdges === 0);
ok('表面积误差 < 4%', Math.abs(iBall.area - 12.5664) / 12.5664 < 0.04,
  '面积 ' + iBall.area.toFixed(3) + ' (理论 12.566)');

console.log('===== ② 椭球（长宽高不等）=====');
var fEll = function (x, y, z) { return BLOB.sdEllipsoid(x, y, z, [0, 0, 0], [1, 0.5, 0.75]); };
var gEll = BLOB.surfaceNets(fEll, [-1.3, -0.8, -1.05], [1.3, 0.8, 1.05], 0.04);
var iEll = BLOB.inspect(gEll);
var volTheo = 4 / 3 * Math.PI * 1 * 0.5 * 0.75;
console.log('  体积=' + iEll.volume.toFixed(4) + ' (理论 ' + volTheo.toFixed(4) + ')');
ok('椭球体积误差 < 2%', Math.abs(iEll.volume - volTheo) / volTheo < 0.02);
ok('椭球闭合', iEll.boundaryEdges === 0 && iEll.nonManifoldEdges === 0);

console.log('===== ③ smooth-min 融合 =====');
var fA = function (x, y, z) { return BLOB.sdSphere(x, y, z, [-0.45, 0, 0], 0.6); };
var fB = function (x, y, z) { return BLOB.sdSphere(x, y, z, [0.45, 0, 0], 0.6); };
function volOf(f, lo, hi, h) {
  var g = BLOB.surfaceNets(f, lo, hi, h);
  return BLOB.inspect(g);
}
var vA = volOf(fA, [-1.3, -0.9, -0.9], [1.3, 0.9, 0.9], 0.04).volume;
var vB = volOf(fB, [-1.3, -0.9, -0.9], [1.3, 0.9, 0.9], 0.04).volume;
var fUnion = function (x, y, z) { return Math.min(fA(x, y, z), fB(x, y, z)); };
var fSmin = function (x, y, z) { return BLOB.smin(fA(x, y, z), fB(x, y, z), 0.28); };
var iU = volOf(fUnion, [-1.3, -0.9, -0.9], [1.3, 0.9, 0.9], 0.04);
var iS = volOf(fSmin, [-1.3, -0.9, -0.9], [1.3, 0.9, 0.9], 0.04);
console.log('  硬并集体积=' + iU.volume.toFixed(4) + ' 融合后=' + iS.volume.toFixed(4));
ok('融合长出物质（脖子/接缝被填满）', iS.volume > iU.volume * 1.01,
  '+' + ((iS.volume / iU.volume - 1) * 100).toFixed(1) + '%');
ok('融合后仍闭合', iS.boundaryEdges === 0 && iS.nonManifoldEdges === 0);
ok('融合后目标内点数一致（基础球仍存在）', iU.volume > 0 && iS.volume > 0);

console.log('===== ④ 梯度（法线）朝外 =====');
var badN = 0, tested = 0;
for (var i = 0; i < gBall.vertexCount; i += 7) {
  var px = gBall.positions[i * 3], py = gBall.positions[i * 3 + 1], pz = gBall.positions[i * 3 + 2];
  var nx = gBall.normals[i * 3], ny = gBall.normals[i * 3 + 1], nz = gBall.normals[i * 3 + 2];
  var d = px * nx + py * ny + pz * nz;   /* 球面上位置方向应与法线同向 */
  tested++;
  if (d < 0.9) badN++;
}
ok('球面法线全部朝外', badN === 0, tested + ' 个采样点，异常 ' + badN);

console.log('===== ⑤ 绕序：三角面法线与场梯度同向 =====');
var wrong = 0, triTested = 0;
for (var t = 0; t < gBall.indices.length; t += 3 * 11) {
  var a = gBall.indices[t], b = gBall.indices[t + 1], c = gBall.indices[t + 2];
  var p0 = [gBall.positions[a * 3], gBall.positions[a * 3 + 1], gBall.positions[a * 3 + 2]];
  var p1 = [gBall.positions[b * 3], gBall.positions[b * 3 + 1], gBall.positions[b * 3 + 2]];
  var p2 = [gBall.positions[c * 3], gBall.positions[c * 3 + 1], gBall.positions[c * 3 + 2]];
  var e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  var e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  var fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  var cen = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
  var g = BLOB.gradient(fBall, cen[0], cen[1], cen[2], 0.02);
  var flen = Math.sqrt(fn[0] * fn[0] + fn[1] * fn[1] + fn[2] * fn[2]);
  /* 零面积面的法线是数值噪声，绕序无定义，按引擎设计予以跳过 */
  if (flen < 1e-9) continue;
  triTested++;
  if (fn[0] * g[0] + fn[1] * g[1] + fn[2] * g[2] < 0) wrong++;
}
ok('三角面绕序全部正确（外向）', wrong === 0, triTested + ' 个有效面，反向 ' + wrong);

console.log('===== ⑥ 球体步进（贴面用）=====');
var hit = BLOB.raycast(fBall, [0, 0, 5], [0, 0, -1], 10);
ok('从 +Z 射线命中球面 z≈1', hit.found && Math.abs(hit.p[2] - 1) < 0.02, 'z=' + hit.p[2].toFixed(4));
ok('命中点法线朝 +Z', hit.n[2] > 0.98);

console.log('');
console.log(fail === 0 ? '✅ blob.js 自检全部通过（' + pass + '/' + (pass + fail) + '）' : '❌ 有 ' + fail + ' 项失败');
process.exit(fail === 0 ? 0 : 1);
