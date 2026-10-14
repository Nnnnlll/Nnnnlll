/* 几何工具库自检 */
var GEO = require('/root/nnnnlll/game/fps/test/geo.js');
var THREE = require('/root/nnnnlll/game/fps/test/lib/three.min.js');

var fail = 0;
function ok(cond, label, extra) {
  if (!cond) fail++;
  console.log((cond ? '✅ ' : '❌ ') + label + (extra ? '  — ' + extra : ''));
}
function info(name, g) {
  g.computeBoundingBox();
  var b = g.boundingBox;
  var n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  var size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
  var pos = g.attributes.position, nan = 0;
  for (var i = 0; i < pos.count; i++) {
    if (!isFinite(pos.getX(i)) || !isFinite(pos.getY(i)) || !isFinite(pos.getZ(i))) nan++;
  }
  console.log(name + '  尺寸 ' + size.map(function (v) { return v.toFixed(3); }).join(' x ') +
    '  三角面 ' + Math.round(n) + '  NaN ' + nan);
  return { size: size, tri: Math.round(n), nan: nan };
}

console.log('===== 1. 圆角盒 =====');
var rb = info('圆角盒 0.50x0.40x0.30 r=0.06', GEO.roundedBox(0.5, 0.4, 0.3, 0.06, 4));
ok(Math.abs(rb.size[0] - 0.5) < 0.005 && Math.abs(rb.size[1] - 0.4) < 0.005 && Math.abs(rb.size[2] - 0.3) < 0.005,
  '尺寸精确 = 输入值', rb.size.map(function (v) { return v.toFixed(4); }).join('/'));
ok(rb.nan === 0, '无 NaN');

console.log('\n===== 2. 胶囊 =====');
var cap = info('胶囊 r=0.08 h=0.30', GEO.capsule(0.08, 0.08, 0.3, 10, 4));
ok(Math.abs(cap.size[0] - 0.16) < 0.005, '直径 = 2r', cap.size[0].toFixed(4));
ok(Math.abs(cap.size[1] - 0.46) < 0.005, '总高 = h + 2r', cap.size[1].toFixed(4));

console.log('\n===== 3. 椭球 =====');
var el = info('椭球 0.25x0.15x0.12', GEO.ellipsoid(0.25, 0.15, 0.12, 16, 12));
ok(Math.abs(el.size[0] - 0.5) < 0.005 && Math.abs(el.size[1] - 0.3) < 0.005, '半轴 → 全尺寸正确');

console.log('\n===== 4. 旋转体（头） =====');
var head = info('头 lathe', GEO.lathe([[0, 0.17], [0.09, 0.15], [0.15, 0.10], [0.17, 0.02],
  [0.16, -0.06], [0.12, -0.13], [0.06, -0.17], [0, -0.18]], 18));
ok(Math.abs(head.size[0] - 0.34) < 0.01, '头部直径 0.34m', head.size[0].toFixed(3));

console.log('\n===== 5. 线段距离（穿模判定用） =====');
var d1 = GEO.segSegDist(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.3, 0),
  new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, 0.6, 0));
ok(Math.abs(d1) < 1e-6, '首尾相接 → 距离 0', d1.toExponential(2));
var d2 = GEO.segSegDist(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.3, 0),
  new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(0.2, 0.3, 0));
ok(Math.abs(d2 - 0.2) < 1e-6, '平行相距 0.2 → 距离 0.2', d2.toFixed(4));

console.log('\n===== 6. 尺寸控制：用缩放保证不超过输入 =====');
var big = info('圆角盒 r 过大自动夹取 0.2x0.2x0.2 r=0.3', GEO.roundedBox(0.2, 0.2, 0.2, 0.3, 3));
ok(Math.abs(big.size[0] - 0.2) < 0.005, 'r 自动夹到半边长', big.size[0].toFixed(4));

console.log('\n===== 结论 =====');
console.log(fail === 0 ? '全部通过 ✅' : ('失败 ' + fail + ' 项 ❌'));
process.exit(fail === 0 ? 0 : 1);
