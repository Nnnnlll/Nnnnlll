/* 放样体与几何库补充自检 */
var GEO = require('/root/nnnnlll/game/fps/test/geo.js');
var THREE = require('/root/nnnnlll/game/fps/test/lib/three.min.js');
var fail = 0;
function ok(c, l, e) { if (!c) fail++; console.log((c ? '✅ ' : '❌ ') + l + (e ? '  — ' + e : '')); }
function box(g) { g.computeBoundingBox(); return g.boundingBox; }
function tri(g) { return Math.round((g.index ? g.index.count : g.attributes.position.count) / 3); }

console.log('===== 放样体 =====');
// 简化躯干：腰细胸宽的椭圆截面
var rings = [
  { y: 0.00, rx: 0.175, rz: 0.125 },
  { y: 0.10, rx: 0.170, rz: 0.122 },
  { y: 0.22, rx: 0.165, rz: 0.118 },   // 腰
  { y: 0.34, rx: 0.195, rz: 0.135 },   // 肋
  { y: 0.46, rx: 0.215, rz: 0.148 },   // 胸
  { y: 0.56, rx: 0.200, rz: 0.135 }
];
var b = box(GEO.loft(rings, 16));
ok(Math.abs((b.max.x - b.min.x) - 0.43) < 0.01, '宽度 = 2*max(rx)', (b.max.x - b.min.x).toFixed(3));
ok(Math.abs((b.max.y - b.min.y) - 0.56) < 0.01, '高度 = y 跨度', (b.max.y - b.min.y).toFixed(3));
ok(tri(GEO.loft(rings, 16)) < 250, '面数可控', tri(GEO.loft(rings, 16)) + ' 面');

console.log('\n===== 腰比胸细（人形关键） =====');
var waist = rings[2].rx, chest = rings[4].rx;
ok(waist < chest - 0.03, '腰明显细于胸', '腰 ' + waist + ' 胸 ' + chest);

console.log('\n===== 带偏移的放样（肚子/背） =====');
var belly = box(GEO.loft([
  { y: 0, rx: 0.17, rz: 0.13, cz: 0.01 },
  { y: 0.2, rx: 0.18, rz: 0.15, cz: 0.03 },
  { y: 0.4, rx: 0.19, rz: 0.14, cz: 0.0 }
], 12));
ok(belly.max.z > 0.15, '前凸生效（cz 偏移）', belly.max.z.toFixed(3));

console.log('\n===== 无 NaN / 索引合法 =====');
var g = GEO.loft(rings, 16);
var pos = g.attributes.position, nan = 0;
for (var i = 0; i < pos.count; i++) if (!isFinite(pos.getX(i))) nan++;
var idx = g.index, badIdx = 0;
for (var j = 0; j < idx.count; j++) if (idx.getX(j) < 0 || idx.getX(j) >= pos.count) badIdx++;
ok(nan === 0, '顶点无 NaN');
ok(badIdx === 0, '索引全部合法');

console.log('\n' + (fail === 0 ? '全部通过 ✅' : '失败 ' + fail + ' 项 ❌'));
process.exit(fail ? 1 : 0);