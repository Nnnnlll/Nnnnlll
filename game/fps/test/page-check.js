/* 页面脚本执行验证：在 Node 里用最小 DOM/WebGL stub 跑完整单文件页面的
   四段 <script>，断言：
   ① 四段脚本都能执行不抛错  ② buildSoldier 可用  ③ DOM 元素都被找到
   ④ 动画循环能连续跑若干帧且 soldier 状态在推进  ⑤ 四个按钮点击都能切状态
   （渲染管线本身由 three.js 负责，这里验证的是"页面脚本逻辑"） */
const fs = require('fs');
const vm = require('vm');

const FILE = process.argv[2] || '/root/nnnnlll/game/fps/test/character-v3.0-standalone.html';
const html = fs.readFileSync(FILE, 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

const pass = [], fail = [];
const ok = (label, cond, detail) => {
  (cond ? pass : fail).push(label);
  console.log((cond ? '✅ ' : '❌ ') + label + (detail ? '  — ' + detail : ''));
};

console.log('script 块: ' + blocks.map(b => (b.length / 1024).toFixed(0) + 'KB').join(' / '));
ok('页面含 5 段脚本（three/orbit/geo/model/page）', blocks.length === 5, blocks.length + ' 段');

// ---------- DOM stub ----------
function makeEl(id) {
  return {
    id, textContent: '', style: {}, dataset: {},
    classList: { _s: new Set(), toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } },
    addEventListener(t, fn) { (this._h = this._h || {})[t] = fn; },
    appendChild() {}, getContext() { return null; }
  };
}
const els = {};
const buttons = ['idle', 'walk', 'attack', 'dead'].map(a => { const b = makeEl('btn-' + a); b.dataset.a = a; return b; });
const found = [];
const doc = {
  getElementById(id) { found.push(id); return els[id] || (els[id] = makeEl(id)); },
  querySelector() { return makeEl('canvas'); },
  querySelectorAll(sel) { return sel.includes('button') ? buttons : []; },
  createElement() { return { width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }) }; },
  body: { appendChild() {} }
};

const rafQueue = [];
const sandbox = {
  console, Math, Date, JSON, Object, Array, Number, String, Boolean, Error,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
  Float32Array, Float64Array, ArrayBuffer, DataView, Map, Set, Promise, Symbol, RegExp,
  document: doc, navigator: { userAgent: 'node' },
  innerWidth: 420, innerHeight: 800, devicePixelRatio: 2,
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  setTimeout(fn) { try { fn(); } catch (e) {} return 1; },
  addEventListener() {},
  performance: { now: () => Date.now() }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

// ---------- 逐段执行 ----------
function run(i, label) {
  try {
    vm.runInContext(blocks[i], ctx, { filename: 'block' + i + ':' + label, timeout: 60000 });
    return true;
  } catch (e) {
    console.log('   ❌ block' + i + ' (' + label + ') 抛错: ' + e.message);
    return false;
  }
}

const b0 = run(0, 'three');
ok('three.js 执行', b0);
ok('THREE 已定义', typeof sandbox.THREE === 'object' && !!sandbox.THREE);

// 替换 WebGLRenderer / OrbitControls 为 stub（Node 无 WebGL，不测渲染管线）
if (sandbox.THREE) {
  sandbox.THREE.WebGLRenderer = function () {
    return {
      domElement: makeEl('canvas'), shadowMap: {},
      setPixelRatio() {}, setSize() {}, render() {}, setAnimationLoop() {}
    };
  };
}
const b1 = run(1, 'orbit-controls');
ok('OrbitControls 执行', b1);

sandbox.THREE.OrbitControls = function () {
  return { enableDamping: false, dampingFactor: 0, target: { set() {} }, minDistance: 0, maxDistance: 0, maxPolarAngle: 0, autoRotate: false, update() {} };
};

const bGeo = run(2, 'geo');
ok('geo 几何库执行', bGeo);
ok('GEO 已定义', typeof sandbox.GEO === 'object' && !!sandbox.GEO);
const b2 = run(3, 'soldier-model');
ok('soldier-model 执行', b2);
ok('buildSoldier 可用', typeof sandbox.buildSoldier === 'function');

const b3 = run(4, 'page');
ok('页面主脚本执行', b3);

// ---------- 行为断言 ----------
ok('所有 canvas 无报错（错误框为空）', (els['err'] ? els['err'].textContent : '') === '', JSON.stringify(els['err'] && els['err'].textContent));
ok('HUD 三角面已填充', els['tri'] && els['tri'].textContent !== '-' && els['tri'].textContent !== '', els['tri'] && els['tri'].textContent);
ok('HUD 动画名已填充', els['anim'] && els['anim'].textContent.length > 0, els['anim'] && els['anim'].textContent);

// 手动推进动画循环
let frames = 0;
try {
  for (let i = 0; i < 12; i++) {
    const fn = rafQueue.shift();
    if (!fn) break;
    fn();
    frames++;
  }
} catch (e) {
  console.log('   循环抛错: ' + e.message);
}
ok('动画循环可连续运行', frames >= 10, frames + ' 帧');
ok('soldier 实例已暴露', !!sandbox.__soldier);
ok('scene 实例已暴露', !!sandbox.__scene);

if (sandbox.__soldier) {
  const s = sandbox.__soldier;
  ok('模型无 NaN 坐标', (() => {
    let bad = 0;
    s.group.traverse(o => { if (Number.isNaN(o.position.x + o.position.y + o.position.z)) bad++; });
    return bad === 0;
  })(), '');
  // 四个按钮点击
  let clickOK = 0;
  for (const b of buttons) {
    try {
      if (b._h && b._h.click) { b._h.click(); if (sandbox.__soldier.getState() === b.dataset.a) clickOK++; }
    } catch (e) { console.log('   按钮 ' + b.dataset.a + ' 抛错: ' + e.message); }
  }
  ok('四个动作按钮都能切换状态', clickOK === 4, clickOK + '/4');
  console.log('   最终状态: ' + sandbox.__soldier.getState() + '  三角面 ' + sandbox.__soldier.triangleCount());
}

console.log('\n======== 结果 ========');
console.log('通过 ' + pass.length + ' 项，失败 ' + fail.length + ' 项');
if (fail.length) { fail.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('页面脚本验证全部通过 ✅');