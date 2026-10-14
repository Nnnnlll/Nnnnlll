/* ============================================================
   blob.js — 隐式曲面引擎（SDF + Surface Nets）v1.0
   ------------------------------------------------------------
   为什么用它：传统做法是"多个几何体拼在一起"，棱边接缝处必然
   出现穿模/缝隙。SDF 的做法是先定义一个标量距离场，
   所有部件用 smooth-min 互相"融化"成一整块物质，
   再从场里提取等值面 —— 这样得到的表面是一张连续闭合的皮，
   数学上不可能存在接缝、穿模、破面。

   零依赖（不依赖 THREE），浏览器/Node 双环境。
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.BLOB = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================= 基础数学 ================= */
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerp3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  /* ================= SDF 基元 =================
     约定：返回值 <0 表示在实体内部，=0 是表面，>0 在外部。 */

  function sdSphere(x, y, z, c, r) {
    var dx = x - c[0], dy = y - c[1], dz = z - c[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  }

  /* iq 的椭球精确近似 SDF */
  function sdEllipsoid(x, y, z, c, r) {
    var dx = (x - c[0]) / r[0], dy = (y - c[1]) / r[1], dz = (z - c[2]) / r[2];
    var k0 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var ax = dx / r[0], ay = dy / r[1], az = dz / r[2];
    var k1 = Math.sqrt(ax * ax + ay * ay + az * az);
    if (k1 < 1e-9) return -Math.min(r[0], Math.min(r[1], r[2]));
    return k0 * (k0 - 1.0) / k1;
  }

  /* 锥形胶囊（圆台两端带半球）：a→b，两端半径 r1/r2
     iq 的 sdRoundCone，用来做尾巴、角、背刺 */
  function sdRoundCone(x, y, z, a, b, r1, r2) {
    var bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
    var l2 = bax * bax + bay * bay + baz * baz;
    var rr = r1 - r2;
    var a2 = l2 - rr * rr;
    var il2 = 1.0 / l2;
    var pax = x - a[0], pay = y - a[1], paz = z - a[2];
    var yy = pax * bax + pay * bay + paz * baz;
    var zz = yy - l2;
    var xx0 = pax * l2 - bax * yy;
    var xx1 = pay * l2 - bay * yy;
    var xx2 = paz * l2 - baz * yy;
    var x2 = xx0 * xx0 + xx1 * xx1 + xx2 * xx2;
    var y2 = yy * yy * l2;
    var z2 = zz * zz * l2;
    var k = (rr < 0 ? -1 : 1) * rr * rr * x2;
    var sz = zz < 0 ? -1 : 1, sy = yy < 0 ? -1 : 1;
    if (sz * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (sy * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  }

  /* ================= 组合算子 ================= */

  /* 多项式 smooth-min：让两块物质"融化"在一起，k 越大过渡越圆 */
  function smin(a, b, k) {
    if (k <= 1e-9) return Math.min(a, b);
    var h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
  }
  function smax(a, b, k) { return -smin(-a, -b, k); }

  /* 把一串 SDF 用各自的 k 逐级融合
     parts = [{ d: fn, k: 与前一块融合的硬度 }] */
  function assemble(parts) {
    return function (x, y, z) {
      var d = parts[0].d(x, y, z);
      for (var i = 1; i < parts.length; i++) {
        d = smin(d, parts[i].d(x, y, z), parts[i].k === undefined ? 0.06 : parts[i].k);
      }
      return d;
    };
  }

  /* ================= 场工具 ================= */

  /* 中心差分求梯度（单位化后就是表面法线），h 取网格步长的 0.5 倍左右 */
  function gradient(f, x, y, z, h) {
    var gx = f(x + h, y, z) - f(x - h, y, z);
    var gy = f(x, y + h, z) - f(x, y - h, z);
    var gz = f(x, y, z + h) - f(x, y, z - h);
    var l = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (l < 1e-12) return [0, 0, 0];
    return [gx / l, gy / l, gz / l];
  }

  /* 球体步进：从 origin 沿方向找表面点（返回 {p, t, found, n}）
     用来把眼睛/嘴/肚皮纹这类贴片精确放到曲面"上"，
     既不会浮空也不会陷进去 —— 这是"无瑕疵"的关键细节。

     两个必须注意的坑（都踩过）：
     ① origin 可能在物体内部（从头心往外找脸）。所以判据必须用 |dist|，
        用 dist 时"在内部"（dist<0）会被误判成"已命中"，直接返回起点。
     ② 单纯固定阈值不够：步进有可能从 dist=+4e-5 一步跨到 -6e-5，
        之后越走越深、永不收敛，于是"明明穿过了表面却说没命中"。
        所以这里改成「检测符号翻转 → 二分细化到 1e-9」，稳定且更准。 */
  function raycast(f, origin, dir, maxT, steps) {
    var d = norm(dir);
    var maxSteps = steps || 256;
    var ox = origin[0], oy = origin[1], oz = origin[2];
    var prevT = 0;
    var prevD = f(ox, oy, oz);
    if (Math.abs(prevD) < 1e-9) {
      return { p: [ox, oy, oz], t: 0, found: true, n: gradient(f, ox, oy, oz, 1e-3), fromInside: prevD < 0 };
    }
    for (var i = 0; i < maxSteps; i++) {
      var t = prevT + Math.max(Math.abs(prevD) * 0.85, 1e-5);
      if (t > maxT) break;
      var px = ox + d[0] * t, py = oy + d[1] * t, pz = oz + d[2] * t;
      var dist = f(px, py, pz);
      if (Math.abs(dist) < 1e-9) {
        return { p: [px, py, pz], t: t, found: true, n: gradient(f, px, py, pz, 1e-3) };
      }
      if ((dist < 0) !== (prevD < 0)) {
        /* 表面就在 [prevT, t] 之间 —— 二分收敛到亚微米 */
        var lo = prevT, hi = t, loD = prevD;
        for (var k = 0; k < 60; k++) {
          var mid = (lo + hi) * 0.5;
          var mx = ox + d[0] * mid, my = oy + d[1] * mid, mz = oz + d[2] * mid;
          var md = f(mx, my, mz);
          if (Math.abs(md) < 1e-10) { lo = mid; hi = mid; break; }
          if ((md < 0) === (loD < 0)) { lo = mid; loD = md; } else { hi = mid; }
        }
        var ft = (lo + hi) * 0.5;
        var fx = ox + d[0] * ft, fy = oy + d[1] * ft, fz = oz + d[2] * ft;
        return { p: [fx, fy, fz], t: ft, found: true, n: gradient(f, fx, fy, fz, 1e-3), fromInside: prevD < 0 };
      }
      prevT = t; prevD = dist;
    }
    return { p: [ox + d[0] * maxT, oy + d[1] * maxT, oz + d[2] * maxT], t: maxT, found: false, n: [0, 0, 0] };
  }

  /* ================= Surface Nets 等值面提取 =================
     把标量场转成三角网格。
     相比 Marching Cubes，它每个格子只产生一个顶点，
     顶点位置取所有零交叉点的平均 —— 结果更平滑、顶点更少、
     也不会出现 MC 那种"阶梯/棱角"。 */
  function surfaceNets(f, bmin, bmax, h, opts) {
    opts = opts || {};
    var iso = opts.iso === undefined ? 0 : opts.iso;
    var nx = Math.ceil((bmax[0] - bmin[0]) / h) + 1;
    var ny = Math.ceil((bmax[1] - bmin[1]) / h) + 1;
    var nz = Math.ceil((bmax[2] - bmin[2]) / h) + 1;
    var total = nx * ny * nz;
    if (total > 8e6) throw new Error('体素太多: ' + total);

    /* --- 1. 采样标量场 --- */
    var val = new Float32Array(total);
    var gi = 0;
    for (var k = 0; k < nz; k++) {
      var z = bmin[2] + k * h;
      for (var j = 0; j < ny; j++) {
        var y = bmin[1] + j * h;
        for (var i = 0; i < nx; i++) {
          val[gi++] = f(bmin[0] + i * h, y, z) - iso;
        }
      }
    }
    function V(i, j, k) { return val[i + nx * (j + ny * k)]; }

    /* --- 2. 每个格子的顶点 --- */
    var CX = nx - 1, CY = ny - 1, CZ = nz - 1;
    var cellV = new Int32Array(Math.max(CX, 0) * Math.max(CY, 0) * Math.max(CZ, 0)).fill(-1);
    function CI(i, j, k) { return i + CX * (j + CY * k); }

    var OX = [0, 1, 0, 0], OY = [0, 0, 1, 0], OZ = [0, 0, 0, 1]; /* 四条底边的方向 */
    var CORNER = [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
    ];
    var EDGES = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    var vx = [], vy = [], vz = [];
    for (var ck = 0; ck < CZ; ck++) {
      for (var cj = 0; cj < CY; cj++) {
        for (var ci = 0; ci < CX; ci++) {
          var vs = new Array(8), allIn = 0, allOut = 0;
          for (var n = 0; n < 8; n++) {
            var o = CORNER[n];
            var vv = V(ci + o[0], cj + o[1], ck + o[2]);
            vs[n] = vv;
            if (vv < 0) allIn++; else allOut++;
          }
          if (allIn === 8 || allOut === 8) continue;
          var sx = 0, sy = 0, sz = 0, cnt = 0;
          for (var e = 0; e < 12; e++) {
            var a = vs[EDGES[e][0]], b = vs[EDGES[e][1]];
            if ((a < 0) === (b < 0)) continue;
            var t = Math.abs(a - b) < 1e-12 ? 0.5 : a / (a - b);
            var ca = CORNER[EDGES[e][0]], cb = CORNER[EDGES[e][1]];
            var ax = bmin[0] + (ci + ca[0]) * h, ay = bmin[1] + (cj + ca[1]) * h, az = bmin[2] + (ck + ca[2]) * h;
            var bx = bmin[0] + (ci + cb[0]) * h, by = bmin[1] + (cj + cb[1]) * h, bz = bmin[2] + (ck + cb[2]) * h;
            sx += ax + (bx - ax) * t; sy += ay + (by - ay) * t; sz += az + (bz - az) * t;
            cnt++;
          }
          if (!cnt) continue;
          vx.push(sx / cnt); vy.push(sy / cnt); vz.push(sz / cnt);
          cellV[CI(ci, cj, ck)] = vx.length - 1;
        }
      }
    }

    /* --- 3. 连四边形（每个符号跳变沿生成一个 quad） --- */
    var tris = [];
    /* 注意：quad 收到的是「格子索引」，必须先经 cellV 查表换成「顶点索引」。
       这里漏过一次查表，导致索引直接冲到 149325（远超顶点数 7508），
       面积/体积全变 NaN、闭合性也假象通过 —— 现已修正。 */
    function quad(ca, cb, cc, cd) {
      var a = ca >= 0 && ca < cellV.length ? cellV[ca] : -1;
      var b = cb >= 0 && cb < cellV.length ? cellV[cb] : -1;
      var c = cc >= 0 && cc < cellV.length ? cellV[cc] : -1;
      var d = cd >= 0 && cd < cellV.length ? cellV[cd] : -1;
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      /* 四边形 a→b→c→d 环绕，必须沿对角线 a-c 拆分：
         拆成 (a,b,c) + (a,c,d)，共享边 ac 才恰好被两个三角形使用。
         若拆成 (a,b,c)+(b,d,c)，对角线 ac 与 bd 会同时出现，
         造成非流形边（实测 2214 条）。 */
      tris.push(a, b, c, a, c, d);
    }
    for (var k2 = 1; k2 < nz - 1; k2++) {
      for (var j2 = 1; j2 < ny - 1; j2++) {
        for (var i2 = 1; i2 < nx - 1; i2++) {
          var v0 = V(i2, j2, k2);
          /* 沿 +X 的边：四个相邻格子 */
          if ((v0 < 0) !== (V(i2 + 1, j2, k2) < 0)) {
            quad(CI(i2, j2 - 1, k2 - 1), CI(i2, j2, k2 - 1), CI(i2, j2, k2), CI(i2, j2 - 1, k2));
          }
          /* 沿 +Y */
          if ((v0 < 0) !== (V(i2, j2 + 1, k2) < 0)) {
            quad(CI(i2 - 1, j2, k2 - 1), CI(i2, j2, k2 - 1), CI(i2, j2, k2), CI(i2 - 1, j2, k2));
          }
          /* 沿 +Z */
          if ((v0 < 0) !== (V(i2, j2, k2 + 1) < 0)) {
            quad(CI(i2 - 1, j2 - 1, k2), CI(i2, j2 - 1, k2), CI(i2, j2, k2), CI(i2 - 1, j2, k2));
          }
        }
      }
    }

    /* --- 4. 用场梯度定法线 + 自动纠正绕序 --- */
    var vcount = vx.length;
    var pos = new Float32Array(vcount * 3);
    var nrm = new Float32Array(vcount * 3);
    var gh = h * 0.5;
    for (var vi = 0; vi < vcount; vi++) {
      pos[vi * 3] = vx[vi]; pos[vi * 3 + 1] = vy[vi]; pos[vi * 3 + 2] = vz[vi];
      var g = gradient(f, vx[vi], vy[vi], vz[vi], gh * 0.5);
      var gl = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
      if (gl < 1e-9) { g = [0, 1, 0]; } /* 退化点兜底 */
      nrm[vi * 3] = g[0]; nrm[vi * 3 + 1] = g[1]; nrm[vi * 3 + 2] = g[2];
    }

    var out = [];
    for (var t = 0; t < tris.length; t += 3) {
      var a1 = tris[t], b1 = tris[t + 1], c1 = tris[t + 2];
      if (a1 === b1 || b1 === c1 || a1 === c1) continue;
      var p0 = [pos[a1 * 3], pos[a1 * 3 + 1], pos[a1 * 3 + 2]];
      var p1 = [pos[b1 * 3], pos[b1 * 3 + 1], pos[b1 * 3 + 2]];
      var p2 = [pos[c1 * 3], pos[c1 * 3 + 1], pos[c1 * 3 + 2]];
      var fn = cross(sub(p1, p0), sub(p2, p0));
      var fl = len(fn);
      if (fl < 1e-14) {
        /* 零面积三角形不参与光照（GPU 会自动丢），但必须保留：
           剔除它会让它的三条边只剩一个邻接三角形 → 变成"边界边"，
           网格在拓扑上出现针孔。保留才能保证每条边恰好被两面共享。 */
        out.push(a1, b1, c1);
        continue;
      }
      var cen = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
      var gg = gradient(f, cen[0], cen[1], cen[2], gh * 0.4);
      /* 面法线若与场梯度反向 → 说明绕序反了，交换两个顶点 */
      if (dot(fn, gg) < 0) { var tmp = b1; b1 = c1; c1 = tmp; }
      out.push(a1, b1, c1);
    }

    return {
      positions: pos,
      normals: nrm,
      indices: new Uint32Array(out),
      vertexCount: vcount,
      triangleCount: out.length / 3,
      resolution: h,
      grid: [nx, ny, nz],
      sampleCount: total
    };
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  /* 遗留小工具（上面 CORNER 映射里用不到，保留以避免误引用） */
  function i_of(c, axis) { return c[axis]; }

  /* 顶点着色：colorAt(x,y,z) → [r,g,b] (0~1) */
  function vertexColors(geo, colorAt) {
    var n = geo.vertexCount;
    var col = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var c = colorAt(geo.positions[i * 3], geo.positions[i * 3 + 1], geo.positions[i * 3 + 2]);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    return col;
  }

  /* 网格体检：闭合性（每条边恰好被 2 个三角形共享）、面积、体积、包围盒 */
  function inspect(geo) {
    var idx = geo.indices, pos = geo.positions;
    var edges = {}, nonManifold = 0, boundary = 0;
    for (var t = 0; t < idx.length; t += 3) {
      for (var e = 0; e < 3; e++) {
        var a = idx[t + e], b = idx[t + (e + 1) % 3];
        var key = a < b ? a + '_' + b : b + '_' + a;
        edges[key] = (edges[key] || 0) + 1;
      }
    }
    for (var kk in edges) {
      if (edges[kk] === 1) boundary++;
      else if (edges[kk] > 2) nonManifold++;
    }
    var area = 0, vol = 0;
    var bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
    for (var i = 0; i < pos.length; i += 3) {
      for (var ax = 0; ax < 3; ax++) {
        var vv = pos[i + ax];
        if (vv < bmin[ax]) bmin[ax] = vv;
        if (vv > bmax[ax]) bmax[ax] = vv;
      }
    }
    for (var t2 = 0; t2 < idx.length; t2 += 3) {
      var p0 = [pos[idx[t2] * 3], pos[idx[t2] * 3 + 1], pos[idx[t2] * 3 + 2]];
      var p1 = [pos[idx[t2 + 1] * 3], pos[idx[t2 + 1] * 3 + 1], pos[idx[t2 + 1] * 3 + 2]];
      var p2 = [pos[idx[t2 + 2] * 3], pos[idx[t2 + 2] * 3 + 1], pos[idx[t2 + 2] * 3 + 2]];
      var cr = cross(sub(p1, p0), sub(p2, p0));
      area += len(cr) * 0.5;
      vol += dot(p0, cross(p1, p2)) / 6;
    }
    return {
      triangles: idx.length / 3,
      vertices: geo.vertexCount,
      boundaryEdges: boundary,
      nonManifoldEdges: nonManifold,
      area: area,
      volume: Math.abs(vol),
      bbox: { min: bmin, max: bmax, size: [bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]] }
    };
  }

  return {
    sdSphere: sdSphere, sdEllipsoid: sdEllipsoid, sdRoundCone: sdRoundCone,
    smin: smin, smax: smax, assemble: assemble,
    gradient: gradient, raycast: raycast,
    surfaceNets: surfaceNets, vertexColors: vertexColors, inspect: inspect,
    v: { dot: dot, len: len, norm: norm, sub: sub, add: add, mul: mul, lerp: lerp, lerp3: lerp3, cross: cross }
  };
});
