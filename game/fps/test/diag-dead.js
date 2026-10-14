/* 诊断：倒地姿态下每个部件各自的高度范围，找出把包围盒撑高的元凶 */
const THREE = require('./lib/three.min.js');
const buildSoldier = require('./soldier-model.js');
const s = buildSoldier();

s.setState('dead');
for (let i = 0; i < 40; i++) s.update(1 / 30);
s.group.updateMatrixWorld(true);

console.log('DEAD 参数: rotX=' + s.DEAD.rotX + ' y=' + s.DEAD.y);
console.log('');
console.log('部件'.padEnd(22) + 'y范围'.padEnd(20) + 'z范围');
console.log('-'.repeat(60));
const rows = [];
s.group.traverse(o => {
  if (o.isMesh && o.geometry) {
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    const label = (o.parent && o.parent.name ? o.parent.name : '') + ' ' + o.geometry.type +
      ' @' + o.getWorldPosition(new THREE.Vector3()).toArray().map(n => n.toFixed(2)).join(',');
    rows.push({ label, minY: bb.min.y, maxY: bb.max.y, minZ: bb.min.z, maxZ: bb.max.z, size: bb.getSize(new THREE.Vector3()) });
  }
});
rows.sort((a, b) => b.maxY - a.maxY);
rows.forEach(r => {
  console.log(r.label.slice(0, 20).padEnd(22) +
    (r.minY.toFixed(2) + ' ~ ' + r.maxY.toFixed(2)).padEnd(20) +
    (r.minZ.toFixed(2) + ' ~ ' + r.maxZ.toFixed(2)));
});
console.log('\n最高部件: ' + rows[0].label + '  maxY=' + rows[0].maxY.toFixed(3));

// 枪在世界里的朝向
const gunQ = s.parts.gun.getWorldQuaternion(new THREE.Quaternion());
const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(gunQ);
console.log('枪的世界前向向量: (' + fwd.x.toFixed(2) + ', ' + fwd.y.toFixed(2) + ', ' + fwd.z.toFixed(2) + ')');
console.log('  → ' + (Math.abs(fwd.y) < 0.25 ? '✅ 水平' : '❌ 竖直/倾斜，会把包围盒撑高 (' + fwd.y.toFixed(2) + ')'));