#!/usr/bin/env python3
"""把 three.min.js + OrbitControls.js + blob.js + nailong-model.js 内联，
生成零依赖单文件预览页（手机上直接打开即可，不需要服务器/CDN）。

用法: python3 build-nailong.py [画质档，默认 1.0]
  0.72 省电（约 2.3 万面） / 1.0 标准（约 4 万面） / 1.35 精细（约 7 万面）
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DETAIL = sys.argv[1] if len(sys.argv) > 1 else '1.0'
TAG = '' if DETAIL == '1.0' else ('-d' + DETAIL.replace('.', ''))

OUT = os.path.join(HERE, 'nailong-v1.0%s-standalone.html' % TAG)
SRV_OUT = os.path.join(HERE, 'nailong-v1.0%s.html' % TAG)


def read(p):
    with open(os.path.join(HERE, p), encoding='utf-8') as f:
        return f.read()


three = read('lib/three.min.js')
orbit = read('lib/OrbitControls.js')
blob = read('blob.js')
model = read('nailong-model.js')

for name, src in (('three', three), ('orbit', orbit), ('blob', blob), ('model', model)):
    if '</script' in src:
        raise SystemExit('❌ %s 含 </script，无法安全内联' % name)

# 剥离 UMD 的 Node 分支（浏览器走不到 require），并断言没有残留
model = model.replace(
    "if (typeof module !== 'undefined' && module.exports) {\n"
    "    module.exports = factory(\n"
    "      require(__dirname + '/lib/three.min.js'),\n"
    "      require(__dirname + '/blob.js')\n"
    "    );\n"
    "  } else {\n"
    "    root.buildNailong = factory(root.THREE, root.BLOB);\n"
    "  }",
    "root.buildNailong = factory(root.THREE, root.BLOB);   // 浏览器：THREE/BLOB 已由上面的 script 提供")
blob = blob.replace(
    "if (typeof module !== 'undefined' && module.exports) {\n"
    "    module.exports = factory();\n"
    "  } else {\n"
    "    root.BLOB = factory();\n"
    "  }",
    "root.BLOB = factory();")
for name, src in (('blob', blob), ('model', model)):
    if 'require(' in src:
        raise SystemExit('❌ %s 仍有 require，检查 UMD 头' % name)

HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>奶龙 · 3D 预览 v1.0</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { width:100%; height:100%; overflow:hidden;
    background:radial-gradient(circle at 50% 30%, #2b3550 0%, #141821 65%, #0b0d12 100%);
    font-family:-apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif; color:#eef2f8; }
  canvas { display:block; touch-action:none; }

  #hud { position:fixed; top:10px; left:10px; padding:9px 12px; border-radius:11px;
    background:rgba(14,18,26,.62); backdrop-filter:blur(9px);
    border:1px solid rgba(255,255,255,.09); font-size:11px; line-height:1.7;
    color:#c8d4e4; pointer-events:none; }
  #hud b { color:#ffd85e; font-weight:600; }

  #err { position:fixed; top:0; left:0; right:0; padding:10px 12px; z-index:99;
    background:#c0392b; color:#fff; font-size:12px; line-height:1.55;
    white-space:pre-wrap; display:none; }

  #pad { position:fixed; left:0; right:0; bottom:0; padding:12px 10px 16px;
    display:flex; flex-direction:column; gap:10px; align-items:center;
    background:linear-gradient(to top, rgba(8,10,15,.88), rgba(8,10,15,0)); }
  #row1 { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
  #row1 button { padding:9px 16px; border-radius:10px; font-size:13px; cursor:pointer;
    border:1px solid rgba(255,255,255,.16); background:rgba(38,46,62,.78);
    color:#dce6f2; transition:.14s; }
  #row1 button.on { background:linear-gradient(180deg,#ffd85e,#f0b93c); color:#2a2109;
    border-color:#ffe89a; font-weight:600; }
  #row1 button:active { transform:scale(.95); }
  #row2 { display:flex; gap:8px; align-items:center; }
  #row2 button { padding:6px 12px; border-radius:8px; font-size:11.5px; cursor:pointer;
    border:1px solid rgba(255,255,255,.12); background:rgba(30,36,50,.7); color:#b9c6d8; }
  #row2 button.on { background:rgba(90,170,255,.28); color:#cfe6ff; border-color:rgba(120,190,255,.5); }
  #tip { font-size:10.5px; color:#7b8aa0; text-align:center; }
</style>
</head>
<body>
<div id="err"></div>

<div id="hud">
  <div><b>奶龙</b> · 单文件离线版 v1.0</div>
  <div>三角面 <span id="tri">—</span> · 帧率 <span id="fps">—</span></div>
  <div>网格闭合 <span id="closed">—</span> · 画质档 <span id="detail">__DETAIL__</span></div>
</div>

<div id="pad">
  <div id="row1">
    <button data-s="idle" class="on">待机</button>
    <button data-s="walk">走路</button>
    <button data-s="jump">跳跃</button>
    <button data-s="spin">转圈</button>
  </div>
  <div id="row2">
    <button id="btnShadow" class="on">阴影 开</button>
    <button id="btnWire">线框</button>
    <button id="btnReset">回到正面</button>
  </div>
  <div id="tip">单指拖动旋转 · 双指缩放</div>
</div>

<script>__THREE__</script>
<script>__ORBIT__</script>
<script>__BLOB__</script>
<script>__MODEL__</script>
<script>
(function () {
  'use strict';
  function showErr(msg) {
    var e = document.getElementById('err');
    e.style.display = 'block';
    e.textContent = '出错了：' + msg;
  }
  window.addEventListener('error', function (ev) { showErr(ev.message); });

  try {
    if (typeof THREE === 'undefined') { showErr('THREE 未加载'); return; }
    if (typeof BLOB === 'undefined') { showErr('BLOB 引擎未加载'); return; }
    if (typeof buildNailong === 'undefined') { showErr('模型代码未加载'); return; }

    var DETAIL = __DETAIL__;
    buildNailong.setDetail(DETAIL);
    document.getElementById('detail').textContent = DETAIL;

    /* ---------- 场景 ---------- */
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 60);
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    /* 灯光：主光 + 补光 + 轮廓光，做出软胶玩具的立体感 */
    var hemi = new THREE.HemisphereLight(0xdfefff, 0x2a2f3a, 0.55);
    scene.add(hemi);
    var key = new THREE.DirectionalLight(0xfff3dd, 1.55);
    key.position.set(2.2, 3.4, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 12;
    key.shadow.camera.left = -1.6; key.shadow.camera.right = 1.6;
    key.shadow.camera.top = 1.9; key.shadow.camera.bottom = -0.4;
    key.shadow.bias = -0.0012;
    key.shadow.radius = 3;
    scene.add(key);
    var fill = new THREE.DirectionalLight(0x9ec4ff, 0.42);
    fill.position.set(-2.6, 1.5, 1.4);
    scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffd9a0, 0.55);
    rim.position.set(-1.2, 2.0, -3.0);
    scene.add(rim);

    /* 地面：接住阴影，营造"站在台面上"的感觉 */
    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 48),
      new THREE.ShadowMaterial({ opacity: 0.26 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.0;
    ground.receiveShadow = true;
    scene.add(ground);

    /* ---------- 模型 ---------- */
    var t0 = performance.now();
    var nailong = buildNailong();
    var buildMs = Math.round(performance.now() - t0);
    scene.add(nailong.group);

    /* 自动取景：按包围盒把模型放到合适的距离 */
    var box = new THREE.Box3().setFromObject(nailong.group);
    var size = new THREE.Vector3(); box.getSize(size);
    var center = new THREE.Vector3(); box.getCenter(center);

    /* 闭合性检查（拓扑体检，直接写进 HUD） */
    var raw = nailong.__raw;
    var closedTxt = '—';
    if (raw) {
      var st = BLOB.inspect(raw);
      closedTxt = (st.boundaryEdges === 0 && st.nonManifoldEdges === 0) ? '✅ 是' :
        ('❌ 边界边 ' + st.boundaryEdges);
      window.__stats = st;
    }
    document.getElementById('closed').textContent = closedTxt;
    document.getElementById('tri').textContent = nailong.triangleCount().toLocaleString();

    /* ---------- 控制器 ---------- */
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(center.x, center.y * 0.98, center.z);
    controls.minDistance = 1.1;
    controls.maxDistance = 7.0;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.enablePan = false;
    function homeView() {
      var d = Math.max(size.y * 2.15, 2.6);
      camera.position.set(center.x + 0.25, center.y + size.y * 0.16, center.z + d);
      controls.target.set(center.x, center.y * 0.98, center.z);
      controls.update();
    }
    homeView();

    /* ---------- 状态切换 ---------- */
    var state = 'idle';
    var btns = document.querySelectorAll('#row1 button');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          for (var j = 0; j < btns.length; j++) btns[j].classList.remove('on');
          b.classList.add('on');
          state = b.getAttribute('data-s');
          nailong.setState(state);
          spinAngle = 0;
        });
      })(btns[i]);
    }

    var btnShadow = document.getElementById('btnShadow');
    btnShadow.addEventListener('click', function () {
      renderer.shadowMap.enabled = !renderer.shadowMap.enabled;
      ground.visible = renderer.shadowMap.enabled;
      btnShadow.classList.toggle('on', renderer.shadowMap.enabled);
      btnShadow.textContent = '阴影 ' + (renderer.shadowMap.enabled ? '开' : '关');
      if (renderer.shadowMap.enabled) { nailong.body.material.needsUpdate = true; }
    });

    var wire = false;
    var btnWire = document.getElementById('btnWire');
    btnWire.addEventListener('click', function () {
      wire = !wire;
      btnWire.classList.toggle('on', wire);
      nailong.group.traverse(function (o) {
        if (o.isMesh && o.material && o.material.wireframe !== undefined) {
          o.material.wireframe = wire;
        }
      });
    });

    document.getElementById('btnReset').addEventListener('click', function () { homeView(); });

    addEventListener('resize', function () {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });

    /* ---------- 主循环 ---------- */
    var spinAngle = 0;
    var last = performance.now();
    var acc = 0, frames = 0;
    var fpsEl = document.getElementById('fps');

    function loop(now) {
      requestAnimationFrame(loop);
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (state === 'spin') { spinAngle += dt * 1.5; }
      else { spinAngle = 0; }
      nailong.group.rotation.y = state === 'spin' ? spinAngle : 0;

      nailong.update(dt);
      controls.update();
      renderer.render(scene, camera);

      acc += dt; frames++;
      if (acc >= 0.5) {
        fpsEl.textContent = Math.round(frames / acc);
        acc = 0; frames = 0;
      }
    }
    requestAnimationFrame(loop);

    /* 把关键数据挂到 window，方便自动化校验 */
    window.__nailong = nailong;
    window.__scene = scene;
    window.__buildMs = buildMs;
    window.__detail = DETAIL;
  } catch (e) {
    showErr((e && e.message) || String(e));
  }
})();
</script>
</body>
</html>
"""

html = (HTML
        .replace('__THREE__', three)
        .replace('__ORBIT__', orbit)
        .replace('__BLOB__', blob)
        .replace('__MODEL__', model)
        .replace('__DETAIL__', DETAIL))

# 安全检查：产物里不允许有任何外链或 require
for kw in ('src="lib/', 'src="http', 'import ', 'require(', 'cdn.', 'unpkg', 'jsdelivr'):
    if kw in html and kw not in ('require(',):
        raise SystemExit('❌ 产物含外链关键字: %s' % kw)
if "require(__dirname" in html:
    raise SystemExit('❌ 产物含 Node 专用 require')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)

# 另存一份「服务器版」：拆成外链脚本，便于在本地起服务时调试
srv = (HTML
       .replace('<script>__THREE__</script>', '<script src="lib/three.min.js"></script>')
       .replace('<script>__ORBIT__</script>', '<script src="lib/OrbitControls.js"></script>')
       .replace('<script>__BLOB__</script>', '<script src="blob.js"></script>')
       .replace('<script>__MODEL__</script>', '<script src="nailong-model.js"></script>')
       .replace('__DETAIL__', DETAIL))
with open(SRV_OUT, 'w', encoding='utf-8') as f:
    f.write(srv)

print('✅ %s  %.1f KB' % (os.path.basename(OUT), len(html.encode('utf-8')) / 1024))
print('✅ %s  %.1f KB' % (os.path.basename(SRV_OUT), len(srv.encode('utf-8')) / 1024))
print('   画质档 %s   外链检查 %s' % (DETAIL, '通过（零外链）' if 'src="lib/' not in html else '⚠️ 检查'))