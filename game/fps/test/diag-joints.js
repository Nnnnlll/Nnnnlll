/* 打印关键关节的世界坐标，用于判断姿态是否自然（而不是只看手心误差） */
var THREE = require('/root/nnnnlll/game/fps/test/lib/three.min.js');
var build = require('/root/nnnnlll/game/fps/test/soldier-model.js');

var s = build();
var P = process.argv[2] === 'aim' ? s.AIM : s.BASE;
s.setPose({
  torsoY: P.torsoY,
  right: { s: P.right.s, e: P.right.e },
  left: { s: P.left.s, e: P.left.e }
});
s.autoGround();
s.group.updateMatrixWorld(true);

function w(o) { return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); }
function f(v) { return '(' + v.x.toFixed(3) + ', ' + v.y.toFixed(3) + ', ' + v.z.toFixed(3) + ')'; }

var rows = [
  ['躯干原点', s.parts.torso],
  ['头中心', s.parts.head],
  ['枪口', s.parts.muzzle],
  ['右肩', s.parts.arms.right.shoulder],
  ['右肘', s.parts.arms.right.elbow],
  ['右手', s.parts.arms.right.hand],
  ['左肩', s.parts.arms.left.shoulder],
  ['左肘', s.parts.arms.left.elbow],
  ['左手', s.parts.arms.left.hand]
];
console.log('姿态: ' + (process.argv[2] === 'aim' ? 'AIM 瞄准' : 'BASE 待机'));
rows.forEach(function (r) {
  var v = w(r[1]);
  console.log('  ' + r[0] + ' ' + f(v) +
    '   横向偏移 ' + v.x.toFixed(3) + (Math.abs(v.x) > 0.52 ? '  ⚠ 偏外' : ''));
});

/* 判断手臂是否在身体侧面张开（"鸡翅"）：肘部横向距离 vs 肩宽 */
var shR = w(s.parts.arms.right.shoulder), elR = w(s.parts.arms.right.elbow);
var shL = w(s.parts.arms.left.shoulder), elL = w(s.parts.arms.left.elbow);
console.log('\n肘部横向张开量: 右 ' + (Math.abs(elR.x) - Math.abs(shR.x)).toFixed(3) +
  '  左 ' + (Math.abs(elL.x) - Math.abs(shL.x)).toFixed(3) + '  (负=贴身，正值大=鸡翅)');

/* 手与躯干表面的间隙（用包围盒近似躯干） */
var tBox = new THREE.Box3().setFromObject(s.parts.torso);
var hand = w(s.parts.arms.right.hand);
console.log('躯干包围盒 x[' + tBox.min.x.toFixed(2) + ',' + tBox.max.x.toFixed(2) +
  '] y[' + tBox.min.y.toFixed(2) + ',' + tBox.max.y.toFixed(2) +
  '] z[' + tBox.min.z.toFixed(2) + ',' + tBox.max.z.toFixed(2) + ']');
console.log('右手是否在躯干内: ' +
  (hand.x > tBox.min.x && hand.x < tBox.max.x && hand.y > tBox.min.y && hand.y < tBox.max.y &&
   hand.z > tBox.min.z && hand.z < tBox.max.z ? '⚠ 是（穿模）' : '否'));