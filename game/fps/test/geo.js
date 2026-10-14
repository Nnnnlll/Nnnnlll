/* 程序化几何工具库 v2.0
   目标：不依赖任何外部资源，生成"圆润、不穿模"的人体部件几何。
   与 three r128 兼容（无 CapsuleGeometry / RoundedBoxGeometry）。

   设计原则（针对穿模）：
   - 四肢用 capsule（圆柱+两端半球），关节处再叠一颗同半径球
     → 关节旋转时接缝始终被球覆盖，既露不出缝也插不进躯干。
   - 躯干/头用 ellipsoid 或 lathe 旋转体，边缘天然圆润，没有盒体硬角。
   - 需要"方中带圆"的部件用 roundedBox（真圆角，平面保持平整不凹陷）。
   v2.0 修正：roundedBox 改用 Shape+ExtrudeGeometry 真圆角；
             segSegDist 改用 Ericson 算法（原平行分支算错）。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require(__dirname + '/lib/three.min.js'));
  else root.GEO = factory(root.THREE);
})(typeof self !== 'undefined' ? self : this, function (THREE) {
  'use strict';

  /* ---------- 全局细分系数（移动端降面数用） ---------- */
  var SEG_SCALE = 1.0;
  function setSegScale(s) { SEG_SCALE = Math.max(0.35, Math.min(1.6, s || 1)); }
  function getSegScale() { return SEG_SCALE; }
  function segs(n, min) { return Math.max(min || 4, Math.round(n * SEG_SCALE)); }

  /* ---------- 圆角矩形 2D 轮廓（供挤出用） ---------- */
  function roundedRectShape(w, h, r) {
    r = Math.max(1e-5, Math.min(r, w * 0.5, h * 0.5));
    var s = new THREE.Shape();
    var x = w / 2, y = h / 2;
    s.moveTo(-x + r, -y);
    s.lineTo(x - r, -y);
    s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x, y - r);
    s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
    s.lineTo(-x + r, y);
    s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-x, -y + r);
    s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  }

  /* ---------- 圆角盒：真圆角，六个面保持平整 ----------
     做法：取内缩核心盒（各面内缩 r），把每个顶点投到核心盒上，再沿该方向推 r。
     - 面内部顶点：方向纯法向 → 面严格保持平整，不会塌陷/鼓包
     - 棱/角顶点：自然得到圆角
     数学上外尺寸恒等于 w×h×d（r 取到半边长时退化为球，尺寸仍精确）。
     seg 越大圆角越顺滑：seg=4 → 192 面，seg=6 → 432 面。 */
  function roundedBox(w, h, d, r, seg) {
    seg = segs(seg || 4, 2);
    // seg 必须是偶数：网格必须包含中线，否则 r 很大时顶点覆盖不到面心，形状会缩水
    seg = Math.max(2, 2 * Math.round((seg || 4) / 2));
    r = Math.max(1e-5, Math.min(r, Math.min(w, h, d) * 0.5));
    var g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    var pos = g.attributes.position;
    var hx = Math.max(w / 2 - r, 0), hy = Math.max(h / 2 - r, 0), hz = Math.max(d / 2 - r, 0);
    var v = new THREE.Vector3(), c = new THREE.Vector3(), dir = new THREE.Vector3();
    for (var i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      c.set(
        Math.max(-hx, Math.min(hx, v.x)),
        Math.max(-hy, Math.min(hy, v.y)),
        Math.max(-hz, Math.min(hz, v.z))
      );
      dir.subVectors(v, c);
      var len = dir.length();
      if (len > 1e-9) { dir.multiplyScalar(r / len); pos.setXYZ(i, c.x + dir.x, c.y + dir.y, c.z + dir.z); }
      else pos.setXYZ(i, c.x, c.y, c.z);
    }
    g.computeVertexNormals();
    return g;
  }

  /* ---------- 胶囊：轴沿 +Y，中心在中点，h=圆柱段长度 ---------- */
  function capsule(rTop, rBot, h, radial, capSeg) {
    radial = segs(radial || 10, 6);
    capSeg = Math.max(2, Math.round((capSeg || 4) * SEG_SCALE));
    var stick = new THREE.CylinderGeometry(rTop, rBot, h, radial, 1, true);
    var top = new THREE.SphereGeometry(rTop, radial, capSeg, 0, Math.PI * 2, 0, Math.PI / 2);
    top.translate(0, h / 2, 0);
    var bot = new THREE.SphereGeometry(rBot, radial, capSeg, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    bot.translate(0, -h / 2, 0);
    return mergeGeos([stick, top, bot]);
  }

  /* ---------- 椭球：半轴 (rx, ry, rz) ---------- */
  function ellipsoid(rx, ry, rz, segW, segH) {
    var g = new THREE.SphereGeometry(1, segs(segW || 16, 6), segs(segH || 12, 4));
    g.scale(rx, ry, rz);
    return g;
  }

  /* ---------- 旋转体：2D 轮廓 [(r, y)...] 绕 Y 轴旋转 ---------- */
  function lathe(points, seg, phiStart, phiLen) {
    var pts = points.map(function (p) { return new THREE.Vector2(Math.max(p[0], 1e-5), p[1]); });
    var g = new THREE.LatheGeometry(pts, segs(seg || 16, 6), phiStart || 0, phiLen || Math.PI * 2);
    g.computeVertexNormals();
    return g;
  }

  /* ---------- 放样体：用一串椭圆截面环叠出平滑形体 ----------
     rings: [{ y, rx, rz, cz?, cx? }]，从下到上。
     得到的是椭圆截面（比 lathe 圆截面更像人体：胸宽>胸厚），
     相邻环之间四点连成四边形，法线自动平滑。 */
  function loft(rings, seg, capBottom, capTop) {
    seg = segs(seg || 14, 6);
    var layers = rings.length;
    var pos = [], idx = [];
    function ringPoint(r, a) {
      var cx = r.cx || 0, cz = r.cz || 0;
      return [cx + Math.cos(a) * r.rx, r.y, cz + Math.sin(a) * r.rz];
    }
    for (var i = 0; i < layers; i++) {
      for (var s = 0; s < seg; s++) {
        var p = ringPoint(rings[i], s / seg * Math.PI * 2);
        pos.push(p[0], p[1], p[2]);
      }
    }
    for (var i2 = 0; i2 < layers - 1; i2++) {
      for (var s2 = 0; s2 < seg; s2++) {
        var a0 = i2 * seg + s2, a1 = i2 * seg + (s2 + 1) % seg;
        var b0 = (i2 + 1) * seg + s2, b1 = (i2 + 1) * seg + (s2 + 1) % seg;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
    if (capBottom !== false) {
      var cb = pos.length / 3;
      var r0 = rings[0];
      pos.push(r0.cx || 0, r0.y, r0.cz || 0);
      for (var s3 = 0; s3 < seg; s3++) idx.push(cb, (s3 + 1) % seg, s3);
    }
    if (capTop !== false) {
      var ct = pos.length / 3, last = layers - 1, rl = rings[last];
      pos.push(rl.cx || 0, rl.y, rl.cz || 0);
      for (var s4 = 0; s4 < seg; s4++) {
        idx.push(ct, last * seg + s4, last * seg + (s4 + 1) % seg);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ---------- 合并几何 ---------- */
  function mergeGeos(geos) {
    var posArr = [], normArr = [], idxArr = [], offset = 0;
    geos.forEach(function (g) {
      var p = g.attributes.position, n = g.attributes.normal, idx = g.index;
      for (var i = 0; i < p.count; i++) {
        posArr.push(p.getX(i), p.getY(i), p.getZ(i));
        normArr.push(n.getX(i), n.getY(i), n.getZ(i));
      }
      if (idx) for (var j = 0; j < idx.count; j++) idxArr.push(idx.getX(j) + offset);
      else for (var k = 0; k < p.count; k++) idxArr.push(k + offset);
      offset += p.count;
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
    out.setIndex(idxArr);
    return out;
  }

  /* ---------- 两线段最近距离（Ericson 5.1.9） ---------- */
  function segSegDist(p1, q1, p2, q2) {
    var d1 = new THREE.Vector3().subVectors(q1, p1);
    var d2 = new THREE.Vector3().subVectors(q2, p2);
    var r = new THREE.Vector3().subVectors(p1, p2);
    var a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
    var s, t;
    if (a <= 1e-12 && e <= 1e-12) return p1.distanceTo(p2);
    if (a <= 1e-12) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
    else {
      var c = d1.dot(r);
      if (e <= 1e-12) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else {
        var b = d1.dot(d2);
        var denom = a * e - b * b;
        s = denom > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
        else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
      }
    }
    var c1 = new THREE.Vector3().copy(p1).addScaledVector(d1, s);
    var c2 = new THREE.Vector3().copy(p2).addScaledVector(d2, t);
    return c1.distanceTo(c2);
  }

  /* ---------- 点到线段距离 ---------- */
  function pointSegDist(p, a, b) {
    var ab = new THREE.Vector3().subVectors(b, a);
    var t = ab.lengthSq() > 1e-12 ? (new THREE.Vector3().subVectors(p, a)).dot(ab) / ab.lengthSq() : 0;
    t = Math.max(0, Math.min(1, t));
    return p.distanceTo(new THREE.Vector3().copy(a).addScaledVector(ab, t));
  }

  return {
    roundedRectShape: roundedRectShape, roundedBox: roundedBox,
    capsule: capsule, ellipsoid: ellipsoid, lathe: lathe, loft: loft,
    merge: mergeGeos, segSegDist: segSegDist, pointSegDist: pointSegDist,
    setSegScale: setSegScale, getSegScale: getSegScale, segs: segs
  };
});