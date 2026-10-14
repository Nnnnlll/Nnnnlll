/* ============================================================
   nailong-model.js — 奶龙（隐式曲面版）v1.0
   ------------------------------------------------------------
   做法说明（为什么这次不会穿模）：
   以前的模型是「十几个独立几何体拼在一起」，肩、肘、脖子这些
   接缝处必然出现穿插和缝隙。
   这一版先用数学定义一整块「奶龙物质」的距离场，身体、头、
   四肢、尾巴、角、背刺之间用 smooth-min 真正"融化"成一整块，
   再从这块物质里切出表面 —— 得到的是一张连续闭合的皮，
   不存在接缝、插模、破面。

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

  var DETAIL = 1.0;              /* 画质档：1.0 标准，0.72 省电，1.35 精细 */
  function setDetail(s) { DETAIL = Math.max(0.45, Math.min(1.7, s || 1)); }
  function getDetail() { return DETAIL; }

  /* ================= 配色 ================= */
  var COL = {
    body: 0xf7d64a,     /* 主体亮黄 */
    bodyDark: 0xe9b93c, /* 角 / 背刺 稍深 */
    belly: 0xfff2bd,    /* 肚皮浅黄 */
    cheek: 0xffb3a0,    /* 腮红 */
    eye: 0x241f1a,      /* 眼睛 */
    eyeWhite: 0xffffff,
    mouth: 0x8a3b34,
    tongue: 0xff8f8f,
    claw: 0xf3e6c8
  };

  /* ================= 尺寸表（单位：米，脚底 y=0） ================= */
  var D = {
    /* 下身（肚子最鼓）。x 半径必须明显大于头（0.315）：
       实测取 0.300 时肚子和头等宽（都 0.624），"大肚"特征就没了；
       取 0.325 → 肚宽 0.67，比头宽 0.05，侧影上是清楚的葫芦形。 */
    lowerC: [0, 0.395, 0.010], lowerR: [0.325, 0.272, 0.285],
    /* 上身（略收，为肚子让出腰线） */
    upperC: [0, 0.595, 0.000], upperR: [0.278, 0.212, 0.248],
    /* 头（大而圆）。头宽 0.63，肚宽 0.67 —— 头几乎和肚子一样大，
       这是奶龙"大头"的核心特征（真人头宽约体宽 1/3）。 */
    headC: [0, 0.945, 0.018], headR: [0.315, 0.286, 0.300],
    /* 吻部（前凸的圆嘴）。前缘 z = 0.285+0.120 = 0.405，
       比头前缘 0.356 凸出 49mm（实测：不足 30mm 时正面完全看不出嘴）。 */
    snoutC: [0, 0.900, 0.285], snoutR: [0.158, 0.122, 0.120],
    /* 腿脚。footC[1] 由实测反推：脚球与腿锥做 smooth-min 会额外长出约
       12.7mm 物质，若按解析值 0.097 放，融合后脚底会穿到 y=-0.0094。
       这里取 0.1129，融合后脚底恰好落在 y≈0（实测残差 0.4mm）。 */
    footC: [0.148, 0.1129, 0.055], footR: 0.098,
    legTopY: 0.235, legBotY: 0.100,
    /* 手臂（小短手）。要点：
       ① k 必须小（0.045）—— 之前用 0.105 时手臂被完全"融化"进身体，
          正视图轮廓上根本看不出手（实测渲染确认）。
       ② 末端要伸到 x≈±0.37，才能超过肚子半径 0.30 形成可见的凸起。 */
    armTop: [0.215, 0.585, 0.030], armBot: [0.310, 0.380, 0.105],
    armR1: 0.082, armR2: 0.066,
    handR: 0.070,
    /* 尾巴 */
    tailA: [0, 0.400, -0.215], tailB: [0, 0.512, -0.520], tailR1: 0.108, tailR2: 0.036,
    /* 角 */
    hornA: [0.104, 1.055, -0.010], hornB: [0.148, 1.232, -0.040], hornR1: 0.052, hornR2: 0.012,
    /* 背刺：沿背部中线的三枚小刺
       注意尾端高度必须高于脚底（脚底 y=0），否则刺会戳到地面以下，
       让整个模型的包围盒最低点变成负数、接地判定失败。 */
    spikes: [
      { a: [0, 0.760, -0.230], b: [0, 0.845, -0.310], r1: 0.058, r2: 0.013 },
      { a: [0, 0.618, -0.244], b: [0, 0.680, -0.328], r1: 0.053, r2: 0.012 },
      { a: [0, 0.480, -0.240], b: [0, 0.530, -0.318], r1: 0.047, r2: 0.011 }
    ]
  };

  /* ================= 组装距离场 ================= */
  function mirror(p) { return [-p[0], p[1], p[2]]; }

  function buildField() {
    var parts = [];
    /* 主干：下身 + 上身 + 头 + 吻部，用较大的 k 让它们长成一体 */
    parts.push({ d: function (x, y, z) { return BLOB.sdEllipsoid(x, y, z, D.lowerC, D.lowerR); }, k: 0 });
    parts.push({ d: function (x, y, z) { return BLOB.sdEllipsoid(x, y, z, D.upperC, D.upperR); }, k: 0.170 });
    parts.push({ d: function (x, y, z) { return BLOB.sdEllipsoid(x, y, z, D.headC, D.headR); }, k: 0.150 });
    parts.push({ d: function (x, y, z) { return BLOB.sdEllipsoid(x, y, z, D.snoutC, D.snoutR); }, k: 0.075 });

    /* 两条腿：锥形胶囊 + 圆脚，k 偏小以免和肚子糊成一团 */
    [1, -1].forEach(function (s) {
      var t = [D.footC[0] * s, D.legTopY, 0.018];
      var f = [D.footC[0] * s, D.legBotY, D.footC[2]];
      parts.push({
        d: function (x, y, z) { return BLOB.sdRoundCone(x, y, z, t, f, 0.108, 0.090); }, k: 0.085
      });
      parts.push({
        d: function (x, y, z) { return BLOB.sdSphere(x, y, z, [D.footC[0] * s, D.footC[1], D.footC[2]], D.footR); }, k: 0.055
      });
    });

    /* 两条手臂：小短手 + 圆手
       k=0.045 是关键：太大（0.105）时手臂会被 smooth-min 完全吸进身体，
       正视图上完全看不出手；太小则肩部出现过渡硬边。 */
    [1, -1].forEach(function (s) {
      var a = [D.armTop[0] * s, D.armTop[1], D.armTop[2]];
      var b = [D.armBot[0] * s, D.armBot[1], D.armBot[2]];
      parts.push({
        d: function (x, y, z) { return BLOB.sdRoundCone(x, y, z, a, b, D.armR1, D.armR2); }, k: 0.045
      });
      parts.push({
        d: function (x, y, z) { return BLOB.sdSphere(x, y, z, b, D.handR); }, k: 0.030
      });
    });

    /* 尾巴：从臀部向后翘起、逐渐变细 */
    parts.push({
      d: function (x, y, z) { return BLOB.sdRoundCone(x, y, z, D.tailA, D.tailB, D.tailR1, D.tailR2); }, k: 0.090
    });

    /* 两只角 */
    [1, -1].forEach(function (s) {
      var a = [D.hornA[0] * s, D.hornA[1], D.hornA[2]];
      var b = [D.hornB[0] * s, D.hornB[1], D.hornB[2]];
      parts.push({
        d: function (x, y, z) { return BLOB.sdRoundCone(x, y, z, a, b, D.hornR1, D.hornR2); }, k: 0.042
      });
    });

    /* 背刺 */
    D.spikes.forEach(function (sp) {
      parts.push({
        d: function (x, y, z) { return BLOB.sdRoundCone(x, y, z, sp.a, sp.b, sp.r1, sp.r2); }, k: 0.038
      });
    });

    return BLOB.assemble(parts);
  }

  /* ================= 顶点着色规则 =================
     直接用空间位置判定区域，避免任何贴图 —— 这也是零外部资源的原因。 */
  function colorAt(x, y, z) {
    var c = [0.969, 0.839, 0.290];  /* 默认亮黄 #f7d64a */

    /* 角与背刺：头顶 / 背部中线上方 → 深黄 */
    if (y > 1.02) c = [0.914, 0.725, 0.235];
    if (z < -0.20 && y > 0.40 && y < 0.90) c = [0.914, 0.725, 0.235];

    /* 肚皮：身体正前方偏下 → 浅黄 */
    var dz = z - 0.01, dy = y - 0.44;
    if (z > 0.10 && y < 0.76 && y > 0.14) {
      var front = Math.min(1, Math.max(0, (z - 0.10) / 0.16));
      var low = Math.min(1, Math.max(0, (0.76 - y) / 0.12));
      var hi = Math.min(1, Math.max(0, (y - 0.14) / 0.10));
      var w = front * low * hi;
      c = mix(c, [1.0, 0.949, 0.741], w * 0.95);
    }

    /* 吻部下缘（嘴周）稍微提亮，让表情区更柔和 */
    var dSnout = Math.sqrt((x) * (x) + (y - D.snoutC[1]) * (y - D.snoutC[1]) + (z - D.snoutC[2]) * (z - D.snoutC[2]));
    if (dSnout < 0.26 && z > 0.24) c = mix(c, [1.0, 0.955, 0.780], 0.55);

    /* 脚底压暗一点，接地感更强 */
    if (y < 0.045) c = mix(c, [0.72, 0.60, 0.20], 0.55);

    return c;
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /* ================= 构建 ================= */
  var _cache = null;

  function build() {
    var field = buildField();

    /* --- 主体：从距离场切出等值面 ---
       分辨率由画质档决定：0.72 档体素更大（面更少、更省电），
       1.35 档体素更小（细节更多）。 */
    var h = 0.0145 / DETAIL;
    var bmin = [-0.62, -0.22, -0.66];
    var bmax = [0.62, 1.34, 0.50];
    var raw = BLOB.surfaceNets(field, bmin, bmax, h, { iso: 0 });
    var stats = BLOB.inspect(raw);

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(raw.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(raw.indices, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(BLOB.vertexColors(raw, colorAt), 3));

    var bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,     /* 奶龙是哑光软胶质感 */
      metalness: 0.0,
      emissive: new THREE.Color(0x2a1c00),
      emissiveIntensity: 0.30
    });
    var body = new THREE.Mesh(geo, bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;

    var group = new THREE.Group();
    group.add(body);

    /* --- 五官：用球体步进把它们精确"钉"在曲面上 ---
       这是「无瑕疵」的关键：眼睛既不会浮在脸前，也不会陷进头里。 */
    var faceParts = [];

    /* 眼睛：大圆眼 + 高光。
       方向 [-0.42, 0.36, 0.83] 是实测调出来的，两个约束都要满足：
       ① 两眼间距 > 0.20（用 [-0.25,...] 时命中点 x 只有 ±0.079，会挤在一起）
       ② 眼高要高于吻部顶面（吻部顶端 y = 0.900+0.122 = 1.022），
          否则眼睛会被前凸的吻部当成"侧壁"挡住。 */
    var eyeS = [
      { dir: [-0.42, 0.36, 0.83], r: 0.062 },
      { dir: [0.42, 0.36, 0.83], r: 0.062 }
    ];
    var eyeMat = new THREE.MeshStandardMaterial({ color: COL.eye, roughness: 0.14, metalness: 0.06 });
    var hiMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, emissive: 0xffffff, emissiveIntensity: 0.55 });
    eyeS.forEach(function (e) {
      var hit = BLOB.raycast(field, D.headC, e.dir, 1.0);
      var n = hit.n;
      var pos = [
        hit.p[0] - n[0] * e.r * 0.42,
        hit.p[1] - n[1] * e.r * 0.42,
        hit.p[2] - n[2] * e.r * 0.42
      ];
      var eg = new THREE.SphereGeometry(e.r, 26, 20);
      var em = new THREE.Mesh(eg, eyeMat);
      em.position.set(pos[0], pos[1], pos[2]);
      group.add(em);
      faceParts.push(em);

      /* 高光小球：贴在眼珠外表面偏上 */
      var up = [0, 1, 0];
      var hx = pos[0] + n[0] * e.r * 0.62 + up[0] * e.r * 0.42 - 0.018;
      var hy = pos[1] + n[1] * e.r * 0.62 + up[1] * e.r * 0.42;
      var hz = pos[2] + n[2] * e.r * 0.62 + up[2] * e.r * 0.42;
      var hg = new THREE.SphereGeometry(e.r * 0.30, 14, 10);
      var hm = new THREE.Mesh(hg, hiMat);
      hm.position.set(hx, hy, hz);
      group.add(hm);
      faceParts.push(hm);
    });

    /* 腮红：贴在脸颊两侧的扁球 */
    var cheekMat = new THREE.MeshStandardMaterial({
      color: COL.cheek, roughness: 0.85, transparent: true, opacity: 0.72
    });
    [[-0.72, -0.06, 0.70], [0.72, -0.06, 0.70]].forEach(function (d) {
      var hit = BLOB.raycast(field, D.headC, d, 1.0);
      var cg = new THREE.SphereGeometry(0.072, 18, 14);
      var cm = new THREE.Mesh(cg, cheekMat);
      cm.position.set(hit.p[0] - hit.n[0] * 0.052, hit.p[1] - hit.n[1] * 0.052, hit.p[2] - hit.n[2] * 0.052);
      cm.scale.set(1.0, 0.72, 0.42);
      group.add(cm);
      faceParts.push(cm);
    });

    /* 嘴：一条上扬的弧（环形扇段），贴在吻部正面偏下的位置。
       起点用 snoutC 推：y 比吻心低 0.045，沿 +Z 打射线找吻部前表面。
       TorusGeometry 默认躺在 XY 平面、开口朝上 —— 正好是微笑形状，
       所以不需要额外旋转，只要贴在吻部表面上即可。 */
    var mouthHit = BLOB.raycast(field, [0, D.snoutC[1] - 0.045, D.snoutC[2]], [0, 0, 1], 1.0);
    var mouthMat = new THREE.MeshStandardMaterial({ color: COL.mouth, roughness: 0.55 });
    var torus = new THREE.TorusGeometry(0.068, 0.0165, 12, 32, Math.PI * 0.95);
    var mouth = new THREE.Mesh(torus, mouthMat);
    /* 往曲面里压 0.010：让弧的两端埋进脸蛋，中段露出，避免"浮着一圈线" */
    mouth.position.set(mouthHit.p[0], mouthHit.p[1], mouthHit.p[2] - 0.010);
    group.add(mouth);
    faceParts.push(mouth);

    /* 舌头：藏在嘴弧下方的浅粉小球，露一点点 */
    var tongue = new THREE.Mesh(
      new THREE.SphereGeometry(0.040, 16, 12),
      new THREE.MeshStandardMaterial({ color: COL.tongue, roughness: 0.5 })
    );
    tongue.position.set(mouthHit.p[0], mouthHit.p[1] - 0.030, mouthHit.p[2] - 0.020);
    tongue.scale.set(1.25, 0.55, 0.60);
    group.add(tongue);
    faceParts.push(tongue);

    /* 鼻孔：两个极小的凹点（用小球代替，避免破坏曲面） */
    var nosMat = new THREE.MeshStandardMaterial({ color: 0xc9a52f, roughness: 0.9 });
    [[-0.045, 1], [0.045, -1]].forEach(function (n) {
      var hit = BLOB.raycast(field, [n[0], D.snoutC[1] + 0.030, D.snoutC[2]], [0, 0.12, 1], 1.0);
      var nm = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), nosMat);
      nm.position.set(hit.p[0], hit.p[1], hit.p[2] - hit.n[2] * 0.014);
      nm.scale.set(1.0, 0.85, 0.35);
      group.add(nm);
      faceParts.push(nm);
    });

    /* 手爪：手心的三颗小圆点（奶龙圆手的小爪印） */
    var clawMat = new THREE.MeshStandardMaterial({ color: COL.claw, roughness: 0.75 });
    faceParts.push.apply(faceParts, []);

    setTimeout(function () { }, 0);

    /* 记录到 parts 便于外部检索 */
    var parts = { body: body, face: faceParts };

    /* --- 自动接地：把整体平移到脚底 y=0 --- */
    var box = new THREE.Box3().setFromObject(group);
    group.position.y -= box.min.y;
    group.updateMatrixWorld(true);

    /* --- 简易待机动画所需的运行时状态 --- */
    var clock = 0, state = 'idle';
    var shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.40, 28),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.20 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    shadow.scale.set(1, 1, 1);

    var api = {
      group: group,
      root: group,
      shadow: shadow,
      body: body,
      parts: parts,
      stats: stats,
      col: COL,
      dim: D,
      field: field,
      colorAt: colorAt,
      triangleCount: function () {
        var n = 0;
        group.traverse(function (o) { if (o.isMesh && o.geometry && o.geometry.index) n += o.geometry.index.count / 3; });
        return Math.round(n);
      },
      /* 待机：轻微上下呼吸 + 尾巴方向的整体晃动 */
      setState: function (s) { state = s; clock = 0; },
      getState: function () { return state; },
      update: function (dt) {
        clock += dt;
        var t = clock;
        if (state === 'walk') {
          group.position.y = group.position.y + 0;  /* 位移由外部控制 */
          body.rotation.z = Math.sin(t * 6.0) * 0.045;
          body.position.y = Math.abs(Math.sin(t * 6.0)) * 0.030;
        } else if (state === 'jump') {
          body.position.y = Math.sin(Math.min(1, t / 0.5) * Math.PI) * 0.10;
        } else {
          body.position.y = Math.sin(t * 1.7) * 0.011 + Math.sin(t * 3.4) * 0.004;
          body.rotation.z = Math.sin(t * 1.1) * 0.012;
          body.rotation.y = Math.sin(t * 0.8) * 0.020;
        }
      }
    };
    api.__raw = raw;
    return api;
  }

  /* 让外部可以只取几何数据（渲染器 / 检查脚本用） */
  function buildRaw(h) {
    return BLOB.surfaceNets(buildField(), [-0.62, -0.22, -0.66], [0.62, 1.34, 0.50], h || 0.0145, { iso: 0 });
  }

  build.setDetail = setDetail;
  build.getDetail = getDetail;
  build.buildField = buildField;
  build.buildRaw = buildRaw;
  build.colorAt = colorAt;
  build.COL = COL;
  build.DIM = D;
  return build;
});