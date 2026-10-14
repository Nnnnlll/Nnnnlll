/* 最终验证：所有结论都由 Node 里真实几何算出来，不靠肉眼猜。
   1) 贴地与比例  2) 持枪姿态  3) 四向 ASCII 轮廓  4) 动画确实在动 */
const THREE = require('./lib/three.min.js');
const buildSoldier = require('./soldier-model.js');

const s = buildSoldier();
new THREE.Scene().add(s.group);
const V = () => new THREE.Vector3();
const _pq = new THREE.Quaternion();
const pass = [], fail = [];
function check(label, ok, detail) {
  (ok ? pass : fail).push(label);
  console.log((ok ? '✅ ' : '❌ ') + label + (detail ? '  — ' + detail : ''));
}
function allBounds() {
  s.group.updateMatrixWorld(true);
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  s.group.traverse(o => {
    if (o.isMesh && o.geometry) {
      o.updateMatrixWorld(true);
      tmp.setFromObject(o);
      box.union(tmp);
    }
  });
  return box;
}
/* 找出最低的部件（用于排查穿地） */
function lowestPart() {
  const b2 = new THREE.Box3();
  let best = null;
  s.group.traverse(o => {
    if (o.isMesh && o.geometry) {
      o.updateMatrixWorld(true);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b2.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (!best || b2.min.y < best.minY) best = { minY: b2.min.y, t: o.geometry.type, inBody: o.parent && o.parent.parent && o.parent.parent === s.body };
    }
  });
  return best;
}
/* 每个部件的包围盒投影成实心像素，这样才能真正看出轮廓形态 */
function silhouette(axis, W = 52, H = 26) {
  s.group.updateMatrixWorld(true);
  const b = allBounds();
  const grid = Array.from({ length: H }, () => new Array(W).fill(' '));
  s.group.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    let u0, u1, w0, w1;
    if (axis === 'front') { u0 = bb.min.x; u1 = bb.max.x; w0 = bb.min.y; w1 = bb.max.y; }
    else if (axis === 'side') { u0 = bb.min.z; u1 = bb.max.z; w0 = bb.min.y; w1 = bb.max.y; }
    else { u0 = bb.min.x; u1 = bb.max.x; w0 = bb.min.z; w1 = bb.max.z; }
    const rU = axis === 'front' || axis === 'top' ? [b.min.x, b.max.x] : [b.min.z, b.max.z];
    const rW = axis === 'top' ? [b.min.z, b.max.z] : [b.min.y, b.max.y];
    const px = v => Math.floor((v - rU[0]) / (rU[1] - rU[0]) * (W - 1));
    const py = v => H - 1 - Math.floor((v - rW[0]) / (rW[1] - rW[0]) * (H - 1));
    const x0 = px(u0), x1 = px(u1);
    const yA = py(w1), yB = py(w0);   // py 反向：w1(上) 得到较小行号
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(yA, yB); y <= Math.max(yA, yB); y++) {
        if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = '#';
      }
    }
  });
  console.log('\n--- ' + axis.toUpperCase() + ' 视图 ---');
  grid.forEach(r => console.log('|' + r.join('') + '|'));
}

console.log('======== 1. 站姿尺寸 / 贴地 ========');
s.applyBase(); s.group.updateMatrixWorld(true);
let b = allBounds(), size = b.getSize(V());
console.log('身高 ' + size.y.toFixed(3) + 'm  肩宽 ' + size.x.toFixed(3) + 'm  前后深 ' + size.z.toFixed(3) + 'm');
check('脚底贴地', Math.abs(b.min.y) < 0.02, 'min.y = ' + b.min.y.toFixed(4));
check('人形比例 (身高/肩宽 2.0~3.2)', size.y / size.x > 2 && size.y / size.x < 3.2, (size.y / size.x).toFixed(2));
check('身高接近真人 (1.7~2.1m)', size.y > 1.7 && size.y < 2.1, size.y.toFixed(2) + 'm');

console.log('\n======== 2. 关节坐标必须自洽 ========');
const nodePos = obj => { s.group.updateMatrixWorld(true); return obj.getWorldPosition(V()); };
const headNode = s.parts.head, head = nodePos(headNode);
const chest = headNode.localToWorld(new THREE.Vector3(0, -0.20, 0));   // 头节点下移 0.2 = 胸口
const hipL = nodePos(s.parts.legs.left.hip), hipR = nodePos(s.parts.legs.right.hip);
const handL = nodePos(s.parts.arms.left.hand), handR = nodePos(s.parts.arms.right.hand);
const shL = nodePos(s.parts.arms.left.shoulder), shR = nodePos(s.parts.arms.right.shoulder);
const kneeL = nodePos(s.parts.legs.left.knee);
const footL = s.parts.legs.left.knee.localToWorld(new THREE.Vector3(0, -0.38, 0));
const muzzle = nodePos(s.parts.muzzle);
const f = q => '(' + q.x.toFixed(2) + ', ' + q.y.toFixed(2) + ', ' + q.z.toFixed(2) + ')';
console.log('头 ' + f(head) + '   胸 ' + f(chest));
console.log('肩 L' + f(shL) + '  R' + f(shR) + '   髋 L' + f(hipL) + '  R' + f(hipR));
console.log('膝 L' + f(kneeL) + '   脚 L' + f(footL) + '   手 L' + f(handL) + '  R' + f(handR));
console.log('枪口 ' + f(muzzle));
check('头高于胸', head.y > chest.y, (head.y - chest.y).toFixed(2) + 'm');
check('髋低于胸', hipL.y < chest.y - 0.1, '胸 ' + chest.y.toFixed(2) + ' vs 髋 ' + hipL.y.toFixed(2));
check('膝低于髋', kneeL.y < hipL.y, (hipL.y - kneeL.y).toFixed(2) + 'm');
check('脚低于膝', footL.y < kneeL.y, (kneeL.y - footL.y).toFixed(2) + 'm');
check('双脚左右分开', Math.abs(hipL.x - hipR.x) > 0.15, '髋距 ' + Math.abs(hipL.x - hipR.x).toFixed(2));
check('双肩左右分开', Math.abs(shL.x - shR.x) > 0.3, '肩距 ' + Math.abs(shL.x - shR.x).toFixed(2));
check('双手距离自然 (0.15~0.45m)', handR.distanceTo(handL) > 0.15 && handR.distanceTo(handL) < 0.45, handR.distanceTo(handL).toFixed(3) + 'm');
check('双手都在身前', handR.z > 0.1 && handL.z > 0.1, 'z=' + handR.z.toFixed(2) + '/' + handL.z.toFixed(2));
check('双手在胸腹之间高度', handR.y > 1.05 && handR.y < 1.45, handR.y.toFixed(2) + 'm');
check('枪口指向前方', muzzle.z > handR.z + 0.4, '前伸 ' + (muzzle.z - handR.z).toFixed(2) + 'm');
check('枪口在胸线高度', muzzle.y > 1.05 && muzzle.y < 1.45, muzzle.y.toFixed(2) + 'm');
check('枪在双手握持范围', handR.distanceTo(muzzle) < 0.8, handR.distanceTo(muzzle).toFixed(2) + 'm');

console.log('\n======== 3. 三角形数 ========');
check('低面数手机友好 (<4000)', s.triangleCount() < 4000, s.triangleCount() + ' 三角面');

console.log('\n======== 4. 四态动画确实在变 ========');
for (const st of ['idle', 'walk', 'attack', 'dead']) {
  s.setState(st);
  const handY = [], kneeLx = [], bodyRot = [];
  for (let i = 0; i < 20; i++) {
    s.update(1 / 30);
    s.group.updateMatrixWorld(true);
    handY.push(s.parts.arms.right.hand.getWorldPosition(V()).y);
    kneeLx.push(s.parts.legs.left.knee.rotation.x);
    bodyRot.push(s.body.rotation.x);
  }
  const span = a => Math.max(...a) - Math.min(...a);
  const motion = Math.max(span(handY), span(kneeLx), span(bodyRot));
  check(st + ' 有动态变化', motion > 0.01, '位移范围 ' + motion.toFixed(3));
}

console.log('\n======== 5. 倒地贴地 ========');
s.setState('dead');
for (let i = 0; i < 40; i++) s.update(1 / 30);
s.group.updateMatrixWorld(true);
const db = allBounds();
console.log('  测量前 body.pos.y=' + s.body.position.y.toFixed(4) + ' rot.x=' + s.body.rotation.x.toFixed(3));
const beforeMin = db.min.y;
s.autoGround();
s.group.updateMatrixWorld(true);
const db2 = allBounds();
console.log('  手工 autoGround 后: pos.y=' + s.body.position.y.toFixed(4) + ' min.y=' + db2.min.y.toFixed(4));
const lp = lowestPart();
console.log('最低部件: ' + lp.t + '  y=' + lp.minY.toFixed(4) + '  body子级=' + lp.inBody);
check('倒地时贴地', Math.abs(db.min.y) < 0.03, 'min.y = ' + db.min.y.toFixed(4));
check('倒地时确实躺下 (高度显著降低)', db.getSize(V()).y < 1.0, '高度 ' + db.getSize(V()).y.toFixed(2) + 'm');

console.log('\n======== 6. 轮廓（人形判据）========');
s.setState('idle');
for (let i = 0; i < 4; i++) s.update(1 / 30);
silhouette('front');
silhouette('side');

console.log('\n======== 结果 ========');
console.log('通过 ' + pass.length + ' 项，失败 ' + fail.length + ' 项');
if (fail.length) { console.log('失败项:'); fail.forEach(x => console.log('  - ' + x)); process.exit(1); }
console.log('全部通过 ✅');