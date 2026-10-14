/* ============================================================
   nailong2-model.js — 奶龙 v2.0（三视图逐像素重建版）
   ------------------------------------------------------------
   与 v1.0 的根本区别：v1.0 是"凭印象捏的"——有角、有背刺、
   有尾巴、黑眼睛、粉腮红、大红嘴，全是错的。

   v2.0 的形体数据全部来自对用户提供的三视图做逐行像素扫描
   （正视图 H=610px、侧视图 H=612px、背视图 H=608px），
   换算比例 1px = 1.30/610 m ≈ 2.131 mm。关键量测：

     高度       高/身宽      头宽       腹斑
     1.300 m    0.784 m     0.282 m     跨 y 0.531~0.916

     眼睛中心   左(-0.0799, 1.2105)  右(+0.0746, 1.2105)
     虹膜尺寸   宽 27px × 高 33px（竖椭圆）
     瞳孔尺寸   宽 12px × 高 19px
     手臂外缘   y=0.65 处 |x|=0.392（最外）
     手末端     深灰褐，从 y≈0.62 渐变到 y≈0.47
     脚末端     深灰褐，从 y≈0.10 渐变到 y≈0.025
     腿          从 y=0.36 的 r=0.079 锥形收到 y=0.107 的 r=0.026

   形体做法：把量测表直接当"剖面表"，逐高度插值出椭圆截面，
   合成一个放样体 —— 这样剪影和三视图逐行吻合，不靠猜。

   零外部模型文件、零贴图、零第三方库（只用 THREE + BLOB）。
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require(__dirname + '/lib/three.min.js'),
      require(__dirname + '/blob.js')
    );
  } else {
    root.buildNailong = factory(root.THREE, root.BLOB);
  }
})(typeof self !== 'undefined' ? self : this, function (THREE, BLOB) {
  'use strict';

  var DETAIL = 1.0;
  function setDetail(s) { DETAIL = Math.max(0.45, Math.min(1.7, s || 1)); }
  function getDetail() { return DETAIL; }

  /* ================= 配色（取自三视图采样，已按打光校正） ================= */
  var COL = {
    gold: 0xEFC33C,
    cream: 0xF2E4C8,
    hand: 0x6D5F4A,
    foot: 0x82704F,
    iris: 0x8CC765,
    pupil: 0x090B08,
    mouth: 0x7C5A16
  };

  /* ================= 形体剖面表 =================
     [ y, ax(左右半宽), bz(前后半深), cz(前后中心偏移) ]
     单位米，脚底 y=0，总高 1.30。 */
  var PROF = [
    [0.3300, 0.0015, 0.0015, 0.0100],
    [0.3320, 0.0380, 0.0090, 0.0100],
    [0.3350, 0.0700, 0.0170, 0.0100],
    [0.3400, 0.1180, 0.0300, 0.0100],
    [0.3480, 0.1660, 0.0480, 0.0100],
    [0.3580, 0.1980, 0.0660, 0.0100],
    [0.3680, 0.2150, 0.0790, 0.0100],
    [0.3780, 0.2227, 0.0906, 0.0100],
    [0.3990, 0.2227, 0.1172, 0.0000],
    [0.4130, 0.2227, 0.1513, 0.0000],
    [0.4260, 0.2250, 0.1673, 0.0010],
    [0.4420, 0.2310, 0.1759, 0.0020],
    [0.4770, 0.2461, 0.2078, 0.0020],
    [0.5290, 0.2664, 0.2288, 0.0060],
    [0.5800, 0.2813, 0.2483, 0.0070],
    [0.6500, 0.2853, 0.2525, 0.0070],
    [0.7050, 0.2829, 0.2504, 0.0050],
    [0.7580, 0.2745, 0.2429, -0.0020],
    [0.8130, 0.2620, 0.2280, -0.0110],
    [0.8670, 0.2480, 0.2110, -0.0240],
    [0.9200, 0.2330, 0.1908, -0.0350],
    [0.9750, 0.2160, 0.1737, -0.0420],
    [1.0300, 0.1900, 0.1609, -0.0370],
    [1.0830, 0.1570, 0.1572, -0.0212],
    [1.1380, 0.1407, 0.1572, 0.0042],
    [1.1920, 0.1289, 0.1391, 0.0117],
    [1.2454, 0.1129, 0.1105, 0.0169],
    [1.2574, 0.1023, 0.1000, 0.0175],
    [1.2659, 0.0948, 0.0925, 0.0180],
    [1.2744, 0.0842, 0.0820, 0.0185],
    [1.2831, 0.0725, 0.0705, 0.0190],
    [1.2915, 0.0554, 0.0540, 0.0200],
    [1.2955, 0.0420, 0.0410, 0.0203],
    [1.2985, 0.0300, 0.0292, 0.0206],
    [1.3010, 0.0015, 0.0015, 0.0210]
  ];

  /* ================= 剖面插值：单调三次 Hermite =================
     关键：不能用线性插值。线性插值让每两个采样点之间是直线段，
     剪影上会出现肉眼可见的"折线/棱面"，这正是"不圆润"的主因。
     用 Fritsch–Carlson 单调三次插值可以同时做到：
       ① C¹ 连续（曲面光滑，无棱线）
       ② 不过冲（不会在数据拐点处鼓出小球包，剪影仍贴合参考）
     普通 Catmull-Rom 只满足①不满足②，会把腰身顶出去。 */
  var TAN = null;

  function buildTangents() {
    var n = PROF.length, c, i;
    TAN = [[], [], []];
    for (c = 0; c < 3; c++) {
      var col = c + 1;                       /* 对应 ax / bz / cz */
      var m = new Array(n), d = new Array(n - 1);
      for (i = 0; i < n - 1; i++) {
        d[i] = (PROF[i + 1][col] - PROF[i][col]) / (PROF[i + 1][0] - PROF[i][0]);
      }
      m[0] = d[0];
      m[n - 1] = d[n - 2];
      for (i = 1; i < n - 1; i++) {
        m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) * 0.5;
      }
      /* 限制子区间切线，保证不越界过冲 */
      for (i = 0; i < n - 1; i++) {
        if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
        var a = m[i] / d[i], b = m[i + 1] / d[i];
        var s = a * a + b * b;
        if (s > 9) {
          var tt = 3 / Math.sqrt(s);
          m[i] = tt * a * d[i];
          m[i + 1] = tt * b * d[i];
        }
      }
      TAN[c] = m;
    }
  }
  buildTangents();

  function profAt(y) {
    var n = PROF.length;
    if (y <= PROF[0][0]) return PROF[0];
    if (y >= PROF[n - 1][0]) return PROF[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (PROF[mid][0] <= y) lo = mid; else hi = mid;
    }
    var a = PROF[lo], b = PROF[hi];
    var h = b[0] - a[0];
    var t = (y - a[0]) / h;
    var t2 = t * t, t3 = t2 * t;
    var h00 = 2 * t3 - 3 * t2 + 1;
    var h10 = t3 - 2 * t2 + t;
    var h01 = -2 * t3 + 3 * t2;
    var h11 = t3 - t2;
    var out = [y];
    for (var c = 0; c < 3; c++) {
      var m0 = TAN[c][lo], m1 = TAN[c][hi];
      out.push(h00 * a[c + 1] + h10 * h * m0 + h01 * b[c + 1] + h11 * h * m1);
    }
    return out;
  }

  /* 放样体 SDF：按高度插值椭圆截面。越出表范围就沿 y 外推，
     让头顶与胯下自然闭合，不出现平盖。 */
  function loft(x, y, z) {
    var p = profAt(y);
    var yc = p[0], ax = p[1], bz = p[2], cz = p[3];
    if (ax < 1e-4) ax = 1e-4;
    if (bz < 1e-4) bz = 1e-4;
    var r = ax < bz ? ax : bz;
    if (r < 0.004) r = 0.004;
    var ux = x / ax, uz = (z - cz) / bz;
    var q = Math.sqrt(ux * ux + uz * uz);
    return (q - 1) * r + Math.abs(y - yc);
  }

  /* ================= 四肢：按三视图像素量出的链式骨架 =================
     每项 [x, y, z, r]，x 取正侧，另一侧镜像。

     重要修正（实测驱动）：smooth-min 融合会在接缝处"鼓"出来，
     量测显示鼓出量随 k 变化、肩部可达 30~40mm。所以这里的半径是
     「参考剪影外缘 − 实测鼓出量」，不是参考值本身。 */
  /* 手臂轴心与半径：由「参考剪影外缘」反解。
     axis = 外缘 − 半径 − 融合鼓起量(≈8mm)。
     半径从肩 0.078 收手 0.036，与参考里"圆润小短手"一致。 */
  var ARM = [
    [0.128, 0.988, 0.018, 0.048],
    [0.176, 0.945, 0.024, 0.070],
    [0.2135, 0.920, 0.030, 0.0780],
    [0.2495, 0.867, 0.038, 0.0760],
    [0.2782, 0.813, 0.046, 0.0740],
    [0.3014, 0.758, 0.054, 0.0700],
    [0.3170, 0.705, 0.061, 0.0650],
    [0.3232, 0.650, 0.067, 0.0610],
    [0.3197, 0.595, 0.071, 0.0580],
    [0.3120, 0.542, 0.074, 0.0540],
    [0.3065, 0.488, 0.076, 0.0500],
    [0.2901, 0.433, 0.078, 0.0440],
    [0.2880, 0.418, 0.079, 0.0360]
  ];

  /* 腿轴心与半径：FRONT 参考里腿是两段分离的，
     取每侧 [内缘, 外缘] 反解 → axis=(内+外)/2, r=(外−内)/2。
       y=0.337 内0.0693 外0.2227 → axis 0.146 r 0.0767
       y=0.299 内0.0884 外0.2205 → axis 0.154 r 0.0660
       y=0.247 内0.1033 外0.2185 → axis 0.161 r 0.0576
       y=0.196 内0.1204 外0.2141 → axis 0.167 r 0.0469
       y=0.144 内0.1417 外0.2098 → axis 0.176 r 0.0340
       y=0.107 内0.1673 外0.2161 → axis 0.192 r 0.0244 */
  var LEG = [
    [0.1460, 0.410, -0.010, 0.0750],
    [0.1465, 0.360, -0.012, 0.0770],
    [0.1500, 0.311, -0.014, 0.0740],
    [0.1520, 0.299, -0.015, 0.0660],
    [0.1560, 0.270, -0.016, 0.0620],
    [0.1610, 0.247, -0.018, 0.0576],
    [0.1670, 0.196, -0.020, 0.0469],
    [0.1760, 0.144, -0.022, 0.0340],
    [0.1920, 0.107, -0.023, 0.0244],
    [0.1960, 0.090, -0.023, 0.0270]
  ];

  /* 脚：脚掌扁垫 + 前方趾垫 + 三枚脚趾。
     参考量测要点：
       y=0.108 侧面 z 0.040~0.157（深 0.117）
       y=0.055 侧面 z 0.022~0.266（深 0.244，趾垫前伸）
       y=0.026 正视图外缘 0.326（趾垫外凸）
     脚底必须严格落在 y=0：中心高度 = ry + 0.002，
     否则整个角色会悬空（上一版就悬了 10mm）。 */
  var FOOT_C = [0.186, 0.042, 0.062];
  var FOOT_R = [0.120, 0.040, 0.130];
  var FOOT_PAD_C = [0.196, 0.028, 0.150];
  var FOOT_PAD_R = [0.115, 0.026, 0.115];
  var TOES = [
    [-0.070, 0.175], [0.000, 0.195], [0.070, 0.175]
  ];

  function mirrorPts(list, s) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push([list[i][0] * s, list[i][1], list[i][2], list[i][3]]);
    }
    return out;
  }

  function chainSD(pts, x, y, z, k) {
    var d = 1e9;
    for (var i = 0; i + 1 < pts.length; i++) {
      var a = pts[i], b = pts[i + 1];
      var dd = BLOB.sdRoundCone(x, y, z,
        [a[0], a[1], a[2]], [b[0], b[1], b[2]], a[3], b[3]);
      d = (i === 0) ? dd : BLOB.smin(d, dd, k);
    }
    return d;
  }

  function footSD(x, y, z, s) {
    var cx = FOOT_C[0] * s;
    var d = BLOB.sdEllipsoid(x, y, z, [cx, FOOT_C[1], FOOT_C[2]], FOOT_R);
    /* 前方趾垫：参考里脚掌底部前方明显外凸 */
    d = BLOB.smin(d, BLOB.sdEllipsoid(x, y, z,
      [FOOT_PAD_C[0] * s, FOOT_PAD_C[1], FOOT_PAD_C[2]], FOOT_PAD_R), 0.030);
    for (var i = 0; i < TOES.length; i++) {
      var tx = cx + TOES[i][0] * s;
      var tz = FOOT_C[2] + TOES[i][1];
      var dd = BLOB.sdSphere(x, y, z, [tx, FOOT_C[1] - 0.002, tz], 0.028);
      d = BLOB.smin(d, dd, 0.018);
    }
    return d;
  }

  /* ================= 组装距离场 =================
     融合系数是实测调出来的：k 越大接缝越圆但越"鼓"，
     会让剪影超出参考。手臂 k 取 0.022、腿 k 取 0.026，
     在"看不出接缝"和"不外扩"之间取平衡。 */
  function buildField() {
    var armR = mirrorPts(ARM, 1), armL = mirrorPts(ARM, -1);
    var legR = mirrorPts(LEG, 1), legL = mirrorPts(LEG, -1);

    return function (x, y, z) {
      var d = loft(x, y, z);
      d = BLOB.smin(d, chainSD(armR, x, y, z, 0.020), 0.022);
      d = BLOB.smin(d, chainSD(armL, x, y, z, 0.020), 0.022);
      d = BLOB.smin(d, chainSD(legR, x, y, z, 0.020), 0.026);
      d = BLOB.smin(d, chainSD(legL, x, y, z, 0.020), 0.026);
      d = BLOB.smin(d, footSD(x, y, z, 1), 0.024);
      d = BLOB.smin(d, footSD(x, y, z, -1), 0.024);
      return d;
    };
  }

  /* ================= 顶点着色 ================= */
  var C_GOLD = [0.937, 0.765, 0.235];
  var C_CREAM = [0.949, 0.894, 0.784];
  var C_HAND = [0.427, 0.373, 0.290];
  var C_FOOT = [0.510, 0.435, 0.318];

  /* 腹斑椭圆（三视图量测）：中心 0.7235，半高 0.1928，
     周向半张角 1.355 rad。 */
  var PATCH_CY = 0.7235, PATCH_RY = 0.1928, PATCH_PSI = 1.355;

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t];
  }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function sstep(e0, e1, x) { return clamp01((x - e0) / (e1 - e0)); }

  function armHit(x, y, z) {
    var s = x >= 0 ? 1 : -1;
    return chainSD(mirrorPts(ARM, s), x, y, z, 0.020) < 0.012;
  }
  function footHit(x, y, z) {
    var s = x >= 0 ? 1 : -1;
    return footSD(x, y, z, s) < 0.012;
  }

  function colorAt(x, y, z) {
    var c = C_GOLD;

    /* 腹斑：奶白色大椭圆 */
    if (y > 0.45 && y < 1.00) {
      var p = profAt(y);
      var ax = p[1], bz = p[2], cz = p[3];
      if (ax > 0.02 && bz > 0.02) {
        var ux = x / ax, uz = (z - cz) / bz;
        var psi = Math.atan2(ux, uz);
        var e = (psi / PATCH_PSI) * (psi / PATCH_PSI) +
          ((y - PATCH_CY) / PATCH_RY) * ((y - PATCH_CY) / PATCH_RY);
        if (e < 1.0) {
          c = mix(c, C_CREAM, sstep(1.0, 0.82, e));
        }
      }
    }

    /* 手末端：深灰褐 */
    if (y < 0.66 && Math.abs(x) > 0.26) {
      if (armHit(x, y, z)) {
        c = mix(c, C_HAND, sstep(0.62, 0.47, y));
      }
    }

    /* 脚末端：深灰褐 */
    if (y < 0.16) {
      if (footHit(x, y, z) || y < 0.105) {
        c = mix(c, C_FOOT, sstep(0.105, 0.025, y));
      }
    }

    return c;
  }

  /* ================= 构建 =================
   两种模式：
   ① 实时构建：从距离场跑 Surface Nets（服务器/桌面调试用，手机要等 1~3 分钟）
   ② 烘焙加载：直接读预生成的顶点/索引数据（页面用，秒开）
   页面通过 window.__NAILONG_GEO__ 提供烘焙数据即自动走 ②。 */
  function buildRaw(h) {
    return BLOB.surfaceNets(buildField(), [-0.46, -0.06, -0.40], [0.46, 1.36, 0.40],
      h || 0.0145, { iso: 0 });
  }

  /* 从烘焙数据还原几何。数据格式：
     { scale, base:[3], verts, idxType,
       positions: Int16Array(3*verts),   // q = round((val-base)/scale) - 32768
       colors:    Uint8Array(3*verts),   // 每分量 0~255
       indices:   Uint16Array/Uint32Array }
     还原：val = (q + 32768) * scale + base[axis] */
  function geoFromBaked(g) {
    var n = g.verts * 3;
    var pos = new Float32Array(n);
    var s = g.scale, b0 = g.base[0], b1 = g.base[1], b2 = g.base[2];
    var q = g.positions;
    for (var i = 0; i < n; i += 3) {
      pos[i] = (q[i] + 32768) * s + b0;
      pos[i + 1] = (q[i + 1] + 32768) * s + b1;
      pos[i + 2] = (q[i + 2] + 32768) * s + b2;
    }
    /* 颜色已烘焙则直接用，省掉逐顶点 atan2/sqrt（手机上几百毫秒） */
    var cols = null;
    if (g.colors) {
      cols = new Float32Array(n);
      for (var c = 0; c < n; c++) cols[c] = g.colors[c] / 255;
    }
    return {
      positions: pos,
      colors: cols,
      indices: g.indices,
      vertexCount: g.verts,
      triangleCount: g.indices.length / 3,
      baked: true
    };
  }

  function build() {
    var field = buildField();
    var baked = (typeof window !== 'undefined') && window.__NAILONG_GEO__;
    var raw, stats, h;

    if (baked) {
      raw = geoFromBaked(baked);
      /* 法线由顶点位置重算（比烘焙更省空间，且精度足够） */
      h = baked.scale;
    } else {
      h = 0.0145 / DETAIL;
      raw = buildRaw(h);
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3));
    if (!baked) {
      geo.setAttribute('normal', new THREE.BufferAttribute(raw.normals, 3));
    }
    geo.setIndex(new THREE.BufferAttribute(raw.indices, 1));
    if (raw.colors) {
      geo.setAttribute('color', new THREE.BufferAttribute(raw.colors, 3));
    } else {
      geo.setAttribute('color', new THREE.BufferAttribute(BLOB.vertexColors(raw, colorAt), 3));
    }
    if (baked) geo.computeVertexNormals();
    stats = BLOB.inspect(raw);

    /* 奶龙是哑光软胶质感：粗糙度偏高、无金属感，
       再叠一点极弱的自发光抬暗部，避免阴影里发死。 */
    var bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.66,
      metalness: 0.0,
      emissive: new THREE.Color(0x3a2c08),
      emissiveIntensity: 0.16,
      flatShading: false
    });
    var body = new THREE.Mesh(geo, bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;

    var group = new THREE.Group();
    group.add(body);

    var faceParts = [];
    var UPV = new THREE.Vector3(0, 0, 1);

    /* 眼睛：绿色竖椭圆虹膜 + 近黑瞳孔。
     位置不是目测的 —— 把参考量测的眼睛中心 (±0.0770, 1.2105)
     代进放样椭圆反解出该处表面 z≈0.1325，再让射线只在 y=1.2105
     这一水平面内前进。这样命中点的 y 必然等于参考值，
     x 也必然落在参考的间距上。

     关键：所有五官都挂到 body 上（不是 group）。
     因为动画改的是 body 的 position/rotation/scale，
     挂在 group 上就会出现"身体动了、脸留在原地"的脱节感。 */
    var EYE_Y = 1.2105;
    var eyeDirs = [
      { dir: [-0.5401, 0, 0.8416] },
      { dir: [0.5401, 0, 0.8416] }
    ];
    var irisMat = new THREE.MeshStandardMaterial({ color: COL.iris, roughness: 0.34, metalness: 0.02 });
    var pupilMat = new THREE.MeshStandardMaterial({ color: COL.pupil, roughness: 0.18, metalness: 0.04 });

    eyeDirs.forEach(function (e) {
      var hit = BLOB.raycast(field, [0, EYE_Y, -0.02], e.dir, 1.2);
      if (!hit.found) return;
      var n = new THREE.Vector3(hit.n[0], hit.n[1], hit.n[2]).normalize();
      var q = new THREE.Quaternion().setFromUnitVectors(UPV, n);

      /* 虹膜 27px 宽 × 33px 高；再往前贴一点让眼球有立体凸起 */
      var iris = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), irisMat);
      iris.scale.set(0.029, 0.035, 0.021);
      iris.quaternion.copy(q);
      iris.position.set(hit.p[0] - n.x * 0.004, hit.p[1] - n.y * 0.004, hit.p[2] - n.z * 0.004);
      body.add(iris); faceParts.push(iris);

      /* 瞳孔 12px 宽 × 19px 高 */
      var pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), pupilMat);
      pupil.scale.set(0.0130, 0.0202, 0.013);
      pupil.quaternion.copy(q);
      pupil.position.set(hit.p[0] - n.x * 0.001, hit.p[1] - n.y * 0.001, hit.p[2] - n.z * 0.001);
      body.add(pupil); faceParts.push(pupil);

      /* 高光：让眼睛"活"起来的关键，没有它眼神是死的。
         定位不能只沿法线推 —— 那样高光会跑到眼球正中央。
         正确做法：在眼球表面建一个局部切平面坐标系
         （n = 法线朝外，up = 世界上方向在切平面上的投影，right = n × up），
         然后沿 up 偏上、沿 right 偏内侧放高光，模拟左上方的光源反射。 */
      var worldUp = new THREE.Vector3(0, 1, 0);
      var right = new THREE.Vector3().crossVectors(n, worldUp);
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
      right.normalize();
      var upT = new THREE.Vector3().crossVectors(right, n).normalize();

      var glint = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, emissive: 0xffffff, emissiveIntensity: 0.75 })
      );
      glint.scale.set(0.0062, 0.0072, 0.0045);
      glint.quaternion.copy(q);
      var gn = new THREE.Vector3(hit.p[0], hit.p[1], hit.p[2]);
      /* 先回到眼球中心附近，再沿三个轴偏移 —— 保证高光贴在球面上 */
      gn.addScaledVector(n, 0.0145);
      gn.addScaledVector(upT, 0.0092);
      gn.addScaledVector(right, -0.0058);
      glint.position.copy(gn);
      body.add(glint); faceParts.push(glint);
    });

    /* 嘴：极细上扬弧。参考里嘴线在 y≈1.145（正视图 151px 处的暗线），
       是一条约 27px 宽、极浅的细弧，不是大嘴。 */
    var mouthHit = BLOB.raycast(field, [0, 1.145, 0], [0, 0, 1], 1.2);
    if (mouthHit.found) {
      var mA = 1.5;
      var torus = new THREE.TorusGeometry(0.029, 0.0035, 10, 48, mA);
      var mouth = new THREE.Mesh(torus,
        new THREE.MeshStandardMaterial({ color: COL.mouth, roughness: 0.6 }));
      mouth.rotation.z = 4.712 - mA / 2;
      mouth.position.set(mouthHit.p[0], mouthHit.p[1], mouthHit.p[2] - 0.0040);
      body.add(mouth); faceParts.push(mouth);
    }

    /* 自动接地 */
    var box = new THREE.Box3().setFromObject(group);
    group.position.y -= box.min.y;
    group.updateMatrixWorld(true);

    /* ================= 动画 =================
     原则：
     ① 五官挂在 body 上，body 一动脸就跟着动 —— 不会再"脸留在原地"。
     ② 用 squash & stretch（挤压拉伸）而不是单纯上下平移：
        下蹲时变矮变胖(y↓x/z↑)、跳起时变高变瘦，这是卡通角色"活"的核心。
     ③ 相位错开：呼吸、摇摆、眨眼频率不同，避免机械同步感。
     ④ 眨眼：定期把虹膜纵向压扁，这是最廉价也最有效的"生命感"来源。 */
    var clock = 0, state = 'idle', blinkT = 0, blinkNext = 2.4;
    var irisList = faceParts.filter(function (o) {
      return o.material && o.material.color && o.material.color.getHex() === COL.iris;
    });
    var baseIrisScale = [0.029, 0.035, 0.021];

    var api = {
      group: group,
      root: group,
      body: body,
      parts: { body: body, face: faceParts },
      stats: stats,
      col: COL,
      dim: { PROF: PROF, ARM: ARM, LEG: LEG, FOOT_C: FOOT_C, FOOT_R: FOOT_R },
      field: field,
      colorAt: colorAt,
      profAt: profAt,
      triangleCount: function () {
        var n = 0;
        group.traverse(function (o) {
          if (o.isMesh && o.geometry && o.geometry.index) n += o.geometry.index.count / 3;
        });
        return Math.round(n);
      },
      setState: function (s) { state = s; clock = 0; },
      getState: function () { return state; },
      update: function (dt) {
        clock += dt;
        var t = clock;

        /* --- 眨眼：独立计时，与呼吸不同频 --- */
        blinkT += dt;
        var blink = 0;
        if (blinkT > blinkNext) {
          var p = (blinkT - blinkNext) / 0.13;          /* 眨眼历时 0.13s */
          if (p < 1) blink = Math.sin(p * Math.PI);      /* 0→1→0 */
          else { blinkT = 0; blinkNext = 1.8 + Math.random() * 3.2; }
        }

        /* --- 每帧先把身体归位，再叠加动作（避免累积漂移） --- */
        body.position.set(0, 0, 0);
        body.rotation.set(0, 0, 0);
        body.scale.set(1, 1, 1);

        if (state === 'walk') {
          /* 走动：左右摇摆 + 上下起伏 + 挤压拉伸 + 朝向微转 */
          var w = t * 5.4;
          body.position.y = Math.abs(Math.sin(w)) * 0.048;
          body.rotation.z = Math.sin(w * 0.5) * 0.070;
          body.rotation.y = Math.sin(w * 0.5) * 0.075;
          var sq = Math.sin(w);
          body.scale.set(1 + sq * 0.030, 1 - sq * 0.040, 1 + sq * 0.030);
        } else if (state === 'jump') {
          /* 跳跃：起跳前压扁蓄力 → 空中拉长 → 落地再压扁 */
          var jt = Math.min(t, 1.25);
          if (jt < 0.18) {
            var k = jt / 0.18;
            body.scale.set(1 + k * 0.11, 1 - k * 0.13, 1 + k * 0.11);
            body.position.y = -k * 0.018;
          } else if (jt < 0.95) {
            var k2 = (jt - 0.18) / 0.77;
            var hop = Math.sin(k2 * Math.PI);
            body.position.y = hop * 0.30;
            body.scale.set(1 - hop * 0.055, 1 + hop * 0.075, 1 - hop * 0.055);
            body.rotation.z = Math.sin(k2 * Math.PI * 2) * 0.05;
          } else {
            var k3 = Math.min((jt - 0.95) / 0.30, 1);
            var land = Math.sin(k3 * Math.PI) * Math.exp(-k3 * 2.4);
            body.scale.set(1 + land * 0.075, 1 - land * 0.090, 1 + land * 0.075);
          }
        } else {
          /* 待机呼吸：三个不同频率叠加，看起来更自然（不机械） */
          var br = Math.sin(t * 1.55);
          var br2 = Math.sin(t * 3.1 + 0.7);
          body.position.y = br * 0.0115 + br2 * 0.0035;
          body.scale.set(1 - br * 0.011, 1 + br * 0.016, 1 - br * 0.011);
          body.rotation.z = Math.sin(t * 0.72) * 0.0135;
          body.rotation.y = Math.sin(t * 0.51 + 1.2) * 0.0210;
          body.rotation.x = Math.sin(t * 0.63 + 0.4) * 0.0080;
        }

        /* --- 眨眼施加到虹膜（在 body 局部坐标下压扁 y） --- */
        if (blink > 0.001) {
          var s = 1 - blink * 0.94;
          for (var i = 0; i < irisList.length; i++) {
            irisList[i].scale.set(baseIrisScale[0], baseIrisScale[1] * s, baseIrisScale[2]);
          }
        } else if (irisList.length) {
          for (var j = 0; j < irisList.length; j++) {
            irisList[j].scale.set(baseIrisScale[0], baseIrisScale[1], baseIrisScale[2]);
          }
        }
      }
    };
    api.__raw = raw;
    return api;
  }

  build.setDetail = setDetail;
  build.getDetail = getDetail;
  build.buildField = buildField;
  build.buildRaw = buildRaw;
  build.colorAt = colorAt;
  build.profAt = profAt;
  build.COL = COL;
  build.PROF = PROF;
  build.ARM = ARM;
  build.LEG = LEG;
  build.FOOT_C = FOOT_C;
  build.FOOT_R = FOOT_R;
  return build;
});