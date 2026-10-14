/* 形体剖面：直接量"每个高度上，身体有多宽、往前后各伸多长"。
   比看 ASCII 图精确得多，也便于发现"吻部没凸出来""手臂看不见"这类问题。 */
var buildNailong = require('/root/nnnnlll/game/fps/test/nailong-model.js');
var f = buildNailong.buildField();

function scanX(y, z) {
  var lo = null, hi = null, step = 0.002;
  for (var x = -0.9; x <= 0.9; x += step) {
    if (f(x, y, z) < 0) { if (lo === null) lo = x; hi = x; }
  }
  return lo === null ? null : [lo, hi];
}
function scanZ(x, y) {
  var lo = null, hi = null, step = 0.002;
  for (var z = -0.9; z <= 0.9; z += step) {
    if (f(x, y, z) < 0) { if (lo === null) lo = z; hi = z; }
  }
  return lo === null ? null : [lo, hi];
}
function scanY(x, z) {
  var lo = null, hi = null, step = 0.002;
  for (var y = -0.3; y <= 1.5; y += step) {
    if (f(x, y, z) < 0) { if (lo === null) lo = y; hi = y; }
  }
  return lo === null ? null : [lo, hi];
}

console.log('【正视图剖面】每个高度上身体的宽度（x 跨度）');
console.log('  y     宽度   左缘    右缘   | 该高度主要是什么');
var rows = [
  [1.28, '角尖'], [1.20, '角中'], [1.10, '角根/头顶'],
  [1.00, '头'], [0.95, '头最宽'], [0.88, '脸/吻'],
  [0.80, '下颌'], [0.72, '颈'], [0.64, '肩/臂根'],
  [0.56, '胸/上臂'], [0.48, '腰/手'], [0.40, '肚子最宽'],
  [0.32, '下腹'], [0.24, '腿根'], [0.16, '腿'], [0.09, '脚']
];
rows.forEach(function (r) {
  var s = scanX(r[0], 0.02);
  if (!s) { console.log('  ' + r[0].toFixed(2) + '  —— 无实体'); return; }
  console.log('  ' + r[0].toFixed(2) + '  ' + (s[1] - s[0]).toFixed(3) +
    '  ' + s[0].toFixed(3) + '  ' + s[1].toFixed(3) + '   | ' + r[1]);
});

console.log('');
console.log('【侧视图剖面】中线处前后轮廓（z 跨度）');
console.log('  y     深度   后缘    前缘   | 说明');
[
  [1.20, '角'], [1.00, '头'], [0.94, '头/吻'], [0.90, '吻部'],
  [0.84, '嘴'], [0.72, '颈/背刺'], [0.64, '背刺'], [0.56, '背刺'],
  [0.48, '背刺根/尾'], [0.40, '肚/尾根'], [0.30, '尾']
].forEach(function (r) {
  var s = scanZ(0, r[0]);
  if (!s) { console.log('  ' + r[0].toFixed(2) + '  —— 无实体'); return; }
  console.log('  ' + r[0].toFixed(2) + '  ' + (s[1] - s[0]).toFixed(3) +
    '  ' + s[0].toFixed(3) + '  ' + s[1].toFixed(3) + '   | ' + r[1]);
});

console.log('');
console.log('【关键特征核对】');
/* 吻部凸出量：必须拿"不受吻部影响的头部高度"当前缘基准。
   在 y=1.06（吻部顶端 1.022 之上）量到的才是纯头前缘。 */
var headFront = scanZ(0, 1.06)[1];
var snoutFront = 0;
for (var yy = 0.80; yy <= 1.05; yy += 0.005) {
  var s2 = scanZ(0, yy);
  if (s2 && s2[1] > snoutFront) snoutFront = s2[1];
}
console.log('  纯头前缘 z = ' + headFront.toFixed(3) + '   吻部最前端 z = ' + snoutFront.toFixed(3) +
  '   凸出 ' + ((snoutFront - headFront) * 1000).toFixed(1) + ' mm');
console.log('  → 吻部' + (snoutFront - headFront > 0.03 ? '✅ 明显前凸' : '❌ 不够前凸（嘴看不出来）'));

/* 手臂：在手臂高度上，最宽处应明显超过同高度躯干 */
var atChest = scanX(0.48, 0.02);
var torsoOnly = scanX(0.48, 0.0);
console.log('  胸腹宽度 = ' + (atChest[1] - atChest[0]).toFixed(3));
console.log('  → 手臂' + ((atChest[1] - atChest[0]) > 0.62 ? '✅ 向外凸出可见' : '❌ 太贴身体'));
/* 手的位置 */
var handY = buildNailong.DIM.armBot[1];
var hs = scanX(handY, 0.105);
console.log('  手部高度 y=' + handY.toFixed(2) + ' 处宽度 = ' + (hs[1] - hs[0]).toFixed(3) +
  '（肚子最宽 ' + (scanX(0.40, 0.02)[1] - scanX(0.40, 0.02)[0]).toFixed(3) + '）');

/* 尾巴长度 */
var tail = scanZ(0, 0.30);
console.log('  尾巴后伸至 z = ' + tail[0].toFixed(3) + '（身体后缘约 -0.28）→ 尾长约 ' +
  (0.28 + Math.abs(tail[0])).toFixed(3) + ' m');

/* 脚：必须有两只分开的脚 */
console.log('');
console.log('【脚的分离度】y=0.03 处横向扫描：');
var segs = [], cur = null;
for (var x = -0.9; x <= 0.9; x += 0.002) {
  var solid = f(x, 0.03, 0.055) < 0;
  if (solid && !cur) cur = [x, x];
  else if (solid && cur) cur[1] = x;
  else if (!solid && cur) { segs.push(cur); cur = null; }
}
if (cur) segs.push(cur);
segs.forEach(function (s, i) {
  console.log('  脚 ' + (i + 1) + ': x ' + s[0].toFixed(3) + ' ~ ' + s[1].toFixed(3) +
    '  宽 ' + (s[1] - s[0]).toFixed(3));
});
console.log('  → ' + (segs.length === 2 ? '✅ 两只脚分开' : '⚠️ 脚数 = ' + segs.length));

/* 眼睛是否落在头部正面。方向从模型源码里读，避免脚本与模型脱节。 */
console.log('');
console.log('【眼睛位置核对】');
var fs2 = require('fs');
var src = fs2.readFileSync('/root/nnnnlll/game/fps/test/nailong-model.js', 'utf8');
var dirs = [];
src.replace(/\{\s*dir:\s*\[([-\d.,\s]+)\],\s*r:\s*([\d.]+)\s*\}/g, function (m, a, r) {
  dirs.push({ d: a.split(',').map(Number), r: Number(r) });
  return m;
});
dirs.forEach(function (e, i) {
  var hit = require('/root/nnnnlll/game/fps/test/blob.js').raycast(f, buildNailong.DIM.headC, e.d, 1.0);
  console.log('  眼' + (i + 1) + ' 方向 [' + e.d.join(', ') + '] 命中点 (' +
    hit.p.map(function (v) { return v.toFixed(3); }).join(', ') + ')  眼距（x 差）= ' +
    (hit.p[0] * 2).toFixed(3));
});
if (dirs.length === 2) {
  var h0 = require('/root/nnnnlll/game/fps/test/blob.js').raycast(f, buildNailong.DIM.headC, dirs[0].d, 1.0);
  var h1 = require('/root/nnnnlll/game/fps/test/blob.js').raycast(f, buildNailong.DIM.headC, dirs[1].d, 1.0);
  console.log('  → 两眼中心间距 ' + Math.abs(h1.p[0] - h0.p[0]).toFixed(3) + ' m' +
    (Math.abs(h1.p[0] - h0.p[0]) > 0.20 ? '  ✅ 清晰分开' : '  ❌ 挤在一起'));
  /* 眼睛是否会被吻部挡住：真正的判据不是 x 大小，而是
     眼睛高度是否高于吻部顶面（吻部顶 y = snoutC.y + snoutR.y）。
     眼睛高于它才不会被前凸的吻部当成"侧壁"遮挡。 */
  var D2 = buildNailong.DIM;
  var snoutTop = D2.snoutC[1] + D2.snoutR[1];
  console.log('  → 眼睛 y=' + h0.p[1].toFixed(3) + '，吻部顶面 y=' + snoutTop.toFixed(3) +
    (h0.p[1] > snoutTop ? '  ✅ 高于吻部（不被挡）' : '  ❌ 低于吻部（会被挡）'));
  console.log('  → 眼睛相对头心：x=' + h0.p[0].toFixed(3) + ' y=' +
    (h0.p[1] - D2.headC[1]).toFixed(3) + ' z=' + (h0.p[2] - D2.headC[2]).toFixed(3));
}