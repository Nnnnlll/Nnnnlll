/* 决定性诊断：复现 verify 的调用顺序，dump body 状态 + 最低5部件 */
const THREE = require('./lib/three.min.js');
const buildSoldier = require('./soldier-model.js');
const s = buildSoldier();
const V = () => new THREE.Vector3();

function dump(tag) {
  s.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const rows = [];
  s.group.traverse(o => {
    if (o.isMesh && o.geometry) {
      o.updateMatrixWorld(true);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = new THREE.Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(b);
      rows.push({ t: o.geometry.type.replace('Geometry', ''), minY: b.min.y, maxY: b.maxY, vis: o.visible, inGun: isUnder(o, s.parts.gun) });
    }
  });
  rows.sort((a, b) => a.minY - b.minY);
  console.log('\n== ' + tag + ' ==');
  console.log('body.rot.x=' + s.body.rotation.x.toFixed(3) + ' body.pos.y=' + s.body.position.y.toFixed(3) +
    ' state=' + s.getState() + ' st≈');
  console.log('整体 y: ' + box.min.y.toFixed(3) + ' ~ ' + box.max.y.toFixed(3));
  console.log('最低5个:');
  rows.slice(0, 5).forEach(r => console.log('   ' + r.t.padEnd(8) + ' y ' + r.minY.toFixed(3) + '~' + r.maxY.toFixed(3) +
    (r.vis ? '' : ' [不可见]') + (r.inGun ? ' [枪]' : '')));
  return box;
}
function isUnder(o, anc) { let p = o; while (p) { if (p === anc) return true; p = p.parent; } return false; }

// 复现 verify 顺序
dump('初始');
for (const st of ['idle', 'walk', 'attack', 'dead']) {
  s.setState(st);
  for (let i = 0; i < 20; i++) s.update(1 / 30);
  console.log(st + ' 20帧后: body.rot.x=' + s.body.rotation.x.toFixed(3) + ' pos.y=' + s.body.position.y.toFixed(3));
}
s.setState('dead');
for (let i = 0; i < 40; i++) s.update(1 / 30);
dump('verify step5 之后（40帧）');

// 对照：全新实例直接进 dead
const s2 = buildSoldier();
s2.setState('dead');
for (let i = 0; i < 40; i++) s2.update(1 / 30);
s2.group.updateMatrixWorld(true);
console.log('\n对照（新实例直接 dead）: body.rot.x=' + s2.body.rotation.x.toFixed(3) + ' pos.y=' + s2.body.position.y.toFixed(3));