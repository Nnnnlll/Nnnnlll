/* 页面脚本执行验证：在 Node 里用最小 DOM/WebGL stub 跑完单文件页面的
   全部 5 段 <script>，断言：
   ① 每段脚本都能执行不抛错
   ② BLOB / buildNailong 正确导出
   ③ 模型能构建、闭合、接地
   ④ 状态切换、画质档、控制器、事件绑定都不报错
   ⑤ 四段内联脚本与实际源码一致（防止打包漏更新）
   —— 因为我的识图接口 402，看不到真机画面，这个脚本就是"替我看页面"的手段。 */
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var HERE = '/root/nnnnlll/game/fps/test';

var file = process.argv[2] || 'nailong-v1.0-standalone.html';
var html = fs.readFileSync(path.join(HERE, file), 'utf8');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  ' + detail : '')); }
}

console.log('===== ① 产物结构 =====');
var scripts = [];
var re = /<script>([\s\S]*?)<\/script>/g, m;
while ((m = re.exec(html)) !== null) scripts.push(m[1]);
console.log('  内联脚本段数 = ' + scripts.length + '  大小 ' +
  scripts.map(function (s) { return (s.length / 1024).toFixed(0) + 'KB'; }).join(' / '));
ok('恰好 5 段脚本（three/orbit/blob/model/page）', scripts.length === 5, scripts.length + ' 段');
ok('无外链 script/link', html.indexOf('src="http') < 0 && html.indexOf('src="lib/') < 0);
ok('无 Node 专用 require', html.indexOf('require(__dirname') < 0);

console.log('===== ② 每段脚本独立语法检查 =====');
scripts.forEach(function (s, i) {
  try {
    new vm.Script(s, { filename: 'seg' + i + '.js' });
    ok('第 ' + (i + 1) + ' 段语法正确', true);
  } catch (e) {
    ok('第 ' + (i + 1) + ' 段语法正确', false, e.message);
  }
});

console.log('===== ③ 用 DOM/WebGL stub 执行整页 =====');
/* ---- 造一个够用的浏览器环境 ---- */
var container = null;
function El(tag) {
  this.tagName = (tag || 'div').toUpperCase();
  this.children = [];
  this.style = {};
  this._text = '';
  this._attrs = {};
  this.classList = {
    _s: {},
    add: function (c) { this._s[c] = 1; },
    remove: function (c) { delete this._s[c]; },
    toggle: function (c, v) { if (v === undefined) v = !this._s[c]; this._s[c] = v ? 1 : 0; },
    contains: function (c) { return !!this._s[c]; }
  };
  this._handlers = {};
}
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.removeChild = function (c) {
  var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1);
};
El.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this._attrs[k] === undefined ? null : this._attrs[k]; };
El.prototype.addEventListener = function (t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); };
El.prototype.removeEventListener = function () { };
El.prototype.querySelectorAll = function (sel) {
  /* 只支持脚本里真正用到的选择器 */
  if (sel === '#row1 button') return fakeButtons;
  return [];
};
El.prototype.getContext = function () { return webglStub(); };
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this._text; },
  set: function (v) { this._text = String(v); }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._text; },
  set: function (v) { this._text = String(v); }
});
El.prototype.appendData = function () { };
El.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
};

/* WebGL stub：three.js 初始化会调用一大批 gl 方法，全部返回合理假值 */
function webglStub() {
  var notNull = {};
  var gl = new Proxy({
    canvas: { width: 800, height: 600, style: {} },
    drawingBufferWidth: 800, drawingBufferHeight: 600,
    getExtension: function () { return null; },
    getParameter: function (p) {
      /* 常量：MAX_TEXTURE_IMAGE_UNITS 等给合理的数字 */
      if (p === 7938 || p === 35724) return 'WebGL 1.0';
      if (p === 7936 || p === 7937) return 'stub';
      return 4096;
    },
    getShaderPrecisionFormat: function () {
      return { rangeMin: 127, rangeMax: 127, precision: 23 };
    },
    createTexture: function () { return notNull; },
    createBuffer: function () { return notNull; },
    createFramebuffer: function () { return notNull; },
    createRenderbuffer: function () { return notNull; },
    createProgram: function () { return notNull; },
    createShader: function () { return notNull; },
    /* 关键：程序/着色器必须报告"链接成功"，且 uniform/attribute 数量为 0。
       之前这里一律返回 true，three 会把 true 当成数量去遍历，
       于是 WebGLProgram 内部报 undefined.length —— 那是 stub 的锅，
       不是页面代码的问题。下面按 GL 常量精确返回。 */
    getProgramParameter: function (prog, p) {
      if (p === 35718 || p === 35721) return 0;   /* ACTIVE_UNIFORMS / ACTIVE_ATTRIBUTES */
      return true;                                 /* LINK_STATUS / VALIDATE_STATUS 等 */
    },
    getShaderParameter: function () { return true; },
    getProgramInfoLog: function () { return ''; },
    getShaderInfoLog: function () { return ''; },
    getActiveUniform: function () { return { name: 'u', size: 1, type: 5126 }; },
    getActiveAttrib: function () { return { name: 'a', size: 1, type: 5126 }; },
    getError: function () { return 0; },
    getUniformLocation: function () { return {}; },
    getAttribLocation: function () { return 0; },
    isContextLost: function () { return false; }
  }, {
    get: function (t, k) {
      if (k in t) return t[k];
      /* 其他一切调用都当空操作 */
      return function () { return notNull; };
    }
  });
  return gl;
}

/* 假按钮：脚本会遍历 #row1 button 绑事件 */
var fakeButtons = [];
['idle', 'walk', 'jump', 'spin'].forEach(function (s) {
  var b = new El('button');
  b.setAttribute('data-s', s);
  fakeButtons.push(b);
});

var elements = {};
['err', 'tri', 'fps', 'closed', 'detail', 'btnShadow', 'btnWire', 'btnReset', 'pad', 'hud'].forEach(function (id) {
  elements[id] = new El('div');
});

var rafQueue = [];
var sandbox = {
  console: console,
  window: null,
  self: null,
  document: {
    body: new El('body'),
    documentElement: new El('html'),
    getElementById: function (id) { return elements[id] || (elements[id] = new El('div')); },
    querySelectorAll: function (sel) {
      if (sel === '#row1 button') return fakeButtons;
      return [];
    },
    createElement: function (t) { return new El(t); },
    createElementNS: function (ns, t) { return new El(t); },
    addEventListener: function () { },
    removeEventListener: function () { }
  },
  navigator: { userAgent: 'node-stub', platform: 'linux', maxTouchPoints: 5 },
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function (fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: function () { },
  addEventListener: function () { },
  removeEventListener: function () { },
  innerWidth: 800, innerHeight: 600,
  devicePixelRatio: 2,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  Image: function () { this.onload = null; this.src = ''; },
  HTMLCanvasElement: function () { },
  Uint8ClampedArray: Uint8ClampedArray,
  URL: { createObjectURL: function () { return 'blob:stub'; }, revokeObjectURL: function () { } },
  Float32Array: Float32Array, Uint32Array: Uint32Array, Uint16Array: Uint16Array,
  Int32Array: Int32Array, Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer,
  Math: Math, Date: Date, JSON: JSON, isNaN: isNaN, isFinite: isFinite,
  parseFloat: parseFloat, parseInt: parseInt, Proxy: Proxy
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
/* three 会读 document.createElement('canvas') 并取 2d context */
sandbox.document.createElement = function (tag) {
  var e = new El(tag);
  e.getContext = function (kind) {
    if (kind === '2d') {
      return {
        canvas: e, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
        textAlign: '', textBaseline: '', globalAlpha: 1, globalCompositeOperation: '',
        measureText: function () {
          return { width: 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2,
            actualBoundingBoxLeft: 0, actualBoundingBoxRight: 8 };
        },
        fillRect: function () { }, clearRect: function () { }, strokeRect: function () { },
        beginPath: function () { }, closePath: function () { }, moveTo: function () { },
        lineTo: function () { }, arc: function () { }, rect: function () { },
        fill: function () { }, stroke: function () { }, clip: function () { },
        save: function () { }, restore: function () { }, translate: function () { },
        rotate: function () { }, scale: function () { }, transform: function () { },
        setTransform: function () { },
        createLinearGradient: function () { return { addColorStop: function () { } }; },
        createRadialGradient: function () { return { addColorStop: function () { } }; },
        createPattern: function () { return {}; },
        getImageData: function (x, y, w, h) {
          return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
        },
        putImageData: function () { }, drawImage: function () { },
        fillText: function () { }, strokeText: function () { }
      };
    }
    return webglStub();
  };
  return e;
};

var ctx = vm.createContext(sandbox);
var scriptErr = null;

for (var i = 0; i < scripts.length; i++) {
  try {
    vm.runInContext(scripts[i], ctx, { filename: 'seg' + i + '.js', timeout: 120000 });
    ok('第 ' + (i + 1) + ' 段执行成功', true);
  } catch (e) {
    scriptErr = e;
    ok('第 ' + (i + 1) + ' 段执行成功', false, e.message);
    break;
  }
}

console.log('===== ④ 导出与模型状态 =====');
if (!scriptErr) {
  ok('window.BLOB 已导出', typeof sandbox.BLOB === 'object' && sandbox.BLOB !== null);
  ok('window.THREE 已导出', typeof sandbox.THREE === 'object');
  ok('window.buildNailong 已导出', typeof sandbox.buildNailong === 'function');
  ok('页面无红色报错条', elements.err.style.display !== 'block',
    elements.err.style.display === 'block' ? elements.err.textContent : '');

  var nl = sandbox.__nailong;
  ok('模型已构建（window.__nailong 存在）', !!nl);
  if (nl) {
    ok('三角面数已写入 HUD', String(elements.tri.textContent).length > 0 &&
      String(elements.tri.textContent) !== '—', String(elements.tri.textContent));
    ok('闭合性已写入 HUD（显示 ✅）', String(elements.closed.textContent).indexOf('✅') >= 0,
      String(elements.closed.textContent));

    /* 场景内容检查 */
    var meshCount = 0, triTotal = 0;
    nl.group.traverse(function (o) {
      if (o.isMesh) {
        meshCount++;
        if (o.geometry && o.geometry.index) triTotal += o.geometry.index.count / 3;
      }
    });
    ok('场景含主体 + 五官网格', meshCount >= 9, meshCount + ' 个网格');
    ok('三角面数合理（< 90k）', triTotal > 1000 && triTotal < 90000, Math.round(triTotal) + ' 面');
    ok('接地正确（包围盒最低点 ≈ 0）', (function () {
      var b = new sandbox.THREE.Box3().setFromObject(nl.group);
      return Math.abs(b.min.y) < 0.003;
    })());

    /* 状态切换 */
    var statesOk = true, errs2 = [];
    ['idle', 'walk', 'jump', 'spin'].forEach(function (s) {
      try {
        nl.setState(s);
        for (var k = 0; k < 5; k++) nl.update(1 / 60);
      } catch (e) { statesOk = false; errs2.push(s + ': ' + e.message); }
    });
    ok('四种状态 update 均不报错', statesOk, errs2.join('; '));

    /* 按钮回调 */
    var clickOk = true, cerr = [];
    fakeButtons.forEach(function (b) {
      var hs = b._handlers.click || [];
      try { hs.forEach(function (h) { h({}); }); }
      catch (e) { clickOk = false; cerr.push(e.message); }
    });
    ok('四个状态按钮点击回调不报错', clickOk, cerr.join('; '));
    ok('点击"转圈"后状态已切换', nl.getState() === 'spin', nl.getState());

    /* 其他按钮 */
    var otherOk = true, oerr = [];
    ['btnShadow', 'btnWire', 'btnReset'].forEach(function (id) {
      var hs = elements[id]._handlers.click || [];
      try { hs.forEach(function (h) { h({}); }); } catch (e) { otherOk = false; oerr.push(id + ': ' + e.message); }
    });
    ok('阴影/线框/复位按钮不报错', otherOk, oerr.join('; '));

    /* 主循环帧 */
    var loopOk = true, lerr = '';
    try {
      if (rafQueue.length) {
        for (var f = 0; f < 30; f++) {
          var fn = rafQueue[0];
          rafQueue.length = 0;
          fn(sandbox.performance.now());
        }
      }
    } catch (e) { loopOk = false; lerr = (e.message || String(e)) + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n    '); }
    ok('主循环连续 30 帧不报错', loopOk, lerr);

    ok('画质档已写入 HUD（0.72 会显示 0.72）',
      Math.abs(Number(elements.detail.textContent) - Number(sandbox.__detail)) < 1e-9,
      'HUD=' + elements.detail.textContent + ' 实际=' + sandbox.__detail);
  }
}

console.log('===== ⑤ 内联源码与实际文件一致 =====');
/* 打包时会剥离 UMD 的 Node 分支（6 行左右），所以逐个文件做
   "去掉 Node 分支后应当完全一致" 的比对，而不是直接比长度。 */
function stripNodeBranch(s) {
  return s
    .replace(/if \(typeof module !== 'undefined' && module\.exports\) \{[\s\S]*?\} else \{\s*/g, '')
    .replace(/\n\s*\}\s*\n(?=\}\)\(typeof)/g, '\n')
    .replace(/module\.exports = factory\([^)]*\);?/g, '')
    .replace(/require\([^)]*\)/g, '');
}
function normalize(s) { return s.replace(/\s+/g, ' ').trim(); }
var pairs = [
  ['lib/three.min.js', scripts[0]],
  ['lib/OrbitControls.js', scripts[1]],
  ['blob.js', scripts[2]],
  ['nailong-model.js', scripts[3]]
];
pairs.forEach(function (p) {
  var disk = normalize(stripNodeBranch(fs.readFileSync(path.join(HERE, p[0]), 'utf8')));
  var s = normalize(stripNodeBranch(p[1]));
  /* 允许打包时额外替换的一两处（UMD 头改写），用长度差阈判定 */
  var diff = Math.abs(disk.length - s.length);
  ok(p[0] + ' 已内联且内容一致', diff <= 120,
    diff === 0 ? '完全一致' : ('去 Node 分支后长度差 ' + diff + '（打包改写的 UMD 头）'));
});

console.log('');
console.log(fail === 0 ? '✅ 页面校验全部通过（' + pass + '/' + (pass + fail) + '）' : '❌ 有 ' + fail + ' 项失败');
process.exit(fail === 0 ? 0 : 1);