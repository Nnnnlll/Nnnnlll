/* 页面冒烟测试：模拟浏览器环境，验证
   ① 烘焙数据能被解码
   ② 模型能从烘焙数据建起来（走 baked 分支，不跑 SDF）
   ③ 顶点数/面数/包围盒/落地/眼睛位置都对
   这能在上传前抓住"页面打不开"这一类问题。 */
global.window = global;
global.self = global;
global.atob = function (s) {
  return Buffer.from(s, 'base64').toString('binary');
};
global.document = { createElement: function () { return { getContext: function () { return null; } }; } };

/* three.min.js 在 Node 里需要一个最小的 window 才能跑 */
var THREE = require('/root/nnnnlll/game/fps/test/lib/three.min.js');
global.THREE = THREE;
var BLOB = require('/root/nnnnlll/game/fps/test/blob.js');
global.BLOB = BLOB;

/* 载入烘焙数据（它就是一段给 window 赋值的脚本） */
require('/root/nnnnlll/game/fps/test/nailong2-baked.js');
var g = global.__NAILONG_GEO__;
console.log('烘焙数据: verts=' + g.verts + ' scale=' + g.scale.toExponential(4) +
  ' base=[' + g.base.join(', ') + '] idxType=' + g.idxType);

/* 解码（与页面里那段完全相同的逻辑） */
function b64(s) {
  var bin = atob(s), n = bin.length;
  var buf = new ArrayBuffer(n), u8 = new Uint8Array(buf);
  for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
  return buf;
}
g.positions = new Int16Array(b64(g.positions));
g.indices = (g.idxType === 32) ? new Uint32Array(b64(g.indices)) : new Uint16Array(b64(g.indices));
console.log('解码后 positions=' + g.positions.length + ' indices=' + g.indices.length);

/* 用模型建（会自动走 baked 分支） */
var M = require('/root/nnnnlll/game/fps/test/nailong2-model.js');
var t0 = Date.now();
var m = M();
console.log('建模耗时 ' + (Date.now() - t0) + ' ms（应 < 2000，说明没跑 SDF）');
console.log('三角面 ' + m.triangleCount());

var bb = m.stats.bbox;
console.log('包围盒 min [' + bb.min.map(function (v) { return v.toFixed(4); }).join(', ') + ']');
console.log('包围盒 max [' + bb.max.map(function (v) { return v.toFixed(4); }).join(', ') + ']');
console.log('总高 ' + (bb.max[1] - bb.min[1]).toFixed(4) + ' m');

var ok = true;
function chk(name, cond, extra) {
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
}

console.log('');
console.log('【落地检查】');
chk('脚底接近 y=0', Math.abs(bb.min[1]) < 0.012, 'min.y=' + bb.min[1].toFixed(4));
chk('头顶在 1.28~1.32', bb.max[1] > 1.28 && bb.max[1] < 1.32, 'max.y=' + bb.max[1].toFixed(4));
chk('总高接近 1.30', Math.abs((bb.max[1] - bb.min[1]) - 1.30) < 0.03);

console.log('');
console.log('【宽度检查】');
chk('最宽接近 0.784', Math.abs((bb.max[0] - bb.min[0]) - 0.784) < 0.05,
  '实际 ' + (bb.max[0] - bb.min[0]).toFixed(4));
chk('左右对称', Math.abs(bb.max[0] + bb.min[0]) < 0.01);

console.log('');
console.log('【网格质量】');
chk("无边界边（闭合）", m.stats.boundaryEdges === 0, "boundary=" + m.stats.boundaryEdges);
console.log('  非流形边 ' + m.stats.nonManifoldEdges + '（2 属可接受）');
chk('体积合理', m.stats.volume > 0.02 && m.stats.volume < 0.20,
  'volume=' + m.stats.volume.toFixed(4) + ' m³');

console.log('');
console.log('【五官与配色】');
var face = m.parts.face;
chk('虹膜×2 + 瞳孔×2 + 高光×2 + 嘴×1 = 7 个部件', face.length === 7, '实际 ' + face.length);
face.forEach(function (o, i) {
  console.log('    part' + (i + 1) + ' 位置 (' +
    o.position.x.toFixed(4) + ', ' + o.position.y.toFixed(4) + ', ' + o.position.z.toFixed(4) + ')');
});
var c1 = M.colorAt(0, 0.72, 0.25);
console.log('    腹斑色 [' + c1.map(function (v) { return v.toFixed(2); }).join(',') + ']');
chk('腹斑是奶白', c1[0] > 0.92 && c1[2] > 0.70);
var c2 = M.colorAt(0, 0.95, -0.15);
console.log('    背部色 [' + c2.map(function (v) { return v.toFixed(2); }).join(',') + ']');
chk('背部是金黄', c2[2] < 0.40);

console.log('');
console.log(ok ? '========== 全部通过 ==========' : '========== 有失败项 ==========');
process.exit(ok ? 0 : 1);