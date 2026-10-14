/* 列出指定高度以上的部件，用于定位悬空元素 */
var THREE = require('/root/nnnnlll/game/fps/test/lib/three.min.js');
var build = require('/root/nnnnlll/game/fps/test/soldier-model.js');
var s = build();
s.group.updateMatrixWorld(true);

var limit = Number(process.argv[2] || 1.5);
var box = new THREE.Box3();
var rows = [];
s.group.traverse(function (o) {
  if (o.isMesh !== true) return;
  if (!o.geometry) return;
  box.setFromObject(o);
  if (box.max.y > limit) {
    var hex = (o.material && o.material.color) ? '#' + o.material.color.getHexString() : 'noColor';
    rows.push({
      y0: box.min.y, y1: box.max.y, x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z,
      c: hex, v: o.geometry.attributes.position.count
    });
  }
});
rows.sort(function (a, b) { return b.y1 - a.y1; });
rows.forEach(function (r) {
  console.log('y[' + r.y0.toFixed(3) + ',' + r.y1.toFixed(3) + ']' +
    ' x[' + r.x0.toFixed(2) + ',' + r.x1.toFixed(2) + ']' +
    ' z[' + r.z0.toFixed(2) + ',' + r.z1.toFixed(2) + '] ' + r.c + ' v' + r.v);
});
console.log('高于 ' + limit + ' 的部件数: ' + rows.length);