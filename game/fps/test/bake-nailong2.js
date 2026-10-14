/* 烘焙奶龙几何：跑一遍 Surface Nets，把顶点/索引量化成
   紧凑数组，输出成可直接内联进 HTML 的 JS 片段。
   量化：位置用 Int16，scale 取 range/32767；
   索引用 Uint16（顶点数 < 65536 时可行）。 */
var fs = require('fs');
var M = require('/root/nnnnlll/game/fps/test/nailong2-model.js');

/* Taubin 平滑（λ|μ 交替）：等值面提取出来的网格在体素尺度上
   有微小台阶和噪点，肉眼表现为"不干净、不圆润"。
   普通 Laplacian 平滑能去掉噪点但会让模型整体缩水（体积变小、棱角变塌）。
   Taubin 用「先收缩 λ、再轻微膨胀 μ（μ 取负值）」交替，
   净效果是低通滤波 —— 噪点被抹平，体积和轮廓基本保持。
   参数 λ=0.5、μ=-0.53 是 Taubin 原文推荐的组合。 */
function taubinSmooth(raw, iters, lambda, mu) {
  var n = raw.vertexCount;
  var pos = new Float32Array(raw.positions);
  var idx = raw.indices;

  /* 邻接表（用邻接顶点去重） */
  var nbr = new Array(n);
  for (var i = 0; i < n; i++) nbr[i] = [];
  for (var t = 0; t < idx.length; t += 3) {
    var a = idx[t], b = idx[t + 1], c = idx[t + 2];
    nbr[a].push(b, c); nbr[b].push(a, c); nbr[c].push(a, b);
  }
  for (var v = 0; v < n; v++) {
    if (nbr[v].length > 1) {
      var seen = {}, uniq = [];
      for (var q = 0; q < nbr[v].length; q++) {
        var w = nbr[v][q];
        if (!seen[w]) { seen[w] = 1; uniq.push(w); }
      }
      nbr[v] = uniq;
    }
  }

  var tmp = new Float32Array(n * 3);
  function pass(f) {
    for (var i2 = 0; i2 < n; i2++) {
      var L = nbr[i2];
      if (L.length === 0) {
        tmp[i2 * 3] = pos[i2 * 3];
        tmp[i2 * 3 + 1] = pos[i2 * 3 + 1];
        tmp[i2 * 3 + 2] = pos[i2 * 3 + 2];
        continue;
      }
      var sx = 0, sy = 0, sz = 0;
      for (var j = 0; j < L.length; j++) {
        var k = L[j] * 3;
        sx += pos[k]; sy += pos[k + 1]; sz += pos[k + 2];
      }
      var inv = 1 / L.length;
      tmp[i2 * 3] = pos[i2 * 3] + f * (sx * inv - pos[i2 * 3]);
      tmp[i2 * 3 + 1] = pos[i2 * 3 + 1] + f * (sy * inv - pos[i2 * 3 + 1]);
      tmp[i2 * 3 + 2] = pos[i2 * 3 + 2] + f * (sz * inv - pos[i2 * 3 + 2]);
    }
    pos.set(tmp);
  }

  for (var it = 0; it < iters; it++) {
    pass(lambda);
    pass(mu);
  }

  var out = {};
  for (var key in raw) out[key] = raw[key];
  out.positions = pos;
  return out;
}

var H = 0.0092;   /* 烘焙分辨率：比实时预览更细，静态加载不怕等 */
var raw0 = M.buildRaw(H);
console.log('平滑前 顶点', raw0.vertexCount, '三角面', raw0.triangleCount);

var raw = taubinSmooth(raw0, 4, 0.52, -0.545);
var stats0 = require('/root/nnnnlll/game/fps/test/blob.js').inspect(raw0);
var stats1 = require('/root/nnnnlll/game/fps/test/blob.js').inspect(raw);
console.log('平滑后 体积 ' + stats0.volume.toFixed(4) + ' → ' + stats1.volume.toFixed(4) +
  '（变化 ' + ((stats1.volume / stats0.volume - 1) * 100).toFixed(2) + '%，越接近 0 越好）');
console.log('包围盒 ' + stats1.bbox.size.map(function (v) { return v.toFixed(4); }).join(' × '));

var n = raw.vertexCount;
var pos = raw.positions;

/* 求包围盒用于量化 */
var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (var i = 0; i < n * 3; i += 3) {
  for (var a = 0; a < 3; a++) {
    var v = pos[i + a];
    if (v < mn[a]) mn[a] = v;
    if (v > mx[a]) mx[a] = v;
  }
}
var span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
var scale = span / 32767;

/* 以 [min, min+32767*scale] 为量化范围，中心对齐以减小误差 */
var q = new Int16Array(n * 3);
for (var i2 = 0; i2 < n * 3; i2++) {
  q[i2] = Math.round((pos[i2] - mn[0 + (i2 % 3)]) / scale) - 32767;
  /* 上面写法有问题：应当以每个轴的最小值为基准。
     改为下面的正确实现（保留此行仅为提示，实际用下面循环）。 */
}
/* 正确的逐轴量化 */
var base = [mn[0], mn[1], mn[2]];
for (var i3 = 0; i3 < n; i3++) {
  for (var a3 = 0; a3 < 3; a3++) {
    var val = (pos[i3 * 3 + a3] - base[a3]) / scale;
    q[i3 * 3 + a3] = Math.round(val) - 32768;
  }
}

/* 同时烘焙顶点颜色：colorAt 里有 atan2/sqrt 等运算，
   30k 顶点在手机上要跑几百毫秒。直接烤成 Uint8 RGB 存下，
   页面连颜色逻辑都不用执行。 */
var colU8 = new Uint8Array(n * 3);
for (var ci = 0; ci < n; ci++) {
  var c = M.colorAt(pos[ci * 3], pos[ci * 3 + 1], pos[ci * 3 + 2]);
  colU8[ci * 3] = Math.max(0, Math.min(255, Math.round(c[0] * 255)));
  colU8[ci * 3 + 1] = Math.max(0, Math.min(255, Math.round(c[1] * 255)));
  colU8[ci * 3 + 2] = Math.max(0, Math.min(255, Math.round(c[2] * 255)));
}
console.log('顶点色已烘焙');

var idx = raw.indices;
var idxMax = 0;
for (var ii = 0; ii < idx.length; ii++) if (idx[ii] > idxMax) idxMax = idx[ii];
console.log('索引最大顶点号', idxMax, '（顶点数', n, '，Uint16 上限 65535）');

/* 校验：量化后最大误差 */
var maxErr = 0;
for (var i4 = 0; i4 < n; i4++) {
  for (var a4 = 0; a4 < 3; a4++) {
    var rec = (q[i4 * 3 + a4] + 32768) * scale + base[a4];
    var e = Math.abs(rec - pos[i4 * 3 + a4]);
    if (e > maxErr) maxErr = e;
  }
}
console.log('量化最大误差 ' + (maxErr * 1000).toFixed(3) + ' mm');

/* 输出：把数组 base64 成字符串再在页面解回来，比 JSON 数字串省一半 */
var posBuf = Buffer.from(q.buffer, q.byteOffset, q.byteLength);
var idxArr = (n < 65536) ? new Uint16Array(idx) : new Uint32Array(idx);
var idxBuf = Buffer.from(idxArr.buffer, idxArr.byteOffset, idxArr.byteLength);
var colBuf = Buffer.from(colU8.buffer, colU8.byteOffset, colU8.byteLength);

var out = [];
out.push('window.__NAILONG_GEO__={');
out.push('scale:' + scale.toFixed(12) + ',');
out.push('base:[' + base.map(function (v) { return v.toFixed(6); }).join(',') + '],');
out.push('verts:' + n + ',');
out.push('idxType:' + (n < 65536 ? 16 : 32) + ',');
out.push('positions:"' + posBuf.toString('base64') + '",');
out.push('colors:"' + colBuf.toString('base64') + '",');
out.push('indices:"' + idxBuf.toString('base64') + '"');
out.push('};');

var js = out.join('');
fs.writeFileSync('/root/nnnnlll/game/fps/test/nailong2-baked.js', js);
console.log('写出 nailong2-baked.js，' + (js.length / 1024).toFixed(1) + ' KB');
console.log('base64 后 positions ' + (posBuf.length / 1024).toFixed(0) + 'KB, indices ' + (idxBuf.length / 1024).toFixed(0) + 'KB');