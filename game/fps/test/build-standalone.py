#!/usr/bin/env python3
"""把 three.min.js + OrbitControls.js + geo.js + soldier-model.js 内联，
生成零依赖单文件预览页 v3.0（手机上直接打开即可）。

用法: python3 build-standalone.py [画质档 0.7|1.0|1.3]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DETAIL = sys.argv[1] if len(sys.argv) > 1 else '1.1'
TAG = '' if DETAIL == '1.1' else ('-d' + DETAIL.replace('.', ''))

OUT = os.path.join(HERE, 'character-v3.0%s-standalone.html' % TAG)
SRV_OUT = os.path.join(HERE, 'character-v3.0%s.html' % TAG)


def read(p):
    with open(os.path.join(HERE, p), encoding='utf-8') as f:
        return f.read()


three = read('lib/three.min.js')
orbit = read('lib/OrbitControls.js')
geo = read('geo.js')
model = read('soldier-model.js')

for name, src in (('three', three), ('orbit', orbit), ('geo', geo), ('model', model)):
    if '</script' in src:
        raise SystemExit('❌ %s 含 </script，无法安全内联' % name)

# UMD 的 Node 分支在浏览器走不到，打包时剥离；同时把画质档写死进产物
model = model.replace(
    "if (typeof module !== 'undefined' && module.exports) {\n"
    "    module.exports = factory(require(__dirname + '/lib/three.min.js'), require(__dirname + '/geo.js'));\n"
    "  } else {\n"
    "    root.buildSoldier = factory(root.THREE, root.GEO);\n"
    "  }",
    "root.buildSoldier = factory(root.THREE, root.GEO);   // 浏览器：THREE/GEO 已由上面的 script 提供")
geo = geo.replace(
    "if (typeof module !== 'undefined' && module.exports) module.exports = factory(require(__dirname + '/lib/three.min.js'));\n"
    "  else root.GEO = factory(root.THREE);",
    "root.GEO = factory(root.THREE);")
for name, src in (('geo', geo), ('model', model)):
    if 'require(' in src:
        raise SystemExit('❌ %s 仍有 require，检查 UMD 头' % name)

HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>战术行动 · 角色预览 v3.0</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { width:100%; height:100%; overflow:hidden; background:#0e1216;
    font-family:-apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif; color:#e8edf2; }
  canvas { display:block; touch-action:none; }

  #hud { position:fixed; top:10px; left:10px; padding:10px 13px; border-radius:11px;
    background:rgba(12,16,20,.70); border:1px solid rgba(255,255,255,.10);
    backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    font-size:12px; line-height:1.75; letter-spacing:.2px; }
  #hud b { font-size:13px; color:#d8a24a; letter-spacing:.5px; }
  #hud .row { color:#9fb0c0; }
  #hud .v { color:#e8edf2; font-variant-numeric:tabular-nums; }

  #tips { position:fixed; top:10px; right:10px; padding:8px 11px; border-radius:11px;
    background:rgba(12,16,20,.70); border:1px solid rgba(255,255,255,.10);
    font-size:11px; line-height:1.7; color:#8b9bab; text-align:right; }

  #bar { position:fixed; left:0; right:0; bottom:0; display:flex; gap:8px;
    padding:10px 12px calc(10px + env(safe-area-inset-bottom)); justify-content:center;
    background:linear-gradient(to top, rgba(14,18,22,.94), rgba(14,18,22,0)); }
  #bar button { flex:1 1 0; max-width:132px; padding:12px 6px; border-radius:11px;
    border:1px solid rgba(255,255,255,.14); background:rgba(30,38,46,.86); color:#dfe7ee;
    font-size:13px; font-weight:600; letter-spacing:.5px; transition:.15s; }
  #bar button:active { transform:scale(.97); }
  #bar button.on { background:#d8a24a; border-color:#e8b964; color:#1a1408; }

  #err { position:fixed; left:0; right:0; top:0; display:none; z-index:99;
    padding:12px; background:#b3261e; color:#fff; font:11px/1.6 monospace;
    white-space:pre-wrap; max-height:55%; overflow:auto; }

  #load { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:#0e1216; color:#7d8b99; font-size:13px; letter-spacing:1px; z-index:50;
    transition:opacity .4s; }
</style>
</head>
<body>

<div id="hud">
  <div><b>战术行动 · 角色预览 v3.0</b></div>
  <div class="row">三角面 <span class="v" id="tri">-</span></div>
  <div class="row">动画 <span class="v" id="anim">idle</span></div>
  <div class="row">帧率 <span class="v" id="fps">-</span></div>
</div>

<div id="tips">拖动旋转<br>双指缩放</div>

<div id="bar">
  <button data-a="idle" class="on">待机</button>
  <button data-a="walk">行走</button>
  <button data-a="attack">射击</button>
  <button data-a="dead">阵亡</button>
</div>

<div id="err"></div>
<div id="load">加载中…</div>

<script>__THREE__</script>
<script>__ORBIT__</script>
<script>__GEO__</script>
<script>__MODEL__</script>
<script>
(function () {
  'use strict';
  var errBox = document.getElementById('err');
  function showErr(msg) {
    errBox.style.display = 'block';
    errBox.textContent += msg + '\\n';
  }
  window.onerror = function (m, s, l) { showErr('错误: ' + m + ' @' + (s || '').split('/').pop() + ':' + l); };
  window.addEventListener('unhandledrejection', function (e) { showErr('Promise 错误: ' + e.reason); });

  if (typeof THREE === 'undefined') { showErr('THREE 未加载'); return; }
  if (typeof GEO === 'undefined') { showErr('geo.js 未加载'); return; }
  if (typeof buildSoldier === 'undefined') { showErr('soldier-model.js 未加载'); return; }

  // 画质档（减面数 = 更省电；可在控制台调用 window.__setDetail(0.7) 实时切换）
  var DETAIL = __DETAIL__;
  buildSoldier.setDetail(DETAIL);

  // ---------- 场景 ----------
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb8d8);
  scene.fog = new THREE.Fog(0x8fb8d8, 16, 48);

  var camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 200);
  camera.position.set(1.9, 1.55, 3.5);

  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  var controls = null;
  if (typeof THREE.OrbitControls === 'function') {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1.02, 0);
    controls.minDistance = 1.4;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.495;
  } else {
    showErr('提示: OrbitControls 未加载，无法拖动旋转');
  }

  // ---------- 灯光（三点光 + 环境） ----------
  scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x6f7a58, 0.62));
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));

  var sun = new THREE.DirectionalLight(0xfff4e2, 1.0);
  sun.position.set(4.2, 7.2, 3.6);
  sun.castShadow = true;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 26;
  sun.shadow.camera.left = -5;
  sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -4;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0012;
  scene.add(sun);

  var rim = new THREE.DirectionalLight(0xa8c8ff, 0.42);
  rim.position.set(-4.5, 3.6, -4.8);
  scene.add(rim);

  var fill = new THREE.DirectionalLight(0xffd9b0, 0.22);
  fill.position.set(-1.5, 2.0, 4.0);
  scene.add(fill);

  // ---------- 地面 ----------
  var ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x74885a, roughness: 1.0, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  var grid = new THREE.GridHelper(80, 80, 0x5f7548, 0x5f7548);
  grid.position.y = 0.004;
  grid.material.opacity = 0.18;
  grid.material.transparent = true;
  scene.add(grid);

  // ---------- 角色 ----------
  var soldier = buildSoldier();
  scene.add(soldier.group);
  document.getElementById('tri').textContent = soldier.triangleCount().toLocaleString();

  var state = 'idle';

  function setState(s) {
    soldier.setState(s);
    state = s;
    document.getElementById('anim').textContent = s;
    var bs = document.querySelectorAll('#bar button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].dataset.a === s);
  }

  document.querySelectorAll('#bar button').forEach(function (b) {
    b.addEventListener('click', function () { setState(b.dataset.a); });
  });

  // ---------- 循环 ----------
  var clock = new THREE.Clock();
  var frames = 0, fpsT = 0;

  function loop() {
    requestAnimationFrame(loop);
    var dt = Math.min(clock.getDelta(), 0.05);

    soldier.update(dt);
    if (controls) controls.update();
    else camera.lookAt(0, 1.0, 0);

    renderer.render(scene, camera);

    frames++; fpsT += dt;
    if (fpsT >= 0.5) {
      document.getElementById('fps').textContent = Math.round(frames / fpsT) + ' fps';
      frames = 0; fpsT = 0;
    }
  }

  addEventListener('resize', function () {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  setState('idle');
  loop();

  var ld = document.getElementById('load');
  ld.style.opacity = '0';
  setTimeout(function () { ld.style.display = 'none'; }, 420);

  // 调试接口
  window.__soldier = soldier;
  window.__scene = scene;
  window.__setDetail = function (d) {
    showErr('画质档需在页面加载前设定（buildSoldier.setDetail 必须在 build 之前调用）');
  };
})();
</script>
</body>
</html>
"""

html = (HTML
        .replace('__THREE__', three)
        .replace('__ORBIT__', orbit)
        .replace('__GEO__', geo)
        .replace('__MODEL__', model)
        .replace('__DETAIL__', DETAIL))

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)

srv = (HTML
       .replace('__THREE__', '')
       .replace('__ORBIT__', '')
       .replace('__GEO__', '')
       .replace('<script></script>\n<script></script>\n<script></script>\n', '')
       .replace('<script>__MODEL__</script>',
                '<script src="lib/three.min.js"></script>\n'
                '<script src="lib/OrbitControls.js"></script>\n'
                '<script src="geo.js"></script>\n'
                '<script src="soldier-model.js"></script>')
       .replace('__DETAIL__', DETAIL))
with open(SRV_OUT, 'w', encoding='utf-8') as f:
    f.write(srv)

print('已生成: %s' % OUT)
print('大小: %.1f KB  画质档 %s  三角面见 HUD' % (len(html.encode('utf-8')) / 1024, DETAIL))
for kw in ('src="lib/', 'import ', 'require(', 'cdns.', 'unpkg', 'jsdelivr'):
    n = html.count(kw)
    print('  %-14s %d %s' % (kw, n, '✅ 无外部依赖' if n == 0 else '⚠️ 检查'))
print('已生成: %s (%.1f KB)' % (SRV_OUT, len(srv.encode('utf-8')) / 1024))