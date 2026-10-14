/* 定位越界部件：按包围盒 min/max 排序，找出跑偏的 mesh */
var THREE = require('/root/nnnnlll/game/fps/test/lib/three.min.js');
var build = require('/root/nnnnlll/game/fps/test/soldier-model.js');
var s = build();
s.group.updateMatrixWorld(true);

var rows = [];
var box = new THREE.Box3();
s.group.traverse(function (o) {
  if (!o.isMesh || !o.geometry) return;
  box.setFromObject(o);
  var nm = o.material && o.material.color ? '#' + o.material.color.getHexString() : '?';
  rows.push({
    y0: box.min.y, y1: box.max.y, z0: box.min.z, z1: box.max.z, x0: box.min.x, x1: box.max.x,
    col: nm,
    geo: o.geometry.type || 'Buffer',
    verts: o.geometry.attributes.position.count
  });
});

console.log('总数 ' + rows.length);
function show(title, key, asc) {
  console.log('\n===== ' + title + ' =====');
  rows.slice().sort(function (a, b) { return asc ? a[key] - b[key] : b[key] - a[key]; }).slice(0, 6)
    .forEach(function (r) {
      console.log('  ' + key + '=' + r[key].toFixed(3) +
        '  y[' + r.y0.toFixed(3) + ',' + r.y1.toFixed(3) + ']' +
        '  z[' + r.z0.toFixed(3) + ',' + r.z1.toFixed(3) + ']' +
        '  x[' + r.x0.toFixed(2) + ',' + r.x1.toFixed(2) + ']' +
        '  ' + r.col + ' ' + r.geo + ' v' + r.verts);
    });
}
show('最低的部件（minY 最小）', 'y0', true);
show('最高的部件（maxY 最大）', 'y1', false);
show('最靠前（maxZ 最大）', 'z1', false);
show('最靠后（minZ 最小）', 'z0', true);
show('最靠左（minX 最小）', 'x0', true);

console.log('\n===== 总包围盒 =====');
var all = new THREE.Box3().setFromObject(s.group);
console.log('  x[' + all.min.x.toFixed(3) + ',' + all.max.x.toFixed(3) + ']' +
  '  y[' + all.min.y.toFixed(3) + ',' + all.max.y.toFixed(3) + ']' +
  '  z[' + all.min.z.toFixed(3) + ',' + all.max.z.toFixed(3) + ']');