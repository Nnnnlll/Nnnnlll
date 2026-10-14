/* 诊断 autoGround 为什么没把最低点压到 0 */
const THREE = require('./lib/three.min.js');
const buildSoldier = require('./soldier-model.js');
const s = buildSoldier();

function bodyMinY() {
  s.group.updateMatrixWorld(true);
  let minY = Infinity, who = '';
  const box = new THREE.Box3();
  s.body.traverse(o => {
    if (o.isMesh && o.geometry) {
      o.updateMatrixWorld(true);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (box.min.y < minY) { minY = box.min.y; who = o.geometry.type; }
    }
  });
  return { minY, who };
}

console.log('初始 body.position.y = ' + s.body.position.y.toFixed(4));
let r = bodyMinY();
console.log('初始最低点 ' + r.minY.toFixed(4) + ' (' + r.who + ')');

s.setState('dead');
console.log('\n--- setState(dead) 后 ---');
console.log('state=' + s.getState() + ' body.rot.x=' + s.body.rotation.x.toFixed(3) + ' pos.y=' + s.body.position.y.toFixed(4));

for (let i = 0; i < 5; i++) {
  s.update(1 / 30);
  const rr = bodyMinY();
  console.log('第' + (i + 1) + '帧: pos.y=' + s.body.position.y.toFixed(4) +
    ' 最低点=' + rr.minY.toFixed(4) + ' (' + rr.who + ')' +
    ' 枪在手=' + (s.parts.gun.parent === s.parts.arms.right.hand));
}

for (let i = 5; i < 40; i++) s.update(1 / 30);
r = bodyMinY();
console.log('\n40 帧后: pos.y=' + s.body.position.y.toFixed(4) + ' 最低点=' + r.minY.toFixed(4) + ' (' + r.who + ')');

// 手工再贴一次地，看差多少
const before = s.body.position.y;
s.autoGround();
s.group.updateMatrixWorld(true);
const after = bodyMinY();
console.log('手工 autoGround: pos.y ' + before.toFixed(4) + ' → ' + s.body.position.y.toFixed(4) +
  '  最低点 ' + after.minY.toFixed(4) + ' (' + after.who + ')');

// 谁在 y<0 区域
console.log('\n所有 y<0 的部件:');
s.body.traverse(o => {
  if (o.isMesh && o.geometry) {
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    if (bb.min.y < -0.001) {
      console.log('  ' + o.geometry.type + ' y ' + bb.min.y.toFixed(3) + '~' + bb.max.y.toFixed(3) +
        ' 世界位置 ' + o.getWorldPosition(new THREE.Vector3()).toArray().map(n => n.toFixed(2)).join(','));
    }
  }
});