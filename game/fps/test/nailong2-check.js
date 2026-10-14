/* 奶龙 v2.0 剪影校验：把模型剪影与三视图像素量测逐行比对。
   模型与参考的对应关系：
     FRONT 半宽 -> 模型在 z=0 处的 |x| 最大值
     SIDE  前后 -> 模型在 x=0 处的 z 范围
   参考数据为 (frac, w/H)，其中 w/H 已含两侧与手臂。 */
var M = require('/root/nnnnlll/game/fps/test/nailong2-model.js');
var f = M.buildField();

var H = 1.30;   /* 参考总高换算 */

function scanX(y, z) {
  var lo = null, hi = null;
  for (var x = -0.5; x <= 0.5; x += 0.004) {
    if (f(x, y, z) < 0) { if (lo === null) lo = x; hi = x; }
  }
  return lo === null ? null : [lo, hi];
}
/* 全平面投影：正视图剪影 = 该高度上所有 z 上 |x| 的极值。
   必须这样做，因为手臂中心在 z≈0.07，只扫 z=0 会完全漏掉手臂。
   步长放粗以控制耗时（SDF 求值次数 ∝ 1/(dz*dx)）。 */
function projX(y) {
  var lo = null, hi = null;
  for (var z = -0.34; z <= 0.34; z += 0.012) {
    var s = scanX(y, z);
    if (!s) continue;
    if (lo === null || s[0] < lo) lo = s[0];
    if (hi === null || s[1] > hi) hi = s[1];
  }
  return lo === null ? null : [lo, hi];
}
/* 侧视图剪影 = 该高度上所有 x 上 z 的极值 */
function projZ(y) {
  var lo = null, hi = null;
  for (var x = -0.42; x <= 0.42; x += 0.012) {
    var s = scanZ(x, y);
    if (!s) continue;
    if (lo === null || s[0] < lo) lo = s[0];
    if (hi === null || s[1] > hi) hi = s[1];
  }
  return lo === null ? null : [lo, hi];
}
function scanZ(x, y) {
  var lo = null, hi = null;
  for (var z = -0.45; z <= 0.45; z += 0.002) {
    if (f(x, y, z) < 0) { if (lo === null) lo = z; hi = z; }
  }
  return lo === null ? null : [lo, hi];
}
/* 统计 y 高度上所有实体段（用于检测手臂/腿是否与躯干分离） */
function segsX(y, z) {
  var out = [], cur = null;
  for (var x = -0.5; x <= 0.5; x += 0.002) {
    var s = f(x, y, z) < 0;
    if (s) { if (cur === null) cur = [x, x]; else cur[1] = x; }
    else if (cur !== null) { out.push(cur); cur = null; }
  }
  if (cur !== null) out.push(cur);
  return out;
}
function segsZ(x, y) {
  var out = [], cur = null;
  for (var z = -0.45; z <= 0.45; z += 0.002) {
    var s = f(x, y, z) < 0;
    if (s) { if (cur === null) cur = [z, z]; else cur[1] = z; }
    else if (cur !== null) { out.push(cur); cur = null; }
  }
  if (cur !== null) out.push(cur);
  return out;
}

/* 参考：FRONT 半宽（w/H 含手臂）/ SIDE 前后范围（归一化到 H） */
var REF_FRONT = [
  [0.958, 0.1738], [0.917, 0.1984], [0.875, 0.2164], [0.833, 0.2410],
  [0.792, 0.2951], [0.750, 0.3738], [0.708, 0.4607], [0.667, 0.5131],
  [0.625, 0.5541], [0.583, 0.5836], [0.542, 0.6000], [0.500, 0.6033],
  [0.458, 0.5934], [0.417, 0.5754], [0.375, 0.5607], [0.333, 0.5262],
  [0.292, 0.3426], [0.250, 0.3426], [0.208, 0.3344], [0.167, 0.3246],
  [0.125, 0.3148], [0.083, 0.3148], [0.042, 0.4311], [0.000, 0.4279]
];
var REF_SIDE = [
  [0.958, 0.1716], [0.917, 0.2157], [0.875, 0.2435], [0.833, 0.2435],
  [0.792, 0.2484], [0.750, 0.2680], [0.708, 0.2941], [0.667, 0.3252],
  [0.625, 0.3513], [0.583, 0.3742], [0.542, 0.3856], [0.500, 0.3889],
  [0.458, 0.3824], [0.417, 0.3611], [0.375, 0.3252], [0.333, 0.2582],
  [0.292, 0.1405], [0.250, 0.1258], [0.208, 0.1062], [0.167, 0.0850],
  [0.125, 0.0637], [0.083, 0.0899], [0.042, 0.1879], [0.000, 0.0425]
];

console.log('=========== 正视图宽度比对 (z=0 剖面) ===========');
console.log('  frac   y     参考宽   模型宽   误差mm  参考/模型');
var sumErr = 0, cnt = 0, maxErr = 0, maxAt = 0;
REF_FRONT.forEach(function (r) {
  var frac = r[0], y = frac * H;
  var s = projX(y);
  if (!s) { console.log('  ' + frac.toFixed(3) + '  ' + y.toFixed(3) + '   —— 模型无实体'); return; }
  var wModel = s[1] - s[0];
  var wRef = r[1] * H;
  var err = (wModel - wRef) * 1000;
  sumErr += Math.abs(err); cnt++;
  if (Math.abs(err) > maxErr) { maxErr = Math.abs(err); maxAt = frac; }
  console.log('  ' + frac.toFixed(3) + '  ' + y.toFixed(3) + '  ' + wRef.toFixed(4) +
    '  ' + wModel.toFixed(4) + '  ' + (err >= 0 ? '+' : '') + err.toFixed(1) +
    '   ' + (wRef / wModel).toFixed(3));
});
console.log('  → 平均绝对误差 ' + (sumErr / cnt).toFixed(1) + ' mm，最大 ' + maxErr.toFixed(1) + ' mm (frac ' + maxAt.toFixed(3) + ')');

console.log('');
console.log('=========== 侧视图深度比对 (x=0 剖面) ===========');
console.log('  frac   y     参考深   模型深   误差mm');
var sumErr2 = 0, cnt2 = 0, maxErr2 = 0, maxAt2 = 0;
REF_SIDE.forEach(function (r) {
  var frac = r[0], y = frac * H;
  var s = projZ(y);
  if (!s) { console.log('  ' + frac.toFixed(3) + '  ' + y.toFixed(3) + '   —— 无实体'); return; }
  var dModel = s[1] - s[0];
  var dRef = r[1] * H;
  var err = (dModel - dRef) * 1000;
  sumErr2 += Math.abs(err); cnt2++;
  if (Math.abs(err) > maxErr2) { maxErr2 = Math.abs(err); maxAt2 = frac; }
  console.log('  ' + frac.toFixed(3) + '  ' + y.toFixed(3) + '  ' + dRef.toFixed(4) +
    '  ' + dModel.toFixed(4) + '  ' + (err >= 0 ? '+' : '') + err.toFixed(1));
});
console.log('  → 平均绝对误差 ' + (sumErr2 / cnt2).toFixed(1) + ' mm，最大 ' + maxErr2.toFixed(1) + ' mm (frac ' + maxAt2.toFixed(3) + ')');

console.log('');
console.log('=========== 关键特征核对 ===========');
/* 1. 总高与最宽点 */
var ymin = 1e9, ymax = -1e9;
for (var y = -0.1; y <= 1.5; y += 0.002) {
  if (scanX(y, 0) || scanZ(0, y)) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
}
console.log('  模型总高 = ' + (ymax - ymin).toFixed(4) + ' m（脚底 ' + ymin.toFixed(4) + '，头顶 ' + ymax.toFixed(4) + '）');

var widest = 0, wy = 0;
for (var y2 = 0.0; y2 <= 1.35; y2 += 0.002) {
  var s2 = scanX(y2, 0);
  if (s2 && (s2[1] - s2[0]) > widest) { widest = s2[1] - s2[0]; wy = y2; }
}
console.log('  最宽 ' + widest.toFixed(4) + ' m @ y=' + wy.toFixed(3) + '（参考 0.7843 m @ y=0.6626）');

/* 2. 无角/无背刺/无尾：检查头顶区域是否光滑，背后是否有突出 */
var topSeg = segsX(1.27, 0);
console.log('  y=1.27 顶部段数 = ' + topSeg.length + '（应为 1，多则说明有角）');
if (topSeg.length > 1) {
  console.log('    ⚠️ 出现多段: ' + topSeg.map(function (s) { return '[' + s[0].toFixed(3) + ',' + s[1].toFixed(3) + ']'; }).join(' '));
}
var backZ = scanZ(0, 0.60);
console.log('  背部 y=0.60 后缘 z=' + (backZ ? backZ[0].toFixed(3) : 'n/a') + '（参考 -0.2535，更负说明有尾巴/背刺）');

/* 3. 腿分离 */
[0.36, 0.29, 0.24, 0.15, 0.108].forEach(function (yy) {
  var sg = segsX(yy, -0.01);
  console.log('  y=' + yy.toFixed(3) + ' 正视图段数 = ' + sg.length +
    '  ' + sg.map(function (s) { return '[' + s[0].toFixed(3) + ',' + s[1].toFixed(3) + '] w=' + (s[1] - s[0]).toFixed(3); }).join(' '));
});

/* 4. 手臂外缘 */
console.log('');
console.log('  手臂外缘（参考最外侧 |x|=0.392 @ y=0.6496）:');
[0.87, 0.758, 0.65, 0.596, 0.477, 0.42].forEach(function (yy) {
  var s = scanX(yy, 0.06);
  if (s) console.log('    y=' + yy.toFixed(3) + '  |x|max=' + Math.max(Math.abs(s[0]), Math.abs(s[1])).toFixed(4));
});

/* 5. 脚 */
console.log('');
console.log('  脚（参考正视图外缘 0.328 / 内缘 0.0124，侧面 z -0.174..0.116）:');
[0.08, 0.05, 0.025].forEach(function (yy) {
  var sg = segsX(yy, 0.03);
  console.log('    y=' + yy.toFixed(3) + ' 段数=' + sg.length + '  ' +
    sg.map(function (s) { return '[' + s[0].toFixed(3) + ',' + s[1].toFixed(3) + ']'; }).join(' '));
  var sz = segsZ(0.196, yy);
  console.log('           侧向 z 段: ' + sz.map(function (s) { return '[' + s[0].toFixed(3) + ',' + s[1].toFixed(3) + ']'; }).join(' '));
});

/* 6. 眼睛位置核对 */
console.log('');
console.log('  眼睛方向命中点（参考 左(-0.0799,1.2105) 右(+0.0746,1.2105)）:');
var B = require('/root/nnnnlll/game/fps/test/blob.js');
[[-0.624, 0.300, 0.722], [0.624, 0.300, 0.722]].forEach(function (d, i) {
  var hit = B.raycast(f, [0, 1.148, -0.002], d, 1.2);
  console.log('    眼' + (i + 1) + ' 命中 (' + hit.p.map(function (v) { return v.toFixed(4); }).join(', ') + ')' +
    '  与参考差 dx=' + ((hit.p[0] - (i === 0 ? -0.0799 : 0.0746)) * 1000).toFixed(1) +
    'mm dy=' + ((hit.p[1] - 1.2105) * 1000).toFixed(1) + 'mm');
});

/* 7. 腹斑着色核对 */
console.log('');
console.log('  腹斑着色（参考跨越 y 0.531~0.916，半宽 0.099）:');
[0.55, 0.62, 0.70, 0.724, 0.78, 0.86, 0.90].forEach(function (yy) {
  var s = scanX(yy, 0);
  if (!s) return;
  var p = M.profAt(yy);
  var frontZ = p[3] + p[2] * 0.86;   /* 正面偏内，代表腹斑区 */
  var c = M.colorAt(0, yy, frontZ);
  var isCream = c[0] > 0.92 && c[1] > 0.85 && c[2] > 0.70;
  console.log('    y=' + yy.toFixed(3) + ' z=' + frontZ.toFixed(3) + ' color=[' +
    c.map(function (v) { return v.toFixed(2); }).join(',') + '] ' + (isCream ? '奶白✅' : '金黄'));
});

/* 8. 肢端深色 */
console.log('');
console.log('  肢端深色核对:');
[[0.30, 0.55, 0.07, '手'], [0.31, 0.48, 0.076, '手'], [0.20, 0.05, 0.03, '脚'], [0.20, 0.02, 0.10, '脚趾']].forEach(function (t) {
  var c = M.colorAt(t[0], t[1], t[2]);
  console.log('    ' + t[3] + ' (' + t[0] + ',' + t[1] + ',' + t[2] + ') color=[' +
    c.map(function (v) { return v.toFixed(2); }).join(',') + ']');
});
