/* 软件渲染器 v1.0 —— 不依赖 GPU/浏览器，纯 JS 光栅化
   为什么需要它：本机识图接口不可用（读不了 PNG），所以
   ① 输出 PNG 给用户看 ② 输出 ASCII 亮度图给 AI 自己"读"轮廓
   用法：
     node render.js png  out.png          # 三视图并排 PNG
     node render.js ascii front           # 字符画 front|side|three
     node render.js stat                  # 只报几何统计
   */
var fs = require('fs');
var zlib = require('zlib');
var path = require('path');
var HERE = '/root/nnnnlll/game/fps/test';
var THREE = require(HERE + '/lib/three.min.js');

var MODEL = process.env.MODEL || (HERE + '/soldier-model.js');
var buildSoldier = require(MODEL);

/* ---------- PNG 编码（8bit RGB） ---------- */
function crc32(buf) {
  var c, crc = 0xffffffff;
  for (var n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var t = Buffer.from(type, 'ascii');
  var body = Buffer.concat([t, data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePNG(file, W, H, rgb) {
  var raw = Buffer.alloc((W * 3 + 1) * H);
  for (var y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  var png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

/* ---------- 收集三角形（世界空间） ---------- */
function collect(root) {
  var tris = [];
  root.updateMatrixWorld(true);
  var nm = new THREE.Matrix3();
  root.traverse(function (o) {
    if (o.isPoints || o.isLine || o.isSprite) return;
    if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    if (o.isMesh === false) return;
    var g = o.geometry, pos = g.attributes.position, idx = g.index, mw = o.matrixWorld;
    nm.getNormalMatrix(mw);
    var col = o.material && o.material.color
      ? [o.material.color.r, o.material.color.g, o.material.color.b] : [0.75, 0.75, 0.75];
    /* 顶点色支持：奶龙这类模型用顶点色分区（肚皮/角/背刺），
       没有顶点色时退回材质单色 */
    var vc = g.attributes.color || null;
    var ca2 = new THREE.Vector3(), cb2 = new THREE.Vector3(), cc2 = new THREE.Vector3();
    /* MeshStandardMaterial 的 emissive 也会提亮，近似一下 */
    var emis = o.material && o.material.emissive
      ? [o.material.emissive.r * (o.material.emissiveIntensity || 1),
         o.material.emissive.g * (o.material.emissiveIntensity || 1),
         o.material.emissive.b * (o.material.emissiveIntensity || 1)] : [0, 0, 0];
    col = [col[0] + emis[0], col[1] + emis[1], col[2] + emis[2]];
    var count = idx ? idx.count : pos.count;
    var a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    var na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
    for (var i = 0; i < count; i += 3) {
      var i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mw);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mw);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mw);
      na.fromBufferAttribute(g.attributes.normal, i0).applyMatrix3(nm).normalize();
      nb.fromBufferAttribute(g.attributes.normal, i1).applyMatrix3(nm).normalize();
      nc.fromBufferAttribute(g.attributes.normal, i2).applyMatrix3(nm).normalize();
      var t = { a: a.clone(), b: b.clone(), c: c.clone(), na: na.clone(), nb: nb.clone(), nc: nc.clone(), col: col, vc: null };
      if (vc) {
        t.vc = [
          ca2.fromBufferAttribute(vc, i0).clone(),
          cb2.fromBufferAttribute(vc, i1).clone(),
          cc2.fromBufferAttribute(vc, i2).clone()
        ];
      }
      tris.push(t);
    }
  });
  return tris;
}

/* ---------- 渲染 ---------- */
function makeCamera(eye, target, fov, aspect) {
  var cam = new THREE.PerspectiveCamera(fov, aspect, 0.05, 200);
  cam.position.copy(eye);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

function render(tris, cam, W, H, bg) {
  var img = Buffer.alloc(W * H * 3);
  for (var i = 0; i < W * H; i++) {
    img[i * 3] = bg[0]; img[i * 3 + 1] = bg[1]; img[i * 3 + 2] = bg[2];
  }
  var zbuf = new Float32Array(W * H).fill(Infinity);

  var lights = [
    { d: new THREE.Vector3(0.55, 0.75, 0.62).normalize(), i: 1.02, c: [1.0, 0.97, 0.92] },
    { d: new THREE.Vector3(-0.62, 0.25, -0.35).normalize(), i: 0.34, c: [0.62, 0.75, 1.0] },
    { d: new THREE.Vector3(0.05, -0.9, 0.25).normalize(), i: 0.16, c: [0.55, 0.6, 0.5] }
  ];
  var ambient = [0.24, 0.26, 0.30];

  tris.forEach(function (t) {
    var v0 = t.a.clone().project(cam), v1 = t.b.clone().project(cam), v2 = t.c.clone().project(cam);
    if (v0.z > 1 && v1.z > 1 && v2.z > 1) return;
    if (v0.z < -1 && v1.z < -1 && v2.z < -1) return;
    var x0 = (v0.x * 0.5 + 0.5) * W, y0 = (0.5 - v0.y * 0.5) * H;
    var x1 = (v1.x * 0.5 + 0.5) * W, y1 = (0.5 - v1.y * 0.5) * H;
    var x2 = (v2.x * 0.5 + 0.5) * W, y2 = (0.5 - v2.y * 0.5) * H;
    var area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) return;
    var twoSided = area < 0;
    if (twoSided) area = -area;

    var minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    var maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    var minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    var maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) return;

    // 面法线（世界）+ 顶点法线插值
    var fn = new THREE.Vector3().subVectors(t.b, t.a).cross(new THREE.Vector3().subVectors(t.c, t.a)).normalize();
    if (fn.lengthSq() < 1e-9) return;

    for (var py = minY; py <= maxY; py++) {
      for (var px = minX; px <= maxX; px++) {
        var cx = px + 0.5, cy = py + 0.5;
        var w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy));
        var w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy));
        var w2 = ((x0 - cx) * (y1 - cy) - (x1 - cx) * (y0 - cy));
        if (twoSided) { w0 = -w0; w1 = -w1; w2 = -w2; }
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        var l0 = w0 / area, l1 = w1 / area, l2 = w2 / area;
        var z = l0 * v0.z + l1 * v1.z + l2 * v2.z;
        var pidx = py * W + px;
        if (z >= zbuf[pidx]) continue;
        zbuf[pidx] = z;

        var n = new THREE.Vector3(
          l0 * t.na.x + l1 * t.nb.x + l2 * t.nc.x,
          l0 * t.na.y + l1 * t.nb.y + l2 * t.nc.y,
          l0 * t.na.z + l1 * t.nb.z + l2 * t.nc.z
        ).normalize();
        var lit = [ambient[0], ambient[1], ambient[2]];
        lights.forEach(function (L) {
          var d = n.dot(L.d);
          if (d < 0) d = 0;
          if (d > 0) {
            lit[0] += L.i * d * L.c[0];
            lit[1] += L.i * d * L.c[1];
            lit[2] += L.i * d * L.c[2];
          }
        });
        // 加法高光（简化）
        var spec = Math.pow(Math.max(0, n.dot(new THREE.Vector3(0.6, 0.7, 0.9).normalize())), 24) * 0.22;
        var o = pidx * 3;
        /* 逐顶点插值的颜色：有顶点色用顶点色，否则用材质色 */
        var lr = t.col[0], lg = t.col[1], lb = t.col[2];
        if (t.vc) {
          lr = l0 * t.vc[0].x + l1 * t.vc[1].x + l2 * t.vc[2].x;
          lg = l0 * t.vc[0].y + l1 * t.vc[1].y + l2 * t.vc[2].y;
          lb = l0 * t.vc[0].z + l1 * t.vc[1].z + l2 * t.vc[2].z;
          lr += t.col[0]; lg += t.col[1]; lb += t.col[2];
        }
        img[o] = Math.min(255, lr * lit[0] * 255 + spec * 255);
        img[o + 1] = Math.min(255, lg * lit[1] * 255 + spec * 255);
        img[o + 2] = Math.min(255, lb * lit[2] * 255 + spec * 255);
      }
    }
  });
  return img;
}

/* ---------- ASCII 输出 ---------- */
function toAscii(img, W, H, cols) {
  var rows = Math.max(8, Math.round(cols * (H / W) * 0.5));
  var ramp = ' .:-=+*#%@';
  var out = [];
  for (var r = 0; r < rows; r++) {
    var line = '';
    for (var c = 0; c < cols; c++) {
      var x0 = Math.floor(c * W / cols), x1 = Math.max(x0 + 1, Math.floor((c + 1) * W / cols));
      var y0 = Math.floor(r * H / rows), y1 = Math.max(y0 + 1, Math.floor((r + 1) * H / rows));
      var sum = 0, n = 0;
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
        var o = (y * W + x) * 3;
        sum += (img[o] * 0.299 + img[o + 1] * 0.587 + img[o + 2] * 0.114); n++;
      }
      var v = n ? sum / n / 255 : 0;
      line += ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1))))];
    }
    out.push(line);
  }
  return out.join('\n');
}

/* ---------- 主流程 ---------- */
var mode = process.argv[2] || 'stat';
var soldier = buildSoldier();
soldier.group.updateMatrixWorld(true);
var box = new THREE.Box3().setFromObject(soldier.group);
var size = box.getSize(new THREE.Vector3());
var center = box.getCenter(new THREE.Vector3());

function stats() {
  var tri = 0, meshes = 0, verts = 0;
  soldier.group.traverse(function (o) {
    if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      meshes++;
      var p = o.geometry.attributes.position;
      verts += p.count;
      tri += (o.geometry.index ? o.geometry.index.count : p.count) / 3;
    }
  });
  console.log('网格数 ' + meshes + '  顶点 ' + verts + '  三角面 ' + Math.round(tri));
  console.log('包围盒 宽 ' + size.x.toFixed(3) + ' 高 ' + size.y.toFixed(3) + ' 深 ' + size.z.toFixed(3));
  console.log('最低点 y = ' + box.min.y.toFixed(4));
}

if (mode === 'stat') { stats(); process.exit(0); }

/* 相机参数：奶龙整体只有 1.24m 高、0.845m 宽，
   相机要给够余量才装得下（含向外张的手臂 0.83m）。 */
var VIEWS = [
  { name: 'front', eye: [0, 0.70, 3.20], tgt: [0, 0.62, 0] },
  { name: 'three', eye: [2.30, 1.05, 2.30], tgt: [0, 0.60, 0] },
  { name: 'side', eye: [3.20, 0.70, 0.02], tgt: [0, 0.62, 0] }
];

if (mode === 'ascii') {
  var want = process.argv[3] || 'front';
  var cols = Number(process.argv[4] || 86);
  var V = VIEWS.filter(function (v) { return v.name === want; })[0] || VIEWS[0];
  var W = 176, H = 300;
  var cam = makeCamera(new THREE.Vector3().fromArray(V.eye), new THREE.Vector3().fromArray(V.tgt), 32, W / H);
  var tris = collect(soldier.group);
  var img = render(tris, cam, W, H, [26, 30, 36]);
  console.log('# 视角 ' + V.name + '  (三角面 ' + tris.length + ')');
  console.log(toAscii(img, W, H, cols));
  process.exit(0);
}

if (mode === 'png') {
  var out = process.argv[3] || '/tmp/soldier.png';
  var W = Number(process.env.PNG_W || 400), H = Number(process.env.PNG_H || 720);
  var bg = [22, 26, 32];
  var total = Buffer.alloc(W * 3 * H * 3);
  var tris = collect(soldier.group);
  VIEWS.forEach(function (V, i) {
    var cam = makeCamera(new THREE.Vector3().fromArray(V.eye), new THREE.Vector3().fromArray(V.tgt), 32, W / H);
    var img = render(tris, cam, W, H, [22, 26, 32]);
    for (var y = 0; y < H; y++) {
      img.copy(total, (y * W * 3 + i * W) * 3, y * W * 3, (y + 1) * W * 3);
    }
  });
  var bytes = writePNG(out, W * 3, H, total);
  console.log('已写出 ' + out + '  ' + (bytes / 1024).toFixed(1) + ' KB  (' + (W * 3) + 'x' + H + ' 三视图)');
  stats();
  process.exit(0);
}

console.log('用法: node render.js stat | ascii [front|side|three] | png <out.png>');