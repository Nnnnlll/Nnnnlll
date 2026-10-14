/* 姿态数值求解器 v3.0
   为什么需要：v3.0 的关节链（肩→肘、髋→膝→踝）与 v2.0 不同，
   旧角度会让手臂横向平伸。这里直接驱动"真实模型的骨骼组"做搜索：
   暴力粗搜 → 局部精修，目标是让手心落到指定世界坐标，并顺带检查穿模。

   判据（全部可量化）：
   - 手心与目标点距离（越小越好）
   - 双手间距（自然 0.20~0.40）
   - 手到躯干表面/到头部中心的最小距离（防穿模）
   - 枪口高度与朝向

   用法：node pose-solve.js          # 求解待机 + 瞄准两组姿态
        node pose-solve.js verify   # 只复核当前 soldier-model.js 里的姿态
*/
var HERE = '/root/nnnnlll/game/fps/test';
var THREE = require(HERE + '/lib/three.min.js');
var build = require(HERE + '/soldier-model.js');
var GEO = require(HERE + '/geo.js');

var person;   // 当前被搜索的实例
function fresh() {
  person = build();
  person.group.updateMatrixWorld(true);
  return person;
}
var _v = new THREE.Vector3();

/* 取某个骨骼组在世界坐标下的位置（用其子网格中心近似） */
function boneWorld(obj) {
  obj.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
}

/* 手心世界坐标：手组原点 + 沿手轴向前 6cm（掌心位置） */
function palmWorld(handGroup) {
  handGroup.updateMatrixWorld(true);
  var p = new THREE.Vector3().setFromMatrixPosition(handGroup.matrixWorld);
  var down = new THREE.Vector3(0, -1, 0).applyQuaternion(handGroup.getWorldQuaternion(new THREE.Quaternion()));
  return p.addScaledVector(down, 0.055);
}

function setPoseRaw(torsoY, rS, rE, lS, lE) {
  person.setPose({
    torsoY: torsoY,
    right: { s: rS, e: [rE] },
    left: { s: lS, e: [lE] }
  });
  person.group.updateMatrixWorld(true);
}

/* 只更新一次世界矩阵，直接读 matrixWorld（比反复 updateMatrixWorld 快很多） */
function worldOf(obj) { return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld); }

/* 单臂评估：手心位置 + 肘部姿态（贴身、下垂），两者都罚 */
function evalArm(torsoY, side, s3, e1, target, other) {
  var P = {
    torsoY: torsoY,
    right: side === 'right' ? { s: s3, e: [e1] } : other.r,
    left: side === 'left' ? { s: s3, e: [e1] } : other.l
  };
  setPoseRaw(torsoY, P.right.s, P.right.e[0], P.left.s, P.left.e[0]);
  var hand = person.parts.arms[side].hand;
  var el = person.parts.arms[side].elbow;
  var sh = person.parts.arms[side].shoulder;
  var p = worldOf(hand);
  var down = new THREE.Vector3(0, -1, 0).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
  p.addScaledVector(down, 0.055);
  var d = p.distanceTo(target);

  var ew = worldOf(el), sw = worldOf(sh);
  /* ① 肘不得越过躯干中轴（插进肚子） */
  var penIn = (ew.x > -0.07 && ew.x < 0.07) ? (0.07 - Math.abs(ew.x)) : 0;
  /* ② 肘不得横向外张（"鸡翅"）—— 肘的横向 |x| 不应超过肩的 |x| */
  var penOut = Math.max(0, Math.abs(ew.x) - Math.abs(sw.x) - 0.015);
  /* ③ 肘应在肩的下方（自然下垂），不能抬到肩以上 */
  var penUp = Math.max(0, ew.y - (sw.y - 0.10));

  var cost = d * 10 + penIn * 40 + penOut * 90 + penUp * 60;
  return { cost: cost, d: d, p: p, penIn: penIn, penOut: penOut, penUp: penUp,
           elbow: ew, shoulder: sw };
}

/* 评估一个姿态：返回误差明细 */
function evaluate(torsoY, rS, rE, lS, lE, targetR, targetL, opts) {
  opts = opts || {};
  setPoseRaw(torsoY, rS, rE, lS, lE);
  var pr = palmWorld(person.parts.arms.right.hand);
  var pl = palmWorld(person.parts.arms.left.hand);
  var dr = pr.distanceTo(targetR);
  var dl = pl.distanceTo(targetL);
  var gap = pr.distanceTo(pl);

  /* 肩部到躯干中轴的距离（防止手臂插进身体） */
  var shR = boneWorld(person.parts.arms.right.shoulder);
  var elbowR = boneWorld(person.parts.arms.right.elbow);
  var shL = boneWorld(person.parts.arms.left.shoulder);
  var elbowL = boneWorld(person.parts.arms.left.elbow);
  var axisPen = 0;
  [elbowR, elbowL].forEach(function (e) { if (e.x > -0.06 && e.x < 0.06) axisPen += 0.06 - Math.abs(e.x); });
  /* 眼睛/头中心与枪的距离 */
  var headC = boneWorld(person.parts.head);
  var muzzle = boneWorld(person.parts.muzzle);
  var headGun = muzzle.distanceTo(headC);

  var cost = dr * 10 + dl * 10;
  if (gap < 0.16) cost += (0.16 - gap) * 40;
  if (gap > 0.52) cost += (gap - 0.52) * 25;
  cost += axisPen * 30;
  if (opts.minHeadGun && headGun < opts.minHeadGun) cost += (opts.minHeadGun - headGun) * 20;

  return { cost: cost, dr: dr, dl: dl, gap: gap, axisPen: axisPen, pr: pr, pl: pl, headGun: headGun,
           shR: shR, elbowR: elbowR, elbowL: elbowL, muzzle: muzzle };
}

/* 分臂求解：两条手臂独立解（各自 5 维），互不影响 → 评估次数降到千级 */
function solveArm(torsoY, side, target, other, rng) {
  var best = null;
  function test(s0, s1, s2, e1) {
    var r = evalArm(torsoY, side, [s0, s1, s2], e1, target, other);
    if (!best || r.cost < best.cost) best = { cost: r.cost, s: [s0, s1, s2], e: e1, det: r };
  }
  // 粗搜
  for (var a = rng[0]; a <= rng[1] + 1e-9; a += rng[2]) {
    for (var b = rng[3]; b <= rng[4] + 1e-9; b += rng[5]) {
      for (var c = rng[6]; c <= rng[7] + 1e-9; c += rng[8]) {
        for (var d = rng[9]; d <= rng[10] + 1e-9; d += rng[11]) {
          test(a, b, c, d);
        }
      }
    }
  }
  // 精修（坐标下降）
  [0.12, 0.06, 0.03, 0.015, 0.007, 0.003].forEach(function (h) {
    var improved = true, guard = 0;
    while (improved && guard++ < 80) {
      improved = false;
      for (var i = 0; i < 4; i++) {
        [1, -1].forEach(function (sg) {
          var s = best.s.slice(), e = best.e;
          if (i === 0) s[0] += sg * h; else if (i === 1) s[1] += sg * h;
          else if (i === 2) s[2] += sg * h; else e += sg * h;
          var r = evalArm(torsoY, side, s, e, target, other);
          if (r.cost < best.cost - 1e-10) { best = { cost: r.cost, s: s, e: e, det: r }; improved = true; }
        });
      }
    }
  });
  return best;
}

/* 完整求解：躯干角粗搜 × 分臂求解 */
function solve(targetR, targetL, opts) {
  opts = opts || {};
  fresh();   // 必须有：setPoseRaw 依赖 person 实例
  var torsoList = opts.torsoList || [-0.45, -0.30, -0.15, 0.0];
  var out = null;
  torsoList.forEach(function (ty) {
    var init = { s: [0, 0, 0], e: -0.6 };
    var r = solveArm(ty, 'right', targetR, { r: init, l: init },
      [-1.6, 1.2, 0.4, -0.6, 1.0, 0.3, -1.0, 1.0, 0.4, -2.2, -0.4, 0.5]);
    var l = solveArm(ty, 'left', targetL, { r: { s: r.s, e: [r.e] }, l: init },
      [-1.4, 1.0, 0.4, -0.6, 1.0, 0.3, -1.0, 1.0, 0.4, -2.0, -0.4, 0.5]);
    // 联合评估
    setPoseRaw(ty, r.s, r.e, l.s, l.e);
    var pr = palmWorld(person.parts.arms.right.hand);
    var pl = palmWorld(person.parts.arms.left.hand);
    var gap = pr.distanceTo(pl);
    var cost = r.det.d * 10 + l.det.d * 10;
    if (gap < 0.18) cost += (0.18 - gap) * 60;
    if (gap > 0.50) cost += (gap - 0.50) * 40;
    cost += (r.det.penIn + l.det.penIn) * 40 + (r.det.penOut + l.det.penOut) * 90 + (r.det.penUp + l.det.penUp) * 60;
    if (!out || cost < out.cost) {
      out = { cost: cost, torsoY: ty, rS: r.s, rE: r.e, lS: l.s, lE: l.e,
              dr: r.det.d, dl: l.det.d, gap: gap, penIn: r.det.penIn + l.det.penIn, penOut: r.det.penOut + l.det.penOut, elbowR: r.det.elbow, elbowL: l.det.elbow }
    }
  });
  return out;
}

function fmt(o) {
  return o.best.torsoY.toFixed(3) + ' | R s[' + o.best.rS.map(function (v) { return v.toFixed(3); }).join(', ') +
    '] e[' + o.best.rE.toFixed(3) + '] | L s[' + o.best.lS.map(function (v) { return v.toFixed(3); }).join(', ') +
    '] e[' + o.best.lE.toFixed(3) + ']';
}

/* ============ 目标点（世界坐标，脚底 y=0） ============ */
/* 待机：枪端在胸前偏右，双手自然搭枪（与真人持械低姿一致） */
var IDLE = {
  targetR: new THREE.Vector3(-0.155, 1.20, 0.24),
  targetL: new THREE.Vector3(-0.075, 1.16, 0.50),
  opts: { torso0: [-0.5, -0.1] }
};
/* 瞄准：把枪抬到与视线同高，右肘抬起 */
var AIM = {
  targetR: new THREE.Vector3(-0.115, 1.42, 0.20),
  targetL: new THREE.Vector3(-0.050, 1.40, 0.46),
  opts: { torso0: [-0.4, 0.0], minHeadGun: 0.22 }
};

var mode = process.argv[2] || 'solve';

if (mode === 'verify') {
  var P = build.BASE || null;
  var s = fresh();
  var P2 = s.BASE;
  /* 当前文件里的姿态：直接量 */
  setPoseRaw(s.BASE.torsoY, s.BASE.right.s, s.BASE.right.e[0], s.BASE.left.s, s.BASE.left.e[0]);
  var pr = palmWorld(s.parts.arms.right.hand), pl = palmWorld(s.parts.arms.left.hand);
  var mz = boneWorld(s.parts.muzzle);
  console.log('待机：右手 (' + pr.toArray().map(function (v) { return v.toFixed(3); }).join(', ') + ')');
  console.log('      左手 (' + pl.toArray().map(function (v) { return v.toFixed(3); }).join(', ') + ')');
  console.log('      枪口 (' + mz.toArray().map(function (v) { return v.toFixed(3); }).join(', ') + ')');
  console.log('      双手间距 ' + pr.distanceTo(pl).toFixed(3));
  setPoseRaw(s.AIM.torsoY, s.AIM.right.s, s.AIM.right.e[0], s.AIM.left.s, s.AIM.left.e[0]);
  var pr2 = palmWorld(s.parts.arms.right.hand), pl2 = palmWorld(s.parts.arms.left.hand);
  var mz2 = boneWorld(s.parts.muzzle);
  console.log('瞄准：右手 (' + pr2.toArray().map(function (v) { return v.toFixed(3); }).join(', ') + ')');
  console.log('      左手 (' + pl2.toArray().map(function (v) { return v.toFixed(3); }).join(', ') + ')');
  console.log('      枪口 (' + mz2.toArray().map(function (v) { return v.toFixed(3); }).join(', ') + ')');
  process.exit(0);
}

console.log('===== 求解待机姿态 =====');
var t0 = Date.now();
var rIdle = solve(IDLE.targetR, IDLE.targetL, IDLE.opts);
console.log('用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('躯干角 ' + rIdle.torsoY.toFixed(3));
console.log('右臂 s[' + rIdle.rS.map(function (v) { return v.toFixed(3); }).join(', ') + '] e[' + rIdle.rE.toFixed(3) + ']');
console.log('左臂 s[' + rIdle.lS.map(function (v) { return v.toFixed(3); }).join(', ') + '] e[' + rIdle.lE.toFixed(3) + ']');
console.log('右手误差 ' + rIdle.dr.toFixed(4) + 'm   左手误差 ' + rIdle.dl.toFixed(4) + 'm');
console.log('双手间距 ' + rIdle.gap.toFixed(3) + 'm');
console.log('肘部：右侧 (' + rIdle.elbowR.toArray().map(function(v){return v.toFixed(3);}).join(', ') + ')  左侧 (' + rIdle.elbowL.toArray().map(function(v){return v.toFixed(3);}).join(', ') + ')');
console.log('肘部罚分 内插 ' + rIdle.penIn.toFixed(4) + '  外张 ' + rIdle.penOut.toFixed(4));
setPoseRaw(rIdle.torsoY, rIdle.rS, rIdle.rE, rIdle.lS, rIdle.lE);
person.autoGround();
var mzI = worldOf(person.parts.muzzle);
console.log('枪口世界坐标 (' + mzI.toArray().map(function (v) { return v.toFixed(3); }).join(', ') + ')');

console.log('\n===== 求解瞄准姿态 =====');
t0 = Date.now();
var rAim = solve(AIM.targetR, AIM.targetL, AIM.opts);
console.log('用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('躯干角 ' + rAim.torsoY.toFixed(3));
console.log('右臂 s[' + rAim.rS.map(function (v) { return v.toFixed(3); }).join(', ') + '] e[' + rAim.rE.toFixed(3) + ']');
console.log('左臂 s[' + rAim.lS.map(function (v) { return v.toFixed(3); }).join(', ') + '] e[' + rAim.lE.toFixed(3) + ']');
console.log('右手误差 ' + rAim.dr.toFixed(4) + 'm   左手误差 ' + rAim.dl.toFixed(4) + 'm');
console.log('双手间距 ' + rAim.gap.toFixed(3) + 'm');
setPoseRaw(rAim.torsoY, rAim.rS, rAim.rE, rAim.lS, rAim.lE);
person.autoGround();
var mzA = worldOf(person.parts.muzzle);
var headC = worldOf(person.parts.head);
console.log('枪口世界坐标 (' + mzA.toArray().map(function (v) { return v.toFixed(3); }).join(', ') + ')');
console.log('枪口到头中心 ' + mzA.distanceTo(headC).toFixed(3) + 'm');

console.log('\n===== 直接贴回模型的常量 =====');
console.log('  var BASE = {\n    torsoY: ' + rIdle.torsoY.toFixed(3) + ',\n' +
  '    right: { s: [' + rIdle.rS.map(function (v) { return v.toFixed(3); }).join(', ') + '], e: [' + rIdle.rE.toFixed(3) + '] },\n' +
  '    left:  { s: [' + rIdle.lS.map(function (v) { return v.toFixed(3); }).join(', ') + '], e: [' + rIdle.lE.toFixed(3) + '] }\n  };');
console.log('  var AIM = {\n    torsoY: ' + rAim.torsoY.toFixed(3) + ',\n' +
  '    right: { s: [' + rAim.rS.map(function (v) { return v.toFixed(3); }).join(', ') + '], e: [' + rAim.rE.toFixed(3) + '] },\n' +
  '    left:  { s: [' + rAim.lS.map(function (v) { return v.toFixed(3); }).join(', ') + '], e: [' + rAim.lE.toFixed(3) + '] }\n  };');