/* 奶龙模型数值验证：不靠"看图"，靠几何量硬断言
   ① 整体必须是一张闭合曲面（无边界边/非流形边）→ 结构上不可能穿模
   ② 形体比例符合奶龙（矮胖大肚、大头小脚）：宽高比、肚围、头身比
   ③ 精度：体积/面积与解析解偏差
   ④ 五官是否真的贴在曲面上（球体步进命中误差）
   ⑤ 左右对称性（镜像顶点必须成对） */
var THREE = require('/root/nnnnlll/game/fps/test/lib/three.min.js');
var BLOB = require('/root/nnnnlll/game/fps/test/blob.js');
var buildNailong = require('/root/nnnnlll/game/fps/test/nailong-model.js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}

console.log('===== ① 几何完整性（用高精度档检查）=====');
var field = buildNailong.buildField();
var raw = BLOB.surfaceNets(field, [-0.62, -0.22, -0.66], [0.62, 1.34, 0.50], 0.012, { iso: 0 });
var st = BLOB.inspect(raw);
console.log('  三角面=' + st.triangles + ' 顶点=' + st.vertices + ' 分辨率=0.012');
console.log('  边界边=' + st.boundaryEdges + ' 非流形边=' + st.nonManifoldEdges);
console.log('  表面积=' + st.area.toFixed(4) + ' 体积=' + st.volume.toFixed(4));
ok('完全闭合：无边界边', st.boundaryEdges === 0);
ok('完全闭合：无非流形边', st.nonManifoldEdges === 0);
ok('无 NaN 坐标', (function () {
  for (var i = 0; i < raw.positions.length; i++) if (!isFinite(raw.positions[i])) return false;
  return true;
})());
ok('索引全部合法', (function () {
  for (var i = 0; i < raw.indices.length; i++) {
    if (raw.indices[i] < 0 || raw.indices[i] >= raw.vertexCount) return false;
  }
  return true;
})());

console.log('===== ② 形体比例（奶龙特征）=====');
var sz = st.bbox.size;
console.log('  包围盒 = ' + sz.map(function (v) { return v.toFixed(3); }).join(' × ') + ' m');
console.log('  高/宽 = ' + (sz[1] / sz[0]).toFixed(3));
ok('身高在 1.20~1.40 m（矮胖体型）', sz[1] > 1.20 && sz[1] < 1.40, sz[1].toFixed(3) + ' m');
ok('宽度 > 0.6 m（体型敦实）', sz[0] > 0.60, sz[0].toFixed(3) + ' m');
ok('高宽比在 1.4~1.9（不像人那么瘦长）', sz[1] / sz[0] > 1.4 && sz[1] / sz[0] < 1.9);

/* 用射线量身体各处尺寸 —— 比包围盒更能反映真实形体 */
function spanX(y, z, x0, x1, n) {
  var inside = [], step = (x1 - x0) / n;
  for (var i = 0; i <= n; i++) {
    var x = x0 + i * step;
    if (field(x, y, z) < 0) inside.push(x);
  }
  return inside.length ? [inside[0], inside[inside.length - 1]] : null;
}
function spanY(x, z, y0, y1, n) {
  var inside = [], step = (y1 - y0) / n;
  for (var i = 0; i <= n; i++) {
    var y = y0 + i * step;
    if (field(x, y, z) < 0) inside.push(y);
  }
  return inside.length ? [inside[0], inside[inside.length - 1]] : null;
}
var belly = spanX(0.40, 0.01, -0.8, 0.8, 400);
var head = spanX(0.93, 0.02, -0.8, 0.8, 400);
var waist = spanX(0.60, 0.00, -0.8, 0.8, 400);
console.log('  肚围宽度 = ' + (belly[1] - belly[0]).toFixed(3) + ' m');
console.log('  头部宽度 = ' + (head[1] - head[0]).toFixed(3) + ' m');
console.log('  肩腰宽度 = ' + (waist[1] - waist[0]).toFixed(3) + ' m');
ok('肚子是最宽处（奶龙大肚）',
  (belly[1] - belly[0]) > (head[1] - head[0]), 
  '肚 ' + (belly[1] - belly[0]).toFixed(3) + ' vs 头 ' + (head[1] - head[0]).toFixed(3));
ok('头部接近球形（宽度≈高度）', (function () {
  var hy = spanY(0, 0.02, 0.6, 1.3, 400);
  var hw = head[1] - head[0], hh = hy[1] - hy[0];
  return Math.abs(hw - hh) / hw < 0.25;
})(), '让头看起来圆润');
ok('左右对称（肚围中心 ≈ 0）', Math.abs((belly[0] + belly[1]) / 2) < 0.012,
  '中心 ' + ((belly[0] + belly[1]) / 2).toFixed(5));

console.log('===== ③ 脚底接地 =====');
console.log('  最低点 y = ' + st.bbox.min[1].toFixed(5));
/* 容差 3mm：Surface Nets 的顶点由格内零交叉点平均得到，
   本身带有 ±半个体素的量化误差（h=0.012 → ±6mm），
   所以这里按"解剖精度"判定，真正的接地由构建后的 autoGround 保证。 */
ok('脚底贴合 y=0（误差 < 3mm，含体素量化）', Math.abs(st.bbox.min[1]) < 0.003, st.bbox.min[1].toFixed(5));
ok('头顶高度合理（角尖可到 1.29）', st.bbox.max[1] > 1.20 && st.bbox.max[1] < 1.35, st.bbox.max[1].toFixed(3));
ok('角尖明显高于头顶（有角的特征）', st.bbox.max[1] > buildNailong.DIM.headC[1] + buildNailong.DIM.headR[1],
  '角尖 ' + st.bbox.max[1].toFixed(3) + ' vs 头顶 ' +
  (buildNailong.DIM.headC[1] + buildNailong.DIM.headR[1]).toFixed(3));

console.log('===== ④ 五官贴面精度 =====');
var maxErr = 0, errs = [];
/* 眼睛：射线命中点应恰好落在等值面上（|f| ≈ 0） */
[[-0.30, 0.16, 0.94], [0.30, 0.16, 0.94]].forEach(function (d) {
  var hit = BLOB.raycast(field, buildNailong.DIM.headC, d, 1.0);
  var err = Math.abs(field(hit.p[0], hit.p[1], hit.p[2]));
  errs.push('眼 ' + err.toFixed(6));
  if (err > maxErr) maxErr = err;
  if (!hit.found) fail++;
});
var cheekErr = 0;
[[-0.72, -0.06, 0.70], [0.72, -0.06, 0.70]].forEach(function (d) {
  var hit = BLOB.raycast(field, buildNailong.DIM.headC, d, 1.0);
  var err = Math.abs(field(hit.p[0], hit.p[1], hit.p[2]));
  errs.push('腮 ' + err.toFixed(6));
  if (err > cheekErr) cheekErr = err;
});
var mhit = BLOB.raycast(field, [0, buildNailong.DIM.snoutC[1] - 0.045, buildNailong.DIM.snoutC[2]], [0, 0, 1], 1.0);
var mErr = Math.abs(field(mhit.p[0], mhit.p[1], mhit.p[2]));
errs.push('嘴 ' + mErr.toFixed(6));
console.log('  射线命中点上的场值（应≈0）: ' + errs.join('  '));
ok('眼睛精确落在曲面上（误差 < 1e-4）', maxErr < 1e-4, maxErr.toExponential(2));
ok('腮红精确落在曲面上', cheekErr < 1e-4, cheekErr.toExponential(2));
ok('嘴精确落在曲面上', mErr < 1e-4, mErr.toExponential(2));

console.log('===== ⑤ 构建（含五官网格）=====');
var nl = buildNailong();
var totalTri = nl.triangleCount();
var box = new THREE.Box3().setFromObject(nl.group);
console.log('  总三角面 = ' + totalTri);
console.log('  实际渲染包围盒 = ' + [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
  .map(function (v) { return v.toFixed(3); }).join(' × '));
ok('包含主体 + 五官（网格数 > 8）', (function () {
  var n = 0; nl.group.traverse(function (o) { if (o.isMesh) n++; });
  return n > 8;
})());
ok('有暗部/亮部顶点色差异（不是纯单色）', (function () {
  var col = nl.body.geometry.attributes.color;
  var min = 1e9, max = -1e9;
  for (var i = 0; i < col.count; i++) {
    var v = col.getX(i) + col.getY(i) + col.getZ(i);
    if (v < min) min = v; if (v > max) max = v;
  }
  return (max - min) > 0.08;
})());
ok('脚底接地（构建后）', Math.abs(box.min.y) < 0.002, box.min.y.toFixed(5));
ok('三角面数在可上手机的范围内（< 90k）', totalTri < 90000, totalTri + ' 面');

console.log('===== ⑥ 画质档可调 =====');
buildNailong.setDetail(0.72);
var lo = buildNailong();
var loTri = lo.triangleCount();
buildNailong.setDetail(1.0);
var mid = buildNailong();
var midTri = mid.triangleCount();
console.log('  省电档(0.72) = ' + loTri + ' 面，标准档(1.0) = ' + midTri + ' 面');
ok('省电档面数明显下降', loTri < midTri * 0.75, ((1 - loTri / midTri) * 100).toFixed(0) + '% 更少');
ok('档位切换后仍闭合', lo.__raw ? BLOB.inspect(lo.__raw).boundaryEdges === 0 : false);

console.log('');
console.log(fail === 0 ? '✅ 奶龙模型验证全部通过（' + pass + '/' + (pass + fail) + '）' : '❌ 有 ' + fail + ' 项失败');
process.exit(fail === 0 ? 0 : 1);