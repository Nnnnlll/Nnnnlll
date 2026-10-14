/* 程序化卡通士兵 v3.0 —— 圆润形体版（重做，解决 v2.0 穿模与简陋）
   与 v2.0 的根本区别：
   ① 形体用 loft 放样（椭圆截面 + 腰线 + 胸廓 + 颈肩过渡），不是盒体堆叠
   ② 四肢用 capsule，关节处叠同半径球体填缝 → 旋转也不会露缝/插进躯干
   ③ 细节层：手指、掌、靴（鞋底+鞋帮+鞋头）、腰带扣、战术口袋、护膝、
              肩章、领口、枪的弹匣/护木/准星/照门/扳机/弹匣卡榫
   ④ 材质分档（skin/cloth/leather/metal/wood/accent），便于换配色与做质感
   零外部资源：全部几何程序化生成，无贴图、无模型文件。
   同时支持浏览器(全局 THREE + GEO) 与 Node(require)。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require(__dirname + '/lib/three.min.js'), require(__dirname + '/geo.js'));
  } else {
    root.buildSoldier = factory(root.THREE, root.GEO);
  }
})(typeof self !== 'undefined' ? self : this, function (THREE, GEO) {
  'use strict';

  /* ============ 配色：五档材质 ============ */
  var COL = {
    skin: 0xf2c19b, skinShade: 0xdda379,
    hair: 0x3b2a1d,
    shirtMain: 0xd8604a, shirtFold: 0xb84a38,            // 砖红上衣
    pantsMain: 0x46566b, pantsFold: 0x37455a,            // 石板蓝裤
    beltMain: 0xc99a4a, beltBuckle: 0xe8c469,            // 腰带
    bootMain: 0x6b4527, bootSole: 0x2a2320, bootCap: 0x5a3a20,
    glove: 0x2c3a42, gearMain: 0x3f4a52, gearStrap: 0x2b333a,   // 战术装具
    metalDark: 0x2f353b, metalMid: 0x454d55, metalLight: 0x6a747d, // 枪
    wood: 0x8a6042, accent: 0xe8b23c, visor: 0x8fd8e8
  };

  /* ============ 尺寸（脚底 y = 0） ============ */
  var DIM = {
    footH: 0.10, shinL: 0.418, thighL: 0.43,    // 髋 y = 0.95，脚底恰好 y = 0
    hipY: 0.95,
    torsoTop: 0.55,                              // 躯干放样相对髋的高度
    neckUp: 0.20,                                // 颈长：决定头的基准高度（下巴刚好搭住脖子）
    headH: 0.44,                                 // 头顶 y ≈ 1.83
    shoulderY: 0.47, shoulderX: 0.235,           // 肩相对躯干原点 → 世界 1.42
    upperArm: 0.30, foreArm: 0.27, handL: 0.11,
    hipX: 0.115
  };
  DIM.headBaseY = DIM.hipY + DIM.torsoTop + DIM.neckUp;   // ≈ 1.49 颈根/下颌

  /* 关节半径：既是capsule半径，也是填缝球半径 */
  var R = {
    hip: 0.125, knee: 0.095, ankle: 0.075, thigh: 0.115, shin: 0.088,
    shoulder: 0.105, elbow: 0.082, wrist: 0.062, upperArm: 0.092, foreArm: 0.070,
    neck: 0.085
  };

  /* ============ 材质 ============ */
  var MATS = {
    skin: { color: COL.skin, rough: 0.75 },
    skinShade: { color: COL.skinShade, rough: 0.78 },
    hair: { color: COL.hair, rough: 0.65 },
    shirt: { color: COL.shirtMain, rough: 0.88 },
    shirtFold: { color: COL.shirtFold, rough: 0.9 },
    pants: { color: COL.pantsMain, rough: 0.9 },
    pantsFold: { color: COL.pantsFold, rough: 0.92 },
    belt: { color: COL.beltMain, rough: 0.6 },
    buckle: { color: COL.beltBuckle, rough: 0.35, metal: 0.7 },
    boot: { color: COL.bootMain, rough: 0.7 },
    bootSole: { color: COL.bootSole, rough: 0.95 },
    glove: { color: COL.glove, rough: 0.75 },
    gear: { color: COL.gearMain, rough: 0.85 },
    strap: { color: COL.gearStrap, rough: 0.9 },
    metalDark: { color: COL.metalDark, rough: 0.45, metal: 0.75 },
    metalMid: { color: COL.metalMid, rough: 0.4, metal: 0.8 },
    metalLight: { color: COL.metalLight, rough: 0.3, metal: 0.9 },
    wood: { color: COL.wood, rough: 0.65 },
    accent: { color: COL.accent, rough: 0.45 },
    visor: { color: COL.visor, rough: 0.15, emissive: 0x2a6a78 }
  };

  function makeMat(name) {
    var m = MATS[name] || MATS.gear;
    if (THREE.MeshStandardMaterial) {
      var mat = new THREE.MeshStandardMaterial({
        color: m.color, roughness: m.rough === undefined ? 0.8 : m.rough,
        metalness: m.metal || 0.02
      });
      if (m.emissive) { mat.emissive = new THREE.Color(m.emissive); mat.emissiveIntensity = 0.5; }
      return mat;
    }
    return new THREE.MeshLambertMaterial({ color: m.color });
  }

  /* ============ 小工具 ============ */
  function addMesh(parent, geo, matName, opt) {
    opt = opt || {};
    var mesh = new THREE.Mesh(geo, makeMat(matName));
    if (opt.pos) mesh.position.fromArray(opt.pos);
    if (opt.rot) mesh.rotation.fromArray(opt.rot);
    if (opt.scale) mesh.scale.fromArray(opt.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  }

  /* ============ 主构建 ============ */
  function build() {
    var group = new THREE.Group();
    var root = new THREE.Group();     // 只用于贴地平移
    group.add(root);
    var body = new THREE.Group();     // 倒地时整体旋转
    root.add(body);

    /* ---------- 地面阴影（薄椭球，水平放置，不旋转） ---------- */
    var shadowGeo = GEO.ellipsoid(0.40, 0.004, 0.30, 18, 3);
    var shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({
      color: 0x0a0d10, transparent: true, opacity: 0.26, depthWrite: false
    }));
    shadow.position.y = 0.006;
    group.add(shadow);

    /* ---------- 躯干：椭圆截面放样（含腰线/胸廓/颈肩过渡） ---------- */
    var torso = new THREE.Group();
    torso.position.y = DIM.hipY;
    body.add(torso);

    var H = DIM.torsoTop;

    /* 躯干放样环（局部坐标，原点在髋）：从骨盆底一直到颈根
       —— 关键改进：环一直延伸到 y=-0.14（世界 0.81），让骨盆是实心的，
          大腿从骨盆里长出来，而不是两根柱子顶在腰上 */
    var torsoRings = [
      { y: -0.140, rx: 0.150, rz: 0.108, cz: 0.006 },   // 骨盆底（收进去）
      { y: -0.070, rx: 0.198, rz: 0.134, cz: 0.004 },   // 骨盆
      { y: 0.000, rx: 0.205, rz: 0.140, cz: 0.002 },    // 髋
      { y: 0.080, rx: 0.192, rz: 0.132, cz: 0.006 },    // 小腹
      { y: 0.165, rx: 0.180, rz: 0.126, cz: 0.008 },    // 腰（最细）
      { y: 0.245, rx: 0.196, rz: 0.136, cz: 0.002 },    // 肋下
      { y: 0.330, rx: 0.216, rz: 0.147, cz: -0.004 },   // 胸
      { y: 0.410, rx: 0.224, rz: 0.149, cz: -0.006 },   // 上胸
      { y: 0.475, rx: 0.206, rz: 0.136, cz: 0.000 },    // 肩台
      { y: 0.545, rx: 0.152, rz: 0.106, cz: 0.004 },    // 颈根
      { y: 0.590, rx: 0.104, rz: 0.084, cz: 0.006 }     // 颈
    ];
    addMesh(torso, GEO.loft(torsoRings, 20), 'shirt');

    /* 按放样半径取躯干表面（细节件贴面用，避免"埋在身体里"看不见） */
    function ringAt(yLoc) {
      var rs = torsoRings;
      if (yLoc <= rs[0].y) return rs[0];
      if (yLoc >= rs[rs.length - 1].y) return rs[rs.length - 1];
      for (var i = 0; i < rs.length - 1; i++) {
        if (yLoc >= rs[i].y && yLoc <= rs[i + 1].y) {
          var k = (yLoc - rs[i].y) / (rs[i + 1].y - rs[i].y);
          return {
            rx: rs[i].rx + (rs[i + 1].rx - rs[i].rx) * k,
            rz: rs[i].rz + (rs[i + 1].rz - rs[i].rz) * k,
            cz: (rs[i].cz || 0) + ((rs[i + 1].cz || 0) - (rs[i].cz || 0)) * k
          };
        }
      }
      return rs[rs.length - 1];
    }
    /* 在躯干表面放一个"贴面"的偏移量：返回 z 坐标，保证薄片刚好凸出 surface */
    function onFront(yLoc, thickness) {
      var r = ringAt(yLoc);
      return r.cz + r.rz + thickness * 0.35;
    }

    /* 腰带：包在腰上，比躯干略大一圈 */
    var belly = ringAt(0.165);
    addMesh(torso, GEO.loft([
      { y: -0.020, rx: belly.rx * 1.02, rz: belly.rz * 1.02, cz: belly.cz },
      { y: 0.055, rx: belly.rx * 1.05, rz: belly.rz * 1.05, cz: belly.cz },
      { y: 0.140, rx: belly.rx * 1.02, rz: belly.rz * 1.02, cz: belly.cz }
    ], 20), 'belt');

    /* 腰带扣（贴在前表面） */
    var buckleZ = onFront(0.055, 0.028);
    addMesh(torso, GEO.roundedBox(0.078, 0.058, 0.028, 0.014, 4), 'buckle', { pos: [0, 0.055, buckleZ] });
    addMesh(torso, GEO.roundedBox(0.038, 0.026, 0.020, 0.010, 4), 'accent', { pos: [0, 0.055, buckleZ + 0.014] });

    /* 胸侧战术口袋（贴面，带翻盖与卡扣） */
    [-1, 1].forEach(function (sx) {
      addMesh(torso, GEO.roundedBox(0.096, 0.108, 0.032, 0.015, 4), 'gear',
        { pos: [sx * 0.104, 0.255, onFront(0.255, 0.032)] });
      addMesh(torso, GEO.roundedBox(0.101, 0.034, 0.038, 0.015, 4), 'strap',
        { pos: [sx * 0.104, 0.312, onFront(0.312, 0.038)] });
      addMesh(torso, GEO.roundedBox(0.020, 0.014, 0.012, 0.005, 3), 'accent',
        { pos: [sx * 0.104, 0.306, onFront(0.312, 0.038) + 0.014] });
    });

    /* 肩背带：前胸两条 + 后背两条（贴面，略微外凸可见） */
    [-1, 1].forEach(function (sx) {
      addMesh(torso, GEO.roundedBox(0.058, 0.30, 0.026, 0.013, 3), 'strap',
        { pos: [sx * 0.112, 0.245, onFront(0.245, 0.026)], rot: [0, 0, sx * 0.10] });
      addMesh(torso, GEO.roundedBox(0.058, 0.30, 0.026, 0.013, 3), 'strap',
        { pos: [sx * 0.112, 0.245, -onFront(0.245, 0.026) + 2 * ringAt(0.245).cz], rot: [0, 0, -sx * 0.10] });
      /* 肩上的带扣 */
      addMesh(torso, GEO.roundedBox(0.052, 0.030, 0.030, 0.012, 3), 'buckle',
        { pos: [sx * 0.135, 0.452, onFront(0.452, 0.030) - 0.030], rot: [0.5, 0, 0] });
    });

    /* 领口（上衣领，圈在颈根） */
    var neckRing = ringAt(0.565);
    addMesh(torso, GEO.loft([
      { y: 0.520, rx: neckRing.rx * 1.30, rz: neckRing.rz * 1.30, cz: neckRing.cz },
      { y: 0.585, rx: neckRing.rx * 1.36, rz: neckRing.rz * 1.36, cz: neckRing.cz },
      { y: 0.625, rx: neckRing.rx * 1.24, rz: neckRing.rz * 1.24, cz: neckRing.cz }
    ], 18), 'shirtFold');

    /* ---------- 脖子 + 头 ---------- */
    var neck = new THREE.Group();
    neck.position.y = H + 0.03;
    torso.add(neck);
    var head = new THREE.Group();
    head.position.y = DIM.headBaseY - DIM.hipY - (H + 0.03);   // 头相对脖子
    neck.add(head);

    addMesh(neck, GEO.capsule(R.neck, R.neck * 0.95, 0.075, 12, 4), 'skinShade', { pos: [0, 0.038, 0] });

    /* 头：椭球颅骨（卡通比例——头高约 0.24m、头顶到 y≈1.72，约 7 头身） */
    addMesh(head, GEO.ellipsoid(0.098, 0.126, 0.112, 22, 18), 'skin');
    /* 下颌：略窄的椭球下压 */
    addMesh(head, GEO.ellipsoid(0.083, 0.068, 0.088, 18, 14), 'skin', { pos: [0, -0.074, 0.010] });
    /* 头发：上半球罩 + 后脑补块 */
    var hairGeo = new THREE.SphereGeometry(0.103, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
    hairGeo.scale(1.0, 1.14, 1.06);
    addMesh(head, hairGeo, 'hair', { pos: [0, 0.012, -0.004] });
    addMesh(head, GEO.ellipsoid(0.095, 0.084, 0.074, 18, 14), 'hair', { pos: [0, -0.010, -0.032] });
    /* 鬓角 */
    [-1, 1].forEach(function (sx) {
      addMesh(head, GEO.ellipsoid(0.022, 0.046, 0.048, 12, 10), 'hair', { pos: [sx * 0.092, -0.014, 0.006] });
    });

    /* 眼睛：眼窝 + 虹膜 + 瞳孔 + 高光 */
    [-1, 1].forEach(function (sx) {
      addMesh(head, GEO.ellipsoid(0.030, 0.038, 0.022, 14, 12), 'skinShade',
        { pos: [sx * 0.043, 0.020, 0.092] });
      addMesh(head, GEO.ellipsoid(0.029, 0.036, 0.020, 14, 12), 'skin',
        { pos: [sx * 0.043, 0.020, 0.096] });
      addMesh(head, GEO.ellipsoid(0.014, 0.015, 0.008, 12, 10), 'hair',
        { pos: [sx * 0.045, 0.018, 0.108] });
      addMesh(head, GEO.ellipsoid(0.005, 0.005, 0.004, 8, 6), 'accent',
        { pos: [sx * 0.052, 0.028, 0.110] });
      /* 眉毛 */
      addMesh(head, GEO.roundedBox(0.046, 0.012, 0.013, 0.005, 3), 'hair',
        { pos: [sx * 0.045, 0.064, 0.096], rot: [0.1, 0, sx * -0.16] });
    });

    /* 鼻子 */
    addMesh(head, GEO.ellipsoid(0.018, 0.020, 0.024, 12, 10), 'skinShade', { pos: [0, -0.010, 0.100] });
    /* 嘴 */
    addMesh(head, GEO.roundedBox(0.040, 0.010, 0.012, 0.005, 3), 'hair', { pos: [0, -0.062, 0.092] });
    /* 耳朵 */
    [-1, 1].forEach(function (sx) {
      addMesh(head, GEO.ellipsoid(0.012, 0.028, 0.020, 10, 8), 'skin', { pos: [sx * 0.098, -0.004, -0.004] });
    });

    /* ---------- 腿 ---------- */
    function makeLeg(side) {
      var hip = new THREE.Group();
      hip.position.set(side * DIM.hipX, DIM.hipY, 0);
      body.add(hip);

      /* 髋关节填缝球（藏在大腿根部内，旋转时补缝） */
      addMesh(hip, GEO.ellipsoid(R.hip, R.hip * 0.95, R.hip * 0.95, 14, 10), 'pants',
        { pos: [0, -0.028, 0] });

      /* 大腿 capsule：从髋往下 */
      var thighLen = DIM.thighL - R.hip - R.knee;
      addMesh(hip, GEO.capsule(R.thigh, R.knee, thighLen, 14, 5), 'pants',
        { pos: [0, -DIM.thighL / 2, 0] });

      var knee = new THREE.Group();
      knee.position.y = -DIM.thighL;
      hip.add(knee);

      /* 膝关节填缝球 + 护膝 */
      addMesh(knee, GEO.ellipsoid(R.knee, R.knee, R.knee, 14, 10), 'pants');
      addMesh(knee, GEO.roundedBox(0.105, 0.075, 0.045, 0.020, 4), 'gear', { pos: [0, 0.004, 0.072] });
      addMesh(knee, GEO.roundedBox(0.088, 0.030, 0.030, 0.012, 3), 'strap', { pos: [0, 0.030, 0.070] });

      /* 小腿 capsule */
      var shinLen = DIM.shinL - R.knee - R.ankle;
      addMesh(knee, GEO.capsule(R.shin, R.ankle, shinLen, 14, 5), 'pants',
        { pos: [0, -DIM.shinL / 2, 0] });

      /* 脚：踝球 + 靴筒 + 靴身 + 鞋头 + 鞋底 */
      var ankle = new THREE.Group();
      ankle.position.y = -DIM.shinL;
      knee.add(ankle);
      addMesh(ankle, GEO.ellipsoid(R.ankle, R.ankle, R.ankle, 12, 10), 'boot');
      /* 靴筒 */
      addMesh(ankle, GEO.loft([
        { y: -0.085, rx: 0.072, rz: 0.080 },
        { y: -0.030, rx: 0.078, rz: 0.086 },
        { y: 0.030, rx: 0.082, rz: 0.090 }
      ], 14), 'boot', { pos: [0, 0, 0.004] });
      /* 鞋身 */
      addMesh(ankle, GEO.roundedBox(0.105, 0.058, 0.235, 0.026, 4), 'boot', { pos: [0, -0.062, 0.030] });
      /* 鞋头（半圆） */
      addMesh(ankle, GEO.ellipsoid(0.052, 0.030, 0.055, 14, 10), 'bootCap', { pos: [0, -0.062, 0.140] });
      /* 鞋底 */
      addMesh(ankle, GEO.roundedBox(0.110, 0.028, 0.248, 0.013, 4), 'bootSole', { pos: [0, -0.088, 0.030] });
      /* 鞋带 */
      [0, 1].forEach(function (i) {
        addMesh(ankle, GEO.roundedBox(0.078, 0.010, 0.012, 0.005, 3), 'strap',
          { pos: [0, -0.038 - i * 0.016, 0.078] });
      });

      return { hip: hip, knee: knee, ankle: ankle };
    }

    /* ---------- 手臂 ---------- */
    function makeArm(side) {
      var sh = new THREE.Group();
      sh.position.set(side * DIM.shoulderX, DIM.shoulderY, 0);   // 父级是 torso（原点已在髋），不要再加 hipY
      torso.add(sh);

      /* 肩关节填缝球 + 肩章 */
      addMesh(sh, GEO.ellipsoid(R.shoulder, R.shoulder, R.shoulder * 0.95, 14, 12), 'shirt');
      addMesh(sh, GEO.ellipsoid(R.shoulder * 0.92, 0.055, 0.088, 14, 10), 'shirtFold',
        { pos: [side * 0.030, 0.036, 0] });

      /* 上臂 capsule */
      var upperLen = DIM.upperArm - R.shoulder - R.elbow;
      addMesh(sh, GEO.capsule(R.upperArm, R.elbow, upperLen, 14, 5), 'shirt',
        { pos: [0, -DIM.upperArm / 2, 0] });

      var el = new THREE.Group();
      el.position.y = -DIM.upperArm;
      sh.add(el);

      /* 肘关节填缝球 + 袖口 */
      addMesh(el, GEO.ellipsoid(R.elbow, R.elbow, R.elbow, 12, 10), 'shirtFold');
      addMesh(el, GEO.loft([
        { y: -0.030, rx: R.elbow * 0.98, rz: R.elbow * 0.98 },
        { y: -0.010, rx: R.elbow * 1.06, rz: R.elbow * 1.06 },
        { y: 0.012, rx: R.elbow * 1.00, rz: R.elbow * 1.00 }
      ], 12), 'shirtFold');

      /* 小臂 capsule（露小臂：肤色/手套混合，这里用肤色 + 护臂） */
      var foreLen = DIM.foreArm - R.elbow - R.wrist;
      addMesh(el, GEO.capsule(R.foreArm, R.wrist, foreLen, 14, 5), 'skinShade',
        { pos: [0, -DIM.foreArm / 2, 0] });
      /* 护臂/袖套 */
      addMesh(el, GEO.loft([
        { y: -DIM.foreArm * 0.30, rx: R.foreArm * 0.95, rz: R.foreArm * 0.95 },
        { y: -DIM.foreArm * 0.58, rx: R.foreArm * 0.90, rz: R.foreArm * 0.90 },
        { y: -DIM.foreArm * 0.80, rx: R.wrist * 1.02, rz: R.wrist * 1.02 }
      ], 12), 'glove');

      /* 手：掌 + 四指 + 拇指 */
      var hand = new THREE.Group();
      hand.position.y = -DIM.foreArm;
      el.add(hand);
      addMesh(hand, GEO.roundedBox(0.070, 0.090, 0.040, 0.018, 4), 'glove', { pos: [0, -0.040, 0.004] });
      for (var f = 0; f < 4; f++) {
        addMesh(hand, GEO.capsule(0.0125, 0.011, 0.048, 8, 3), 'glove',
          { pos: [(f - 1.5) * 0.017, -0.110, 0.010], rot: [0.10, 0, 0] });
      }
      addMesh(hand, GEO.capsule(0.014, 0.012, 0.040, 8, 3), 'glove',
        { pos: [side * -0.038, -0.052, 0.020], rot: [0.5, 0, side * 0.55] });

      return { shoulder: sh, elbow: el, hand: hand };
    }

    var legL = makeLeg(1), legR = makeLeg(-1);
    var armL = makeArm(1), armR = makeArm(-1);

    /* ---------- 步枪（挂右手，圆润机匣 + 丰富细节） ---------- */
    var gun = new THREE.Group();
    armR.hand.add(gun);

    /* 机匣 */
    addMesh(gun, GEO.roundedBox(0.052, 0.085, 0.30, 0.014, 4), 'metalMid', { pos: [0, 0.010, 0.010] });
    /* 上机匣导轨 */
    addMesh(gun, GEO.roundedBox(0.030, 0.020, 0.26, 0.006, 3), 'metalDark', { pos: [0, 0.062, 0.020] });
    /* 枪管 + 消焰器 */
    var barrelG = GEO.capsule(0.014, 0.014, 0.20, 10, 3);
    addMesh(gun, barrelG, 'metalDark', { pos: [0, 0.022, 0.36], rot: [Math.PI / 2, 0, 0] });
    addMesh(gun, GEO.capsule(0.020, 0.018, 0.045, 10, 3), 'metalMid',
      { pos: [0, 0.022, 0.475], rot: [Math.PI / 2, 0, 0] });
    /* 护木 */
    addMesh(gun, GEO.roundedBox(0.048, 0.052, 0.185, 0.014, 4), 'wood', { pos: [0, 0.014, 0.235] });
    addMesh(gun, GEO.roundedBox(0.036, 0.016, 0.150, 0.006, 3), 'wood', { pos: [0, -0.010, 0.235] });
    /* 弹匣（弧度：两段拼接） */
    addMesh(gun, GEO.roundedBox(0.042, 0.105, 0.062, 0.012, 4), 'metalDark',
      { pos: [0, -0.088, 0.020], rot: [0.16, 0, 0] });
    addMesh(gun, GEO.roundedBox(0.040, 0.050, 0.058, 0.012, 3), 'metalDark',
      { pos: [0, -0.158, 0.042], rot: [0.30, 0, 0] });
    /* 握把 */
    addMesh(gun, GEO.roundedBox(0.040, 0.105, 0.052, 0.014, 4), 'metalDark',
      { pos: [0, -0.070, -0.075], rot: [0.34, 0, 0] });
    /* 枪托（含托底） */
    addMesh(gun, GEO.roundedBox(0.044, 0.075, 0.135, 0.014, 4), 'wood', { pos: [0, 0.012, -0.155] });
    addMesh(gun, GEO.roundedBox(0.048, 0.095, 0.030, 0.012, 3), 'metalDark', { pos: [0, 0.008, -0.232] });
    /* 扳机护圈 + 扳机 */
    addMesh(gun, GEO.roundedBox(0.026, 0.010, 0.060, 0.005, 3), 'metalDark', { pos: [0, -0.030, -0.048] });
    addMesh(gun, GEO.roundedBox(0.008, 0.030, 0.010, 0.003, 3), 'metalLight', { pos: [0, -0.018, -0.040] });
    /* 准星 / 照门 */
    addMesh(gun, GEO.roundedBox(0.014, 0.030, 0.014, 0.004, 3), 'metalLight', { pos: [0, 0.082, 0.285] });
    addMesh(gun, GEO.roundedBox(0.026, 0.026, 0.012, 0.004, 3), 'metalLight', { pos: [0, 0.078, -0.055] });
    /* 弹匣卡榫 */
    addMesh(gun, GEO.roundedBox(0.012, 0.014, 0.016, 0.004, 3), 'metalLight', { pos: [0.030, -0.012, 0.010] });
    /* 背带环 */
    addMesh(gun, GEO.roundedBox(0.010, 0.018, 0.010, 0.004, 3), 'metalLight', { pos: [0, -0.030, 0.300] });

    var muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.022, 0.505);
    gun.add(muzzle);

    /* 枪口火光 */
    var flash = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd66a, transparent: true, opacity: 0.95 }));
    flash.position.copy(muzzle.position);
    flash.visible = false;
    gun.add(flash);
    var flash2 = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.45 }));
    flash2.position.copy(muzzle.position);
    flash2.visible = false;
    gun.add(flash2);

    var parts = {
      torso: torso, head: head, neck: neck, gun: gun, muzzle: muzzle, flash: flash, flash2: flash2,
      arms: { left: armL, right: armR }, legs: { left: legL, right: legR },
      hair: hairGeo
    };

    /* ---------- 姿态（由 pose-solve.js 用本模型自身数值求解，误差 < 3mm） ---------- */
    var BASE = {
      torsoY: -0.450,
      right: { s: [-0.101, 0.460, 0.253], e: [-1.707] },
      left: { s: [-0.571, 0.046, -0.200], e: [-0.943] }
    };
    var AIM = {
      torsoY: -0.450,
      right: { s: [-0.565, 0.603, 0.515], e: [-2.080] },
      left: { s: [-0.699, -0.060, -0.203], e: [-1.566] }
    };
    var DEAD = { rotX: -Math.PI / 2, roll: 0.10 };

    var state = 'idle', st = 0, t = 0;
    var gunInHand = true;

    function attachGunToHand() {
      if (gunInHand) return;
      armR.hand.attach(gun);
      gun.position.set(0, 0, 0);
      gun.rotation.set(0, 0, 0);
      gunInHand = true;
    }
    function dropGun() {
      if (!gunInHand) return;
      root.attach(gun);
      gun.position.set(-0.46, 0.055, 0.22);
      gun.rotation.set(0.05, 0.6, 0.06);
      gunInHand = false;
    }

    var _pq = new THREE.Quaternion();
    /* 站立时枪保持水平指向 +Z（抵消躯干与手臂旋转） */
    function alignGun() {
      if (state === 'dead') return;
      gun.parent.getWorldQuaternion(_pq);
      gun.quaternion.copy(_pq).invert();
    }

    function setPose(P) {
      torso.rotation.set(0, P.torsoY, 0);
      armR.shoulder.rotation.set(P.right.s[0], P.right.s[1], P.right.s[2]);
      armR.elbow.rotation.set(P.right.e[0], 0, 0);
      armL.shoulder.rotation.set(P.left.s[0], P.left.s[1], P.left.s[2]);
      armL.elbow.rotation.set(P.left.e[0], 0, 0);
    }

    function applyBase() {
      setPose(BASE);
      legL.hip.rotation.set(0, 0, 0); legR.hip.rotation.set(0, 0, 0);
      legL.knee.rotation.set(0, 0, 0); legR.knee.rotation.set(0, 0, 0);
      legL.ankle.rotation.set(0, 0, 0); legR.ankle.rotation.set(0, 0, 0);
      torso.position.y = DIM.hipY;
      torso.rotation.x = 0;
      head.rotation.set(0, 0, 0);
      body.rotation.set(0, 0, 0); body.position.y = 0;
      shadow.scale.set(1, 1, 1); shadow.position.z = 0;
      flash.visible = false; flash2.visible = false;
      alignGun();
    }

    function setState(s) {
      if (s === state) return;
      state = s; st = 0;
      if (s !== 'dead') attachGunToHand();
      applyBase();
    }

    function lerp(a, b, k) { return a + (b - a) * k; }

    function update(dt) {
      t += dt; st += dt;
      applyBase();
      var ph;

      if (state === 'idle') {
        ph = t * 1.7;
        torso.position.y = DIM.hipY + Math.sin(ph) * 0.022;          // 呼吸起伏
        torso.rotation.y += Math.sin(t * 0.5) * 0.07;
        head.rotation.y = Math.sin(t * 0.75) * 0.20;
        head.rotation.x = Math.sin(t * 1.3) * 0.05;
        armR.shoulder.rotation.x += Math.sin(ph) * 0.032;
        armL.shoulder.rotation.x += Math.sin(ph + 0.6) * 0.042;
        armR.elbow.rotation.x += Math.sin(ph + 0.3) * 0.02;
        legL.knee.rotation.x = 0.045 + Math.sin(ph) * 0.035;
        legR.knee.rotation.x = 0.035 + Math.sin(ph + 0.4) * 0.028;

      } else if (state === 'walk') {
        ph = t * 5.0;
        legL.hip.rotation.x = Math.sin(ph) * 0.52;
        legR.hip.rotation.x = -Math.sin(ph) * 0.52;
        legL.knee.rotation.x = Math.max(0, -Math.sin(ph)) * 0.80;
        legR.knee.rotation.x = Math.max(0, Math.sin(ph)) * 0.80;
        legL.ankle.rotation.x = -Math.sin(ph + 0.5) * 0.22;
        legR.ankle.rotation.x = Math.sin(ph + 0.5) * 0.22;
        torso.position.y = DIM.hipY + Math.abs(Math.sin(ph)) * 0.022;
        torso.rotation.y += Math.sin(ph) * 0.07;
        body.rotation.z = Math.sin(ph) * 0.022;
        armR.shoulder.rotation.x += Math.sin(ph) * 0.065;
        armL.shoulder.rotation.x += -Math.sin(ph) * 0.085;
        head.rotation.x = 0.05;

      } else if (state === 'attack') {
        if (st > 1.5) st = 0;
        var raise = Math.min(st / 0.18, 1);
        var recoil = (st >= 0.18 && st < 0.40) ? Math.max(0, 1 - (st - 0.18) / 0.22) : 0;
        var k = raise;

        armR.shoulder.rotation.x = lerp(BASE.right.s[0], AIM.right.s[0], k) + recoil * 0.28;
        armR.shoulder.rotation.y = lerp(BASE.right.s[1], AIM.right.s[1], k);
        armR.shoulder.rotation.z = lerp(BASE.right.s[2], AIM.right.s[2], k);
        armR.elbow.rotation.x = lerp(BASE.right.e[0], AIM.right.e[0], k) - recoil * 0.18;
        armL.shoulder.rotation.x = lerp(BASE.left.s[0], AIM.left.s[0], k) + recoil * 0.12;
        armL.shoulder.rotation.y = lerp(BASE.left.s[1], AIM.left.s[1], k);
        armL.shoulder.rotation.z = lerp(BASE.left.s[2], AIM.left.s[2], k);
        armL.elbow.rotation.x = lerp(BASE.left.e[0], AIM.left.e[0], k);

        torso.rotation.x = -0.05 * k + 0.10 * recoil;
        head.rotation.x = -0.13 * k;
        body.position.z = -0.012 * recoil;

        if (st > 0.4) {
          var wob = Math.sin(st * 5.5) * 0.008;
          armR.shoulder.rotation.x += wob;
          armR.shoulder.rotation.y += wob * 0.5;
        }
        flash.visible = (st >= 0.18 && st < 0.30);
        flash2.visible = flash.visible;
        if (flash.visible) {
          flash.scale.setScalar(0.85 + Math.random() * 0.5);
          flash2.scale.setScalar(0.9 + Math.random() * 0.5);
        }

      } else if (state === 'dead') {
        var kk = Math.min(st / 0.7, 1);
        var e = 1 - Math.pow(1 - kk, 3);
        if (e > 0.25) dropGun(); else attachGunToHand();
        body.rotation.x = DEAD.rotX * e;
        body.rotation.z = DEAD.roll * e;
        legL.hip.rotation.x = -0.07 * e; legR.hip.rotation.x = 0.07 * e;
        legL.knee.rotation.x = 0.20 * e; legR.knee.rotation.x = 0.14 * e;
        armL.shoulder.rotation.set(0.15 * e, 0.1 * e, 0.62 * e);
        armL.elbow.rotation.set(0.35 * e, 0, 0);
        armR.shoulder.rotation.set(0.15 * e, -0.1 * e, -0.62 * e);
        armR.elbow.rotation.set(0.25 * e, 0, 0);
        head.rotation.x = 0.32 * e;
        head.rotation.z = -0.12 * e;
        shadow.scale.set(1 + 0.85 * e, 1, 1 + 0.35 * e);
        shadow.position.z = -0.42 * e;
      }

      alignGun();
      autoGround();
    }

    function triangleCount() {
      var n = 0;
      group.traverse(function (o) {
        if (o.isMesh && o.geometry) {
          var g = o.geometry;
          n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        }
      });
      return Math.round(n);
    }

    applyBase();

    var _box = new THREE.Box3();
    function autoGround() {
      root.position.y = 0;
      group.updateMatrixWorld(true);
      var minY = Infinity;
      body.traverse(function (o) {
        if (o.isMesh && o.geometry) {
          o.updateMatrixWorld(true);
          _box.setFromObject(o);
          if (_box.min.y < minY) minY = _box.min.y;
        }
      });
      if (minY !== Infinity) root.position.y = -minY;   // 上抬与下压都贴地
    }

    return {
      group: group, body: body, shadow: shadow, parts: parts,
      states: ['idle', 'walk', 'attack', 'dead'],
      setState: setState, update: update, applyBase: applyBase,
      autoGround: autoGround, setPose: setPose,
      getState: function () { return state; },
      triangleCount: triangleCount,
      setAngle: function (name, val) { MATS[name] = MATS[name]; },
      DIM: DIM, R: R, BASE: BASE, AIM: AIM, DEAD: DEAD, COL: COL, MATS: MATS
    };
  }

  build.COL = COL; build.DIM = DIM; build.R = R; build.MATS = MATS;
  /* 画质档：0.7 省电 / 1.0 标准 / 1.3 精细。必须在 build() 之前调用 */
  build.setDetail = function (s) { GEO.setSegScale(s); };
  build.getDetail = function () { return GEO.getSegScale(); };
  return build;
});