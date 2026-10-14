/* 姿态求解：不手填角度，用数值搜索让
   ① 待机时右手到达胸前握把(GRIP)、左手搭在护木上
   ② 瞄准时右手到达眼前瞄准位(SIGHT)、左手搭在护木上
   ③ 倒地时自动贴地（由模型 autoGround 保证，这里复核）
   输出可直接粘回 soldier-model.js 的 BASE / AIM 常数。 */
const THREE = require('./lib/three.min.js');
const buildSoldier = require('./soldier-model.js');

const s = buildSoldier();
new THREE.Scene().add(s.group);
const V = () => new THREE.Vector3();
const _pq = new THREE.Quaternion();

function handPos(which) {
  s.group.updateMatrixWorld(true);
  return s.parts.arms[which].hand.getWorldPosition(V());
}
function allBounds() {
  s.group.updateMatrixWorld(true);
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  s.group.traverse(o => {
    if (o.isMesh && o.geometry) { o.updateMatrixWorld(true); tmp.setFromObject(o); box.union(tmp); }
  });
  return box;
}
/* 与模型内部 alignGun 等价：站立时枪恒定水平指前 */
function alignGun() {
  s.group.updateMatrixWorld(true);
  s.parts.gun.parent.getWorldQuaternion(_pq);
  s.parts.gun.quaternion.copy(_pq).invert();
  s.group.updateMatrixWorld(true);
}
const fmt = v => '(' + v.x.toFixed(2) + ', ' + v.y.toFixed(2) + ', ' + v.z.toFixed(2) + ')';
const lerp = (a, b, k) => a + (b - a) * k;

/* ---------- 通用两臂搜索 ---------- */
function solveArm(side, target, start) {
  const p = Object.assign({}, start);
  const keys = ['shX', 'shY', 'shZ', 'elX'];
  const sh = s.parts.arms[side].shoulder, el = s.parts.arms[side].elbow;

  function apply() {
    sh.rotation.set(p.shX, p.shY, p.shZ);
    el.rotation.set(p.elX, 0, 0);
    s.group.updateMatrixWorld(true);
  }
  function cost() {
    apply();
    const d = handPos(side).distanceTo(target);
    const reg = 0.003 * Math.abs(p.elX + 1.2);   // 轻微正则，避免肘部反折过度
    return d * 2 + reg;
  }

  let best = cost();
  for (let step = 0.4; step > 0.004; step *= 0.55) {
    let improved = true, guard = 0;
    while (improved && guard++ < 40) {
      improved = false;
      for (const k of keys) {
        for (const d of [step, -step]) {
          const old = p[k];
          const next = old + d;
          if (k === 'elX' && (next > -0.1 || next < -2.6)) continue;   // 肘关节生理范围
          p[k] = next;
          const c = cost();
          if (c < best - 1e-6) { best = c; improved = true; } else { p[k] = old; }
        }
      }
    }
  }
  apply();
  return { p, err: handPos(side).distanceTo(target) };
}

/* ---------- 场景一：待机（枪在胸前） ---------- */
console.log('===== 待机姿态（枪在胸前）=====');
const torsoY = s.BASE.torsoY;
s.torsoY = torsoY;
s.setPose({ torsoY: torsoY, right: s.BASE.right, left: s.BASE.left });

const gripR = new THREE.Vector3(s.GRIP.right[0], s.GRIP.right[1], s.GRIP.right[2]);
const gripL = gripR.clone().add(new THREE.Vector3(0, 0, s.GRIP.gap));
console.log('右手目标 ' + fmt(gripR) + '   左手目标 ' + fmt(gripL));

const r1 = solveArm('right', gripR, { shX: s.BASE.right.s[0], shY: s.BASE.right.s[1], shZ: s.BASE.right.s[2], elX: s.BASE.right.e[0] });
const l1 = solveArm('left', gripL, { shX: s.BASE.left.s[0], shY: s.BASE.left.s[1], shZ: s.BASE.left.s[2], elX: s.BASE.left.e[0] });

// 用搜索结果整体应用一次，复核世界坐标
s.setPose({
  torsoY: torsoY,
  right: { s: [r1.p.shX, r1.p.shY, r1.p.shZ], e: [r1.p.elX] },
  left: { s: [l1.p.shX, l1.p.shY, l1.p.shZ], e: [l1.p.elX] }
});
alignGun();
const hR1 = handPos('right'), hL1 = handPos('left');
const mz1 = s.parts.muzzle.getWorldPosition(V());
console.log('right: { s: [' + r1.p.shX.toFixed(2) + ', ' + r1.p.shY.toFixed(2) + ', ' + r1.p.shZ.toFixed(2) + '], e: [' + r1.p.elX.toFixed(2) + '] }');
console.log('left:  { s: [' + l1.p.shX.toFixed(2) + ', ' + l1.p.shY.toFixed(2) + ', ' + l1.p.shZ.toFixed(2) + '], e: [' + l1.p.elX.toFixed(2) + '] }');
console.log('右手 ' + fmt(hR1) + ' 误差 ' + hR1.distanceTo(gripR).toFixed(4) + 'm ' + (hR1.distanceTo(gripR) < 0.05 ? '✅' : '❌'));
console.log('左手 ' + fmt(hL1) + ' 误差 ' + hL1.distanceTo(gripL).toFixed(4) + 'm ' + (hL1.distanceTo(gripL) < 0.05 ? '✅' : '❌'));
console.log('双手间距 ' + hR1.distanceTo(hL1).toFixed(3) + 'm ' + (hR1.distanceTo(hL1) > 0.15 && hR1.distanceTo(hL1) < 0.45 ? '✅ 自然' : '❌'));
console.log('枪口 ' + fmt(mz1) + ' → 高度 ' + mz1.y.toFixed(2) + 'm ' +
  (mz1.y > 1.15 && mz1.y < 1.45 ? '✅ 枪在胸前' : '❌ 不在胸前'));
console.log('枪口前伸 ' + (mz1.z - hR1.z).toFixed(2) + 'm ' + (mz1.z > hR1.z + 0.4 ? '✅ 指向正前方' : '❌'));
const chestY1 = s.parts.head.localToWorld(new THREE.Vector3(0, -0.20, 0)).y;
const crotchY1 = s.DIM.hipY;
console.log('（参考：胸 ' + chestY1.toFixed(2) + 'm，髋 ' + crotchY1.toFixed(2) + 'm）');
console.log(hR1.y > crotchY1 + 0.25 ? '✅ 手已明显高于裤裆位置' : '❌ 手仍偏低');

/* ---------- 场景二：瞄准（枪贴脸） ---------- */
console.log('\n===== 瞄准姿态（枪贴脸）=====');
const torsoY2 = s.AIM.torsoY;
const sightR = new THREE.Vector3(s.SIGHT.right[0], s.SIGHT.right[1], s.SIGHT.right[2]);
const sightL = sightR.clone().add(new THREE.Vector3(0, 0, s.SIGHT.gap));
console.log('右手目标 ' + fmt(sightR) + '   左手目标 ' + fmt(sightL));

const r2 = solveArm('right', sightR, { shX: s.AIM.right.s[0], shY: s.AIM.right.s[1], shZ: s.AIM.right.s[2], elX: s.AIM.right.e[0] });
const l2 = solveArm('left', sightL, { shX: s.AIM.left.s[0], shY: s.AIM.left.s[1], shZ: s.AIM.left.s[2], elX: s.AIM.left.e[0] });

s.setPose({
  torsoY: torsoY2,
  right: { s: [r2.p.shX, r2.p.shY, r2.p.shZ], e: [r2.p.elX] },
  left: { s: [l2.p.shX, l2.p.shY, l2.p.shZ], e: [l2.p.elX] }
});
alignGun();
const hR2 = handPos('right'), hL2 = handPos('left');
const mz2 = s.parts.muzzle.getWorldPosition(V());
const eyeY = s.parts.head.localToWorld(new THREE.Vector3(0, 0.19, s.DIM.headR)).y;
console.log('right: { s: [' + r2.p.shX.toFixed(2) + ', ' + r2.p.shY.toFixed(2) + ', ' + r2.p.shZ.toFixed(2) + '], e: [' + r2.p.elX.toFixed(2) + '] }');
console.log('left:  { s: [' + l2.p.shX.toFixed(2) + ', ' + l2.p.shY.toFixed(2) + ', ' + l2.p.shZ.toFixed(2) + '], e: [' + l2.p.elX.toFixed(2) + '] }');
console.log('右手 ' + fmt(hR2) + ' 误差 ' + hR2.distanceTo(sightR).toFixed(4) + 'm ' + (hR2.distanceTo(sightR) < 0.05 ? '✅' : '❌'));
console.log('左手 ' + fmt(hL2) + ' 误差 ' + hL2.distanceTo(sightL).toFixed(4) + 'm ' + (hL2.distanceTo(sightL) < 0.05 ? '✅' : '❌'));
console.log('枪口 ' + fmt(mz2) + ' → 高度 ' + mz2.y.toFixed(2) + 'm，眼睛高度 ' + eyeY.toFixed(2) + 'm');
console.log(Math.abs(mz2.y - eyeY) < 0.30 ? '✅ 枪口与视线同高（瞄准合理）' : '❌ 枪口未到视线高度');
console.log(hR2.y > hR1.y + 0.10 ? '✅ 瞄准比待机明显抬高了 ' + (hR2.y - hR1.y).toFixed(2) + 'm' : '❌ 抬枪幅度不足');

/* ---------- 场景三：倒地贴地复核 ---------- */
console.log('\n===== 倒地贴地复核 =====');
s.setState('dead');
for (let i = 0; i < 40; i++) s.update(1 / 30);
s.group.updateMatrixWorld(true);
const db = allBounds();
console.log('离地 min.y = ' + db.min.y.toFixed(4) + '  ' + (Math.abs(db.min.y) < 0.03 ? '✅ 贴地' : '❌'));
console.log('躺下高度 ' + db.getSize(new THREE.Vector3()).y.toFixed(2) + 'm ' +
  (db.getSize(new THREE.Vector3()).y < 1.0 ? '✅ 确实躺下' : '❌ 没躺平'));

/* ---------- 站姿复核（先复位到 idle 再量，否则仍在倒地状态） ---------- */
s.setState('idle');
s.applyBase();
for (let i = 0; i < 3; i++) s.update(1 / 30);
s.group.updateMatrixWorld(true);
const b = allBounds(), size = b.getSize(new THREE.Vector3());
console.log('\n===== 站姿复核 =====');
console.log('身高 ' + size.y.toFixed(2) + 'm  宽 ' + size.x.toFixed(2) + 'm  深 ' + size.z.toFixed(2) + 'm');
console.log('身高/肩宽 ' + (size.y / size.x).toFixed(2) + '  ' + (size.y / size.x > 1.8 && size.y / size.x < 3.4 ? '✅ 人形' : '❌'));
console.log('脚底 y = ' + b.min.y.toFixed(4) + '  ' + (Math.abs(b.min.y) < 0.02 ? '✅ 贴地' : '❌'));
console.log('三角面 ' + s.triangleCount() + '  ' + (s.triangleCount() < 2000 ? '✅ 手机友好' : '⚠️ 偏高'));