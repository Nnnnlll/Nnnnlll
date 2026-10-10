/* ============================================================
 *  奶蛙2048 · NaiWa 2048
 *  纯原生 HTML + CSS + JavaScript，零依赖、零构建、离线可玩。
 *
 *  物理：自己写的 PBD（位置约束求解）——3 个子步 × 6 次迭代，
 *        碰撞形状按贴图轮廓生成（不是圆），堆叠稳定不抖。
 *
 *  玩法：
 *    · 开局一群奶蛙随机出现在池塘里，**不受重力影响**，就那么漂着；
 *    · 向上 / 左 / 下 / 右滑动（或方向键）→ 重力方向改成那个方向，
 *      所有奶蛙被甩向那一侧，并在那头堆起来；
 *    · 两只**同级**奶蛙贴到一起就合成下一级：2 → 4 → 8 → … → 2048；
 *    · 每次滑动会从另一侧冒出新的小奶蛙（越到后面出得越大）；
 *    · 有奶蛙**停在离“远端墙”22% 以内的危险带里**并且基本不动，
 *      累计 1.5 秒 → 池塘挤爆，游戏结束。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------
   *  常量
   * ------------------------------------------------------- */

  /* 棋盘是正方形（560×560）：四个方向的重力完全等价 ——
     长方形的话「左右」只有 400 宽、「上下」有 680 高，往左右甩会明显更难。 */
  const W = 560;                 // 逻辑宽度
  const H = 560;                 // 逻辑高度
  const WALL = 10;               // 四边墙厚

  /* 奶蛙整体放大系数：下面那套半径是样例为 420×700 的竖长棋盘调的，
     直接搬到 560×560 的方棋盘上会显得又小又慢（同样面积能塞下更多只）。
     放大 30% ≈ 每只多占 69% 面积 → 堆满所需只数少了约四成，节奏明显加快。 */
  const SIZE_SCALE = 1.3;
  const IN_X0 = WALL, IN_X1 = W - WALL;
  const IN_Y0 = WALL, IN_Y1 = H - WALL;
  const AX_X = W - 2 * WALL;     // 池塘内宽 400
  const AX_Y = H - 2 * WALL;     // 池塘内高 680

  const GRAVITY  = 3000;         // px/s²（调大一点：掉得更利索，等静止的时间也更短）
  const KICK     = 270;          // 滑动时甩出去的初速度（px/s）
  const SUBSTEPS = 3;            // 每帧物理子步
  const ITER     = 6;            // 每个子步的约束迭代次数

  const AIR_DAMP = 0.96;         // 漂浮（无重力）时的额外阻尼
  const DAMPING  = 0.996;        // 空气阻尼（每个子步都生效）：调大一点，更快静下来
  const CREEP_SPEED = 60;        // 有接触、速度又低于它 → 直接摁停（不然会一直“慢慢爬”）
  const CREEP_DAMP  = 0.45;      // 摁停力度（每个子步乘一次）
  const FRICTION = 0.955;        // 接触切向摩擦
  const CONTACT_PAD = 0.7;       // 贴墙判定容差（px）
  const RESTITUTION      = 0.38; // 球球弹性
  const WALL_RESTITUTION = 0.45; // 撞墙弹性
  const REST_THRESHOLD   = 55;   // 撞速低于此值不反弹（保堆叠稳定）
  const SQUASH_MAX   = 0.30;     // 撞击挤压最大变形
  const SQUASH_DECAY = 9;        // 挤压回弹速度

  const MERGE_PAD  = 0.8;        // 合成接触容差（px）
  const MAX_TIER   = 10;         // 2048 的索引
  const MAX_BONUS  = 4096;       // 两只 2048 撞一起 → 一起消失 + 奖励分

  const INIT_FROGS = 8;          // 开局漂在场上的奶蛙数量
  const MAX_FROGS  = 44;         // 硬上限（保险，正常到不了）
  const SPAWN_BAND  = 112;       // 新奶蛙在“上风侧”多宽的一条带里出现

  /* 出下一批的规则：滑动 → 等**整池都静止** → 才冒出下一批（一次三只，而且都是漂着的） */
  const SPAWN_PER_TURN = 3;      // 一次冒出几只
  const SETTLE_SPEED  = 44;      // 速度低于它就算“静止”（px/s）
  const SETTLE_HOLD   = 0.20;    // 连续静止这么久 → 判定整池停下来了
  const SETTLE_WAKE   = 0.15;    // 连续动这么久 → 才取消“停下来了”（抗抖动）
  const SPAWN_TIMEOUT = 8;       // 保险：一直静不下来时，最多攒这么久也照样结算 + 放行
  const MAX_OWED      = 2;       // 没结算的“欠账”上限（防手快连甩把池子灌爆）
  /* 连按不再被拒：按下方向键时，先把整池快进到「完全静止 + 欠的那批已经出现」，
     再执行这次输入 —— 玩家不用等，手感是“按了立刻算完”。
     最多快进 FASTFWD_MAX_SEC 秒（跑满就交给原来的超时放行逻辑，绝不卡死）。 */
  const INSTANT_INPUT = true;
  const FASTFWD_MAX_SEC = 4;

  const SWIPE_MIN      = 26;     // 触发滑动的最小位移（CSS px）
  const SWIPE_COOLDOWN = 0.12;   // 两次滑动的最小间隔（秒），防手抖

  const JAM_COV    = 0.78;       // 堆积超过这个比例就算挤到危险带
  const JAM_LIMIT  = 1.5;        // 危险带里“停住”累计多少秒判负
  const REST_SPEED = 140;        // 低于这个速度才算“停住了”（px/s）
  const REST_SPEED2 = REST_SPEED * REST_SPEED;

  const BEST_KEY = 'naiwa.best.v1';
  const MUTE_KEY = 'naiwa.mute.v1';

  /* 四个重力方向 */
  const DIRS = {
    up:    { x:  0, y: -1, arrow: '↑', label: '向上' },
    down:  { x:  0, y:  1, arrow: '↓', label: '向下' },
    left:  { x: -1, y:  0, arrow: '←', label: '向左' },
    right: { x:  1, y:  0, arrow: '→', label: '向右' }
  };
  const DIR_KEYS = ['up', 'down', 'left', 'right'];

  /* 合成链：11 级 = 2 → 2048
     r      : 半径（沿用样例的尺寸梯度，手感已经在样例上验过）
     file   : 贴图（从 BigNaiWa 样例统一过来的 11 张奶蛙，512×512 透明底）
     c1/c2  : 贴图缺失时的兜底配色（程序化画一只绿奶蛙，缺图也不会白屏）
     pc1/pc2: 粒子/汁水颜色 */
  const FROGS = [
    { v: 2,    r: 17,  c1: '#c8f07a', c2: '#5aa02c', pc1: '#c8f07a', pc2: '#5aa02c' },
    { v: 4,    r: 23,  c1: '#a8e86a', c2: '#3f8f22', pc1: '#a8e86a', pc2: '#3f8f22' },
    { v: 8,    r: 31,  c1: '#8ede5c', c2: '#2f7d1c', pc1: '#8ede5c', pc2: '#2f7d1c' },
    { v: 16,   r: 39,  c1: '#7ad06a', c2: '#1f6f2e', pc1: '#7ad06a', pc2: '#1f6f2e' },
    { v: 32,   r: 48,  c1: '#6ec8a0', c2: '#17765c', pc1: '#6ec8a0', pc2: '#17765c' },
    { v: 64,   r: 58,  c1: '#5fc0c0', c2: '#146b78', pc1: '#5fc0c0', pc2: '#146b78' },
    { v: 128,  r: 69,  c1: '#67a8e0', c2: '#1d4f8c', pc1: '#67a8e0', pc2: '#1d4f8c' },
    { v: 256,  r: 81,  c1: '#8f8ce8', c2: '#4436a0', pc1: '#8f8ce8', pc2: '#4436a0' },
    { v: 512,  r: 94,  c1: '#c07ae0', c2: '#6a1f96', pc1: '#c07ae0', pc2: '#6a1f96' },
    { v: 1024, r: 108, c1: '#f08ab0', c2: '#a81f56', pc1: '#f08ab0', pc2: '#a81f56' },
    { v: 2048, r: 124, c1: '#ffd36a', c2: '#c07a00', pc1: '#ffd36a', pc2: '#c07a00' }
  ];
  FROGS.forEach((f, i) => {
    f.r = Math.round(f.r * SIZE_SCALE);      // 统一放大（质量 = r² 会自动跟着变）
    /* 手写补零，不用 padStart —— 老一点的 WebView 里没有这个方法，
       一旦在启动时抛异常，整个游戏都画不出来 */
    f.file = 'assets/frogs/' + (i < 9 ? '0' : '') + (i + 1) + '.png';
  });

  /* ---------------------------------------------------------
   *  DOM
   * ------------------------------------------------------- */

  const $ = (id) => document.getElementById(id);

  const canvas     = $('game');
  const ctx        = canvas.getContext('2d');
  const stage      = $('stage');
  const overlay    = $('overlay');
  const scoreEl    = $('score');
  const bestEl     = $('best');
  const finalScoreEl = $('finalScore');
  const finalBestEl  = $('finalBest');
  const nextCanvas = $('next');
  const nextCtx    = nextCanvas.getContext('2d');
  const chainCanvas = $('chain');
  const chainCtx    = chainCanvas.getContext('2d');
  const soundBtn   = $('soundBtn');
  const resetBtn   = $('resetBtn');
  const restartBtn = $('restartBtn');
  const hintEl     = $('hint');
  const medalEl    = $('medal');
  const gravStatus = $('gravStatus');
  const nextTip    = $('nextTip');
  const footGrav   = $('footGrav');
  const footMoves  = $('footMoves');
  const footState  = $('footState');
  const jamFill    = $('jamFill');
  const jamPct     = $('jamPct');
  const chips = { up: $('gUp'), down: $('gDown'), left: $('gLeft'), right: $('gRight') };

  /* ---------------------------------------------------------
   *  工具
   * ------------------------------------------------------- */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand  = (a, b) => a + Math.random() * (b - a);
  const hypot2 = (x, y) => Math.sqrt(x * x + y * y);

  /* ---------------------------------------------------------
   *  音效（WebAudio 实时合成，无音频文件）
   * ------------------------------------------------------- */

  const Sound = {
    ctx: null,
    muted: localStorage.getItem(MUTE_KEY) === '1',

    ensure() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
      return this.ctx;
    },

    tone(freq, freq2, dur, vol, type) {
      if (this.muted) return;
      const c = this.ensure();
      if (!c) return;
      if (c.state === 'suspended') c.resume();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (freq2 && freq2 !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
      }
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    /* 滑动：一声“唰” */
    swipe(dir) {
      const a = DIRS[dir] || DIRS.down;
      this.tone(a.y < 0 || a.x < 0 ? 420 : 300, 130, 0.13, 0.07, 'triangle');
    },

    merge(tier) {
      const base = 240 * Math.pow(1.1225, tier * 2);
      this.tone(base, base * 1.7, 0.2, 0.16, 'sine');
      this.tone(base * 2, base * 3, 0.12, 0.06, 'triangle');
    },

    spawn() { this.tone(520, 760, 0.09, 0.05, 'sine'); },
    deny()  { this.tone(150, 110, 0.14, 0.05, 'sine'); },
    /* 快进：一记短促的「唰 —— 收」，表示时间被压过去了 */
    warp()  {
      this.tone(1180, 260, 0.16, 0.045, 'triangle');
      this.tone(720, 170, 0.12, 0.03, 'sine');
    },
    over()  { this.tone(420, 90, 0.7, 0.16, 'sawtooth'); },
    win()   { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, f, 0.22, 0.12, 'triangle'), i * 90)); },
    bonus() { [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => this.tone(f, f, 0.18, 0.1, 'square'), i * 80)); }
  };

  /* 手机轻震（跟着静音开关走） */
  function haptic(ms) {
    if (Sound.muted) return;
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* 忽略 */ }
    }
  }

  /* ---------------------------------------------------------
   *  碰撞形状（按贴图轮廓生成的若干内接小圆）
   * ------------------------------------------------------- */

  const SHAPES = (typeof window !== 'undefined' && (window.SUIKA_PARTS || window.NW_PARTS)) || [];
  const UNIT_SHAPE = { rb: 1, parts: [[0, 0, 1]] };

  function shapeOf(tier) {
    const s = SHAPES[tier];
    if (s && s.parts && s.parts.length) return s;
    return UNIT_SHAPE;
  }

  function syncParts(b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const parts = b.parts, r = b.r;
    const wx = b.wx, wy = b.wy, ws = b.ws;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const ox = p[0] * r, oy = p[1] * r;
      wx[i] = b.x + ox * c - oy * s;
      wy[i] = b.y + ox * s + oy * c;
      ws[i] = p[2] * r;
    }
  }

  function makeBall(x, y, tier, vx, vy) {
    const r = FROGS[tier].r;
    const m = r * r;
    const sh = shapeOf(tier);
    const n = sh.parts.length;
    const ball = {
      x, y, vx: vx || 0, vy: vy || 0,
      px: x, py: y,
      r, tier, v: FROGS[tier].v, angle: 0,
      mass: m, invMass: 1 / m,
      bornAt: performance.now(),
      dead: false,
      contacts: 0,
      hitBall: 0,                   // 本子步有没有跟别的奶蛙挤在一起
      cL: 0, cR: 0, cU: 0, cD: 0,   // 贴左/右/上/下墙（切向摩擦要用）
      float: 0,                     // 不受重力（刚冒出来还没开始掉的那只）
      seed: Math.random() * 6.283,  // 漂浮时的上下浮动相位（纯视觉）
      pvx: 0, pvy: 0,
      sq: 0, sqA: 0,
      parts: sh.parts,
      rb: sh.rb * r,
      wx: new Float32Array(n),
      wy: new Float32Array(n),
      ws: new Float32Array(n)
    };
    syncParts(ball);
    return ball;
  }

  /* ---------------------------------------------------------
   *  画布尺寸
   * ------------------------------------------------------- */

  const view = { scale: 1, dpr: 1 };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    let w = rect.width, h = rect.height;
    /* 刚插进 DOM / 还在隐藏标签页里时量不到尺寸，先按窗口兜底，
       不然 view.scale 会停在错的值上，整块棋盘（连带奶蛙）都画不出来 */
    if (!w || !h) {
      w = stage.clientWidth || window.innerWidth || W;
      h = stage.clientHeight || window.innerHeight || H;
    }
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    view.dpr = dpr;
    view.scale = (w * dpr) / W;
  }

  /* ---------------------------------------------------------
   *  游戏状态
   * ------------------------------------------------------- */

  const state = {
    balls: [],
    particles: [],
    floats: [],
    score: 0,
    best: Number(localStorage.getItem(BEST_KEY) || 0),
    moves: 0,
    dir: null,                 // null = 漂浮（不受重力）
    gx: 0, gy: 0,              // 当前重力向量
    nextBatch: [],             // 下一批要出现的等级（一次 SPAWN_PER_TURN 只）
    ghost: [],                 // 下一批奶蛙的「虚像」：下落期间先按将要落地的地方半透明画出来
    ghostAt: 0,
    owed: 0,                   // 还欠几批没结算（滑动 +1，整池静止后结算掉一批）
    settleTimer: 0,            // 连续静止了多久
    moveTime: 0,               // 连续“还在动”了多久
    unrestTimer: 0,            // 一直静不下来的累计时长（保险用）
    owedTimer: 0,              // 这一批欠了多久
    rest: false,               // 整池是否算“停下来了”（带迟滞，不会被单帧抖动带跑）
    showBadge: true,           // 是否画等级数字牌（宣传片会关掉，自己画一套直立的）
    spawnCount: 0,             // 本局一共冒出来多少只（自检脚本用）
    swipeCd: 0,
    jamTime: 0,
    jamCov: 0,
    danger: false,
    arrow: null,               // 滑动方向提示 {dir, life}
    denyFlash: 0,              // “还不能滑”的提示计时
    warp: 0,                   // 刚快进过的提示（画个特效，见 drawWarp）
    ffSteps: 0,                // 上一次快进推进了多少步（调试/自检用）
    ffSettled: false,          // 上一次快进是不是真的到了「完全静止 + 欠账结清」
    denyText: '',
    locked: false,             // 还锁着吗（整池没停下来 / 这一轮还没完）
    shake: 0,
    flash: 0,
    won: false,                // 是否合出过 2048
    over: false
  };

    /* ---------------------------------------------------------
   *  物理
   * ------------------------------------------------------- */

  function stepPhysics(dt) {
    const balls = state.balls;
    const merges = [];
    const contacts = [];
    const gx = state.gx, gy = state.gy;
    const zeroG = (gx === 0 && gy === 0);

    /* --- 积分 --- */
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      b.px = b.x;
      b.py = b.y;
      /* 刚冒出来还没“落地”的那只不受重力影响，先漂着，等玩家滑一下才开始掉 */
      if (!b.float) {
        b.vx += gx * dt;
        b.vy += gy * dt;
      }
      b.pvx = b.vx;             // 求解前速度：弹性冲量用它算，避免被约束“吃掉”
      b.pvy = b.vy;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.contacts = 0;
      b.hitBall = 0;
      b.cL = b.cR = b.cU = b.cD = 0;   // 本子步的贴墙标记（收尾墙约束里重算）
      syncParts(b);
    }

    /* --- 约束求解 --- */
    for (let it = 0; it < ITER; it++) {

      /* 四边墙：每个子圆各自贴墙，推力累加到刚体中心上 */
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (b.dead) continue;
        let pushL = 0, pushR = 0, pushFloor = 0, pushCeil = 0;
        const n = b.parts.length;
        for (let k = 0; k < n; k++) {
          const x = b.wx[k], y = b.wy[k], rr = b.ws[k];
          const l = IN_X0 - (x - rr);        if (l > pushL) pushL = l;
          const rgt = (x + rr) - IN_X1;      if (rgt > pushR) pushR = rgt;
          const dn = (y + rr) - IN_Y1;       if (dn > pushFloor) pushFloor = dn;
          const up = IN_Y0 - (y - rr);       if (up > pushCeil) pushCeil = up;
        }
        if (pushL || pushR || pushFloor || pushCeil) {
          b.x += pushL - pushR;
          b.y += pushCeil - pushFloor;
          b.contacts++;
          if (it === 0) {
            if (pushL)     contacts.push({ ball: b, nx:  1, ny:  0 });
            if (pushR)     contacts.push({ ball: b, nx: -1, ny:  0 });
            if (pushFloor) contacts.push({ ball: b, nx:  0, ny: -1 });
            if (pushCeil)  contacts.push({ ball: b, nx:  0, ny:  1 });
          }
          syncParts(b);
        }
      }

      /* 球球：子圆两两求交，取最“贴”的那一对做修正 */
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.dead) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.dead || a.dead) continue;

          const cdx = b.x - a.x, cdy = b.y - a.y;
          const rbSum = a.rb + b.rb;
          if (cdx * cdx + cdy * cdy >= rbSum * rbSum) continue;

          const pa = a.parts.length, pb = b.parts.length;
          const brb = b.rb;
          let minGap = 1e9, bnx = 0, bny = 0;

          for (let m = 0; m < pa; m++) {
            const ax = a.wx[m], ay = a.wy[m], ar = a.ws[m];
            const ddx = b.x - ax, ddy = b.y - ay;
            const far = brb + ar;
            if (ddx * ddx + ddy * ddy >= far * far) continue;

            for (let k = 0; k < pb; k++) {
              const bx = b.wx[k], by = b.wy[k], br = b.ws[k];
              const dx = bx - ax, dy = by - ay;
              const sum = ar + br;
              const d2 = dx * dx + dy * dy;
              if (d2 >= sum * sum) continue;
              const d = Math.sqrt(d2);
              const gap = d - sum;
              if (gap < minGap) {
                minGap = gap;
                if (d < 1e-4) { bnx = 1; bny = 0; }
                else { bnx = dx / d; bny = dy / d; }
              }
            }
          }

          if (minGap > MERGE_PAD || minGap === 1e9) continue;

          /* 同级贴到一起 → 合成 */
          if (a.tier === b.tier && it === 0) {
            a.dead = true;
            b.dead = true;
            merges.push([a, b]);
            continue;
          }

          if (minGap >= 0) continue;               // 只是挨着，不用推开
          if (it === 0) contacts.push({ a: a, b: b, nx: bnx, ny: bny });
          const corr = Math.min(-minGap - 0.05, 4) * 0.9;
          if (corr <= 0) continue;
          const invSum = a.invMass + b.invMass;
          const wa = a.invMass / invSum;
          const wb = b.invMass / invSum;

          a.x -= bnx * corr * wa;  a.y -= bny * corr * wa;
          b.x += bnx * corr * wb;  b.y += bny * corr * wb;

          a.contacts++;
          b.contacts++;
          a.hitBall = 1;
          b.hitBall = 1;
          syncParts(a);
          syncParts(b);
        }
      }
    }

    /* --- 收尾墙约束（球球分离可能把奶蛙顶出墙外）+ 记录贴墙接触 ---
       贴墙判定带 CONTACT_PAD 容差：奶蛙被重力压在墙上、刚好不穿透时，
       如果只按“穿透量 > 0”算接触，就检测不到接触 → 摩擦失效，
       重力朝左右时奶蛙会顺着墙一直滑下去，堆不稳。 */
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.dead) continue;
      let pushL = 0, pushR = 0, pushFloor = 0, pushCeil = 0;
      for (let k = 0; k < b.parts.length; k++) {
        const x = b.wx[k], y = b.wy[k], rr = b.ws[k];
        const l = IN_X0 - (x - rr);   if (l > pushL) pushL = l;
        const rgt = (x + rr) - IN_X1; if (rgt > pushR) pushR = rgt;
        const dn = (y + rr) - IN_Y1;  if (dn > pushFloor) pushFloor = dn;
        const up = IN_Y0 - (y - rr);  if (up > pushCeil) pushCeil = up;

        if (x - rr <= IN_X0 + CONTACT_PAD) b.cL = 1;   // 贴左墙
        if (x + rr >= IN_X1 - CONTACT_PAD) b.cR = 1;   // 贴右墙
        if (y - rr <= IN_Y0 + CONTACT_PAD) b.cU = 1;   // 贴天花板
        if (y + rr >= IN_Y1 - CONTACT_PAD) b.cD = 1;   // 踩地板
      }
      if (pushL || pushR || pushFloor || pushCeil) {
        b.x += pushL - pushR;
        b.y += pushCeil - pushFloor;
        b.contacts++;
        syncParts(b);
      }
    }

    /* --- 由位置差反推速度（PBD）+ 切向摩擦 + 视觉滚动 --- */
    const invDt = 1 / dt;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.dead) continue;

      const dx = b.x - b.px;
      const dy = b.y - b.py;

      let vx = dx * invDt;
      let vy = dy * invDt;

      /* 摩擦：只来自**当前重力压着的那面墙**，而且只作用在这面墙的切向 ——
         · 重力朝上/下 → “地面”是地板/天花板，只扣水平的 vx。
           贴着左右墙的奶蛙**不该**被墙拖住（否则它顺着墙下滑会莫名减速）
         · 重力朝左/右 → “地面”是左右墙，只扣竖直的 vy
         · 跟别的奶蛙挤在一起 → 也扣一次切向（保堆叠稳定） */
      if (gy > 0) { if (b.cD || b.hitBall) vx *= FRICTION; }
      else if (gy < 0) { if (b.cU || b.hitBall) vx *= FRICTION; }
      else if (gx < 0) { if (b.cL || b.hitBall) vy *= FRICTION; }
      else if (gx > 0) { if (b.cR || b.hitBall) vy *= FRICTION; }

      vx *= DAMPING;                              // 空气阻尼：更快静下来
      vy *= DAMPING;
      if (zeroG || b.float) { vx *= AIR_DAMP; vy *= AIR_DAMP; }  // 漂着的时候再狠一点

      /* 已经挨着东西、速度又很慢了 → 别让它慢慢爬，直接摁停。
         PBD 堆叠时每个子步的位置修正会残留几十 px/s 的“微动”，
         光靠阻尼要好几秒才磨没；有了这一下，整池能干脆地停下来，
         “静止之后才出下一批”才真的成立。 */
      if ((b.contacts > 0 || b.hitBall) && (vx * vx + vy * vy) < CREEP_SPEED * CREEP_SPEED) {
        vx *= CREEP_DAMP;
        vy *= CREEP_DAMP;
      }

      if (b.sq > 0) b.sq = Math.max(0, b.sq - b.sq * SQUASH_DECAY * dt);

      b.vx = vx;
      b.vy = vy;
      b.angle += dx / b.r * 0.85;
    }

    /* --- 弹性冲量：把法向相对速度改写成 e × 碰前速度 --- */
    for (let k = 0; k < contacts.length; k++) {
      const ct = contacts[k];

      if (ct.ball) {
        const b = ct.ball;
        if (b.dead) continue;
        const vnPre = b.pvx * ct.nx + b.pvy * ct.ny;
        if (vnPre < -REST_THRESHOLD) {
          const vnPost = b.vx * ct.nx + b.vy * ct.ny;
          const j = (-WALL_RESTITUTION * vnPre) - vnPost;
          if (j > 0) {
            b.vx += j * ct.nx;
            b.vy += j * ct.ny;
            squash(b, ct.nx, ct.ny, -vnPre);
          }
        }
      } else {
        const a = ct.a, b = ct.b;
        if (a.dead || b.dead) continue;
        const nx = ct.nx, ny = ct.ny;
        const vnPre = (a.pvx - b.pvx) * nx + (a.pvy - b.pvy) * ny;
        if (vnPre > REST_THRESHOLD) {
          const vnPost = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          const j = (vnPost - (-RESTITUTION * vnPre)) / (a.invMass + b.invMass);
          if (j > 0) {
            a.vx -= j * a.invMass * nx;  a.vy -= j * a.invMass * ny;
            b.vx += j * b.invMass * nx;  b.vy += j * b.invMass * ny;
            squash(a, -nx, -ny, vnPre);
            squash(b, nx, ny, vnPre);
          }
        }
      }
    }

    if (merges.length) processMerges(merges);
  }

  function squash(b, nx, ny, speed) {
    const k = Math.min(SQUASH_MAX, speed / 1500);
    if (k <= b.sq) return;
    b.sq = k;
    b.sqA = Math.atan2(ny, nx);
  }

  function processMerges(merges) {
    for (let k = 0; k < merges.length; k++) {
      const a = merges[k][0];
      const b = merges[k][1];
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const tier = a.tier;

      if (tier >= MAX_TIER) {
        /* 两只 2048 → 一起消失，拿奖励分 */
        addScore(MAX_BONUS, mx, my, '+' + MAX_BONUS);
        burst(mx, my, MAX_TIER, 40, 420);
        Sound.bonus();
        haptic(50);
        state.flash = 1;
      } else {
        const nt = tier + 1;
        const nb = makeBall(mx, my, nt, (a.vx + b.vx) * 0.5, (a.vy + b.vy) * 0.5);
        clampInside(nb);
        syncParts(nb);                     // 夹回场内后碰撞形状要跟着挪，否则会“看不见地穿墙”
        nb.px = nb.x;
        nb.py = nb.y;
        nb.popAt = performance.now();
        state.balls.push(nb);

        addScore(FROGS[nt].v, mx, my, '+' + FROGS[nt].v);
        burst(mx, my, nt, 8 + nt * 2, 140 + nt * 22);
        Sound.merge(nt);
        haptic(6 + nt);

        if (nt === MAX_TIER && !state.won) {
          state.won = true;
          state.flash = 1;
          Sound.win();
          if (medalEl) medalEl.hidden = false;
          state.floats.push({ x: W / 2, y: H * 0.42, text: '🎉 2048!', life: 2.6, big: true });
        }
        if (nt === MAX_TIER) state.flash = 1;
      }
    }

    const alive = [];
    for (let i = 0; i < state.balls.length; i++) {
      if (!state.balls[i].dead) alive.push(state.balls[i]);
    }
    state.balls = alive;
  }

  /* 把奶蛙夹回池塘内（合成后新奶蛙更大，可能瞬间卡在墙里） */
  function clampInside(b) {
    b.x = clamp(b.x, IN_X0 + b.rb, IN_X1 - b.rb);
    b.y = clamp(b.y, IN_Y0 + b.rb, IN_Y1 - b.rb);
  }

  /* ---------------------------------------------------------
   *  特效 & 计分
   * ------------------------------------------------------- */

  function burst(x, y, tier, n, speed) {
    const f = FROGS[Math.min(tier, MAX_TIER)];
    const c1 = f.pc1 || f.c1;
    const c2 = f.pc2 || f.c2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(speed * 0.25, speed);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        r: rand(2, 5.5),
        life: 1,
        decay: rand(1.3, 2.4),
        color: Math.random() < 0.5 ? c1 : c2
      });
    }
    if (state.particles.length > 420) state.particles.splice(0, state.particles.length - 420);
  }

  function addScore(n, x, y, text) {
    state.score += n;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem(BEST_KEY, String(state.best));
      bestEl.textContent = state.best;
    }
    scoreEl.textContent = state.score;
    bump(scoreEl);
    if (x !== undefined) state.floats.push({ x, y, text: text || ('+' + n), life: 1 });
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /* ---------------------------------------------------------
   *  重力 / 堆积
   * ------------------------------------------------------- */

  /* 沿重力轴的延伸比例：奶蛙越靠近“远端墙”，这个值越接近 1 */
  function coverageOf(b, dir) {
    const rb = b.rb;
    if (dir === 'down')  return (IN_Y1 - (b.y - rb)) / AX_Y;
    if (dir === 'up')    return ((b.y + rb) - IN_Y0) / AX_Y;
    if (dir === 'right') return (IN_X1 - (b.x - rb)) / AX_X;
    if (dir === 'left')  return ((b.x + rb) - IN_X0) / AX_X;
    return 0;
  }

  function coverageAll(dir) {
    let m = 0;
    for (let i = 0; i < state.balls.length; i++) {
      const b = state.balls[i];
      if (b.dead || b.float) continue;      // 漂在空中的那只不算进“堆积”
      const c = coverageOf(b, dir);
      if (c > m) m = c;
    }
    return m;
  }

  /* 危险带（画虚线用） */
  function dangerLine(dir) {
    if (dir === 'down')  { const y = IN_Y0 + AX_Y * (1 - JAM_COV); return { x1: IN_X0, y1: y, x2: IN_X1, y2: y }; }
    if (dir === 'up')    { const y = IN_Y1 - AX_Y * (1 - JAM_COV); return { x1: IN_X0, y1: y, x2: IN_X1, y2: y }; }
    if (dir === 'right') { const x = IN_X0 + AX_X * (1 - JAM_COV); return { x1: x, y1: IN_Y0, x2: x, y2: IN_Y1 }; }
    if (dir === 'left')  { const x = IN_X1 - AX_X * (1 - JAM_COV); return { x1: x, y1: IN_Y0, x2: x, y2: IN_Y1 }; }
    return null;
  }

  /* 判负：危险带里停住的奶蛙累计够久 → 池塘挤爆 */
  function checkJam(dt) {
    if (!state.dir) {
      state.jamTime = 0;
      state.jamCov = 0;
      state.danger = false;
      return;
    }
    const cov = coverageAll(state.dir);
    state.jamCov = cov;

    let resting = false;
    for (let i = 0; i < state.balls.length; i++) {
      const b = state.balls[i];
      if (b.dead || b.float) continue;     // 漂着的不算“卡住”（它还没开始掉）
      if (coverageOf(b, state.dir) > JAM_COV) {
        if (b.vx * b.vx + b.vy * b.vy < REST_SPEED2) { resting = true; break; }
      }
    }

    if (resting) {
      state.jamTime += dt;
      if (state.jamTime > JAM_LIMIT) { gameOver(); return; }
    } else {
      state.jamTime = Math.max(0, state.jamTime - dt * 2);
    }

    if (state.balls.length > MAX_FROGS) { gameOver(); return; }
    state.danger = cov > JAM_COV;
  }

  /* ---------------------------------------------------------
   *  滑动 → 改变重力方向
   * ------------------------------------------------------- */

  function setGravity(dir) {
    const d = DIRS[dir];
    state.dir = dir;
    state.gx = d.x * GRAVITY;
    state.gy = d.y * GRAVITY;
  }

  /* 「还不能滑」的提示：抖一下 + 一声闷响，画面上飘一句为什么 */
  function denySwipe() {
    state.denyFlash = 0.85;
    state.denyText = state.owed > 0 ? '等新奶蛙出现…' : '等奶蛙全停下…';
    state.shake = 0.5;
    Sound.deny();
    haptic(5);
  }

  function applySwipe(dir) {
    if (state.over || !DIRS[dir]) return false;

    /* —— 连按不再被拒 ——
       以前整池没停下来时这一下会被丢掉（要等 1~2 秒，手感很糟）。
       现在：先把整池**快进到完全静止**（顺手把欠的那一批新奶蛙结算出来），
       然后立刻执行这次输入。所以“狂按”时的节奏完全由玩家决定。 */
    const ff = INSTANT_INPUT ? fastForwardToRest() : 0;
    if (state.over) return false;                       // 快进过程中判负了
    if (ff > 4) { state.warp = 1; Sound.warp(); }       // 真的快进了一段才给提示音/特效

    /* 唯一还会拒绝的情况：池子卡住了、4 秒都静不下来，而且欠账已经到顶 ——
       再收就要把池子灌爆（这种情况本来也快判负了）。 */
    if (state.locked && state.owed >= MAX_OWED) { denySwipe(); return false; }

    const first = !state.dir;
    setGravity(dir);
    state.swipeCd = SWIPE_COOLDOWN;
    state.moves++;

    /* 把整池奶蛙朝新重力方向甩一下；
       顺带解掉“漂浮”状态 —— 刚才漂着的那只从现在开始也受重力了 */
    const d = DIRS[dir];
    for (let i = 0; i < state.balls.length; i++) {
      const b = state.balls[i];
      b.vx += d.x * KICK;
      b.vy += d.y * KICK;
      b.contacts = 0;
      b.float = 0;
    }

    state.arrow = { dir: dir, life: 1 };
    state.shake = 1;
    /* 这一滑欠下一批奶蛙：等整池都静止了再结算。
       注意**不要**在这里重置欠账计时 —— 否则玩家连甩（比静止判定还快）时，
       计时会被一次次清零，欠的那批永远发不出来。
       但必须把「已经停下来了」这个状态立刻抹掉：滑动这一刻奶蛙正要被甩出去，
       残留的 rest=true 会让下一帧就误判成“静止”，新的一批会当场冒出来。 */
    if (state.owed < MAX_OWED) state.owed++;
    /* 让这一批马上以「虚像」出现在它将要落地的地方：整池还在下落的时候就能看见它们 */
    previewSpawn();
    state.rest = false;
    state.settleTimer = 0;
    state.moveTime = 0;

    Sound.swipe(dir);
    haptic(first ? 14 : 8);
    if (first && hintEl) hintEl.classList.add('hide');
    state.locked = true;             // 立刻锁上，等这一轮走完
    paintGravity();
    paintNextTip();
    paintFoot();
    return true;
  }

  /* 新奶蛙的等级：越到后面冒出来的越大 */
  function pickSpawnTier(mv) {
    let table;
    if (mv < 10)      table = [[0, 0.72], [1, 0.28]];
    else if (mv < 24) table = [[0, 0.46], [1, 0.30], [2, 0.24]];
    else              table = [[0, 0.28], [1, 0.24], [2, 0.20], [3, 0.16], [4, 0.12]];
    let r = Math.random(), acc = 0;
    for (let i = 0; i < table.length; i++) {
      acc += table[i][1];
      if (r <= acc) return table[i][0];
    }
    return table[0][0];
  }

  /* 找一个空位：优先“上风侧”的一条带（重力反方向），漂浮时在池子中间随机
     gap：和已有奶蛙至少留出的间距（开局要留大一点，别让它们漂着漂着就贴上了） */
  function findSpot(tier, dir, gap, extra) {
    const rb = shapeOf(tier).rb * FROGS[tier].r;
    if (gap === undefined) gap = 6;
    let best = null, bestGap = -1e9;

    for (let i = 0; i < 40; i++) {
      let x, y;
      if (!dir) {
        /* 开局漂浮：往池子中间收一点，别贴着墙，一眼就能看见 */
        const mx = AX_X * 0.14, my = AX_Y * 0.14;
        x = rand(IN_X0 + rb + mx, IN_X1 - rb - mx);
        y = rand(IN_Y0 + rb + my, IN_Y1 - rb - my);
      } else if (dir === 'down') {          // 重力向下 → 从天而降
        y = rand(IN_Y0 + rb + 2, Math.min(IN_Y0 + rb + 2 + SPAWN_BAND, IN_Y1 - rb));
        x = rand(IN_X0 + rb, IN_X1 - rb);
      } else if (dir === 'up') {            // 重力向上 → 从底下冒出来
        y = rand(Math.max(IN_Y1 - rb - 2 - SPAWN_BAND, IN_Y0 + rb), IN_Y1 - rb - 2);
        x = rand(IN_X0 + rb, IN_X1 - rb);
      } else if (dir === 'right') {         // 重力向右 → 从左侧推出来
        x = rand(IN_X0 + rb + 2, Math.min(IN_X0 + rb + 2 + SPAWN_BAND, IN_X1 - rb));
        y = rand(IN_Y0 + rb, IN_Y1 - rb);
      } else {                              // 重力向左 → 从右侧推出来
        x = rand(Math.max(IN_X1 - rb - 2 - SPAWN_BAND, IN_X0 + rb), IN_X1 - rb - 2);
        y = rand(IN_Y0 + rb, IN_Y1 - rb);
      }

      let minGap = 1e9;
      for (let k = 0; k < state.balls.length; k++) {
        const b = state.balls[k];
        if (b.dead) continue;
        const g = hypot2(b.x - x, b.y - y) - (rb + b.rb);
        if (g < minGap) minGap = g;
      }
      /* 同一批里前面的那几只也要算进去，免得虚像叠在一起 */
      if (extra) {
        for (let k = 0; k < extra.length; k++) {
          const e = extra[k];
          const g = hypot2(e.x - x, e.y - y) - (rb + e.rb);
          if (g < minGap) minGap = g;
        }
      }
      if (minGap > gap) return { x, y };
      if (minGap > bestGap) { bestGap = minGap; best = { x, y }; }
    }
    return best;
  }

  /* 这一批奶蛙的「虚像」：滑动之后整池还在下落时，先把它们按将要出现的位置画成半透明的；
     等整池静止（deliverSpawn）时就地变成实体 —— 位置只算一次、存下来复用，
     所以虚像和真身一定在同一个地方，不会“跳”一下。 */
  function previewSpawn() {
    state.ghost.length = 0;
    if (!state.dir) return;                    // 开局没有重力，谈不上“下一批从哪边来”
    if (!state.nextBatch.length) refillNextBatch();
    if (!state.nextBatch.length) return;

    const taken = [];
    for (let i = 0; i < state.nextBatch.length; i++) {
      const tier = state.nextBatch[i];
      /* 每只依次多要一点间距，免得三只虚像挤在一起 */
      const spot = findSpot(tier, state.dir, 6 + i * 10, taken);
      if (!spot) continue;
      const rb = shapeOf(tier).rb * FROGS[tier].r;
      taken.push({ x: spot.x, y: spot.y, rb: rb });
      state.ghost.push({ tier: tier, x: spot.x, y: spot.y, rb: rb });
    }
    state.ghostAt = performance.now();
  }

  function spawnFrog(tier, spot) {
    if (tier === undefined) tier = state.nextBatch[0] || 0;
    const at = spot || findSpot(tier, state.dir);
    if (!at) return null;
    const b = makeBall(at.x, at.y, tier, 0, 0);
    b.popAt = performance.now();
    state.balls.push(b);
    state.spawnCount++;
    Sound.spawn();
    return b;
  }

  /* 预先摇好下一批的等级（面板上的「下一个」要显示它） */
  function refillNextBatch() {
    const arr = [];
    for (let i = 0; i < SPAWN_PER_TURN; i++) arr.push(pickSpawnTier(state.moves));
    state.nextBatch = arr;
    return arr;
  }

  /* 整池都静止了吗？（速度都很小才算） */
  function allSettled() {
    for (let i = 0; i < state.balls.length; i++) {
      const b = state.balls[i];
      if (b.dead) continue;
      if (b.vx * b.vx + b.vy * b.vy > SETTLE_SPEED * SETTLE_SPEED) return false;
    }
    return true;
  }

  /* 结算：整池静止之后才冒出下一批（SPAWN_PER_TURN 只，而且都是「漂着」的，不受重力） */
  function deliverSpawn() {
    if (!state.nextBatch.length) refillNextBatch();
    state.owed--;
    state.settleTimer = 0;
    state.owedTimer = 0;

    const batch = state.nextBatch.slice();
    const made = [];
    for (let i = 0; i < batch.length; i++) {
      /* 有虚像就照着虚像的位置落地（虚像 = 预览，位置一模一样，不会“跳”一下） */
      const g = state.ghost[i];
      const b = spawnFrog(batch[i], (g && g.tier === batch[i]) ? g : null);
      if (!b) continue;
      b.float = 1;                   // 刚出现的这几只都不受重力，等玩家滑一下才开始掉
      b.vx = 0;
      b.vy = 0;
      b.px = b.x;
      b.py = b.y;
      made.push(b);
    }
    state.ghost.length = 0;          // 虚像变实体了
    refillNextBatch();
    drawNext();
    paintNextTip();
    return made;
  }

  /* 开局：一群奶蛙漂在池子里，没有重力 */
  function dealInitial() {
    const opening = [0, 0, 0, 1, 1, 2, 3, 0];
    for (let i = 0; i < INIT_FROGS; i++) {
      const tier = opening[i % opening.length];
      /* 间距留宽一点 + 初速很小，保证开局是“静静漂着”，不会一上来就自己合成 */
      const spot = findSpot(tier, null, 30);
      if (!spot) break;
      const b = makeBall(spot.x, spot.y, tier, rand(-22, 22), rand(-22, 22));
      b.popAt = performance.now();
      state.balls.push(b);
    }
  }

  /* ---------------------------------------------------------
   *  结束 / 重开
   * ------------------------------------------------------- */

  function gameOver() {
    if (state.over) return;
    state.over = true;
    finalScoreEl.textContent = state.score;
    finalBestEl.textContent = state.best;
    overlay.classList.add('show');
    Sound.over();
    /* 交给排行榜模块结算（没加载/离线也不影响玩） */
    if (window.NaiwaBoard && window.NaiwaBoard.onGameOver) {
      window.NaiwaBoard.onGameOver(state.score);
    }
  }

  function reset() {
    state.balls.length = 0;
    state.particles.length = 0;
    state.floats.length = 0;
    state.ghost.length = 0;
    state.ghostAt = 0;
    state.score = 0;
    state.moves = 0;
    state.dir = null;
    state.gx = 0;
    state.gy = 0;
    state.won = false;
    state.over = false;
    state.jamTime = 0;
    state.jamCov = 0;
    state.danger = false;
    state.arrow = null;
    state.denyFlash = 0;
    state.denyText = '';
    state.warp = 0;
    state.ffSteps = 0;
    state.ffSettled = false;
    state.locked = false;
    state.shake = 0;
    state.flash = 0;
    state.swipeCd = 0;
    state.owed = 0;
    state.settleTimer = 0;
    state.moveTime = 0;
    state.unrestTimer = 0;
    state.owedTimer = 0;
    state.rest = false;
    state.spawnCount = 0;
    refillNextBatch();
    overlay.classList.remove('show');
    if (medalEl) medalEl.hidden = true;
    scoreEl.textContent = '0';
    bestEl.textContent = state.best;
    dealInitial();
    /* 开局把“有几只奶蛙漂着”直接写在提示条上，免得看不出来 */
    if (hintEl) {
      hintEl.classList.remove('hide');
      const txt = hintEl.querySelector ? hintEl.querySelector('.hint-txt') : null;
      const tip = state.balls.length + ' 只奶蛙漂着（不受重力）· 滑动决定重力方向';
      if (txt) txt.textContent = tip; else hintEl.textContent = tip;
    }
    paintGravity();
    paintJam();
    paintNextTip();
    paintFoot();
    drawNext();
    Sound.ensure();
  }

  /* ---------------------------------------------------------
   *  UI 面板
   * ------------------------------------------------------- */

  function paintGravity() {
    for (let i = 0; i < DIR_KEYS.length; i++) {
      const k = DIR_KEYS[i];
      const el = chips[k];
      if (!el) continue;
      if (state.dir === k) el.classList.add('on');
      else el.classList.remove('on');
      /* 只有真会被拒的时候才变淡（连按不再被拒，平时都是亮的） */
      if (state.blocked) el.classList.add('wait');
      else el.classList.remove('wait');
      el.setAttribute('aria-pressed', String(state.dir === k));
    }
    if (gravStatus) {
      gravStatus.textContent = state.dir
        ? ('重力 ' + DIRS[state.dir].arrow + ' ' + DIRS[state.dir].label + ' · 已滑 ' + state.moves + ' 次')
        : '漂浮中 · 滑动决定重力朝向';
    }
  }

  /* 棋盘下面那条状态栏 */
  function paintFoot() {
    if (footGrav) {
      footGrav.textContent = state.dir
        ? DIRS[state.dir].arrow + ' ' + DIRS[state.dir].label
        : '漂浮中';
    }
    if (footMoves) footMoves.textContent = state.moves;

    if (footState) {
      let txt;
      if (state.over) txt = '本局结束';
      else if (state.blocked) txt = '池子卡住了 · 稍等一下';
      else if (state.locked && state.owed > 0 && !state.rest) txt = '结算中…（按下即刻算完）';
      else if (state.locked && state.owed > 0) txt = '新奶蛙即将出现 ✨';
      else if (state.locked) txt = '结算中…（按下即刻算完）';
      else txt = '可以滑了 → 选个方向';
      if (footState.textContent !== txt) footState.textContent = txt;
      if (state.blocked) footState.classList.add('waiting');
      else footState.classList.remove('waiting');
    }
  }

  /* 「下一个」下面的小字：说明这一批什么时候出来 */
  function paintNextTip() {
    if (!nextTip) return;
    let txt;
    if (state.over) txt = '本局结束';
    else if (state.blocked) txt = '池子卡住了 · 下一批要等一下';
    else if (state.locked && state.owed > 0) txt = '下一批马上到（按方向键会立刻算完）';
    else if (state.locked) txt = '还在结算（按方向键会立刻算完）';
    else txt = '整池静止后一次出现 ' + SPAWN_PER_TURN + ' 只（漂着，不受重力）';
    if (nextTip.textContent !== txt) nextTip.textContent = txt;
    if (state.blocked) nextTip.classList.add('waiting');
    else nextTip.classList.remove('waiting');
  }

  function paintJam() {
    const pct = Math.round(clamp(state.jamCov, 0, 1) * 100);
    if (jamFill) {
      jamFill.style.width = pct + '%';
      if (state.danger) jamFill.classList.add('hot');
      else jamFill.classList.remove('hot');
    }
    if (jamPct) jamPct.textContent = pct + '%';
  }

  function paintSoundBtn() {
    const ico = soundBtn.querySelector('.ico');
    const lbl = soundBtn.querySelector('.lbl');
    if (ico) ico.textContent = Sound.muted ? '🔇' : '🔊';
    if (lbl) lbl.textContent = Sound.muted ? '音效关' : '音效开';
    soundBtn.setAttribute('aria-pressed', String(!Sound.muted));
  }

  /* ---------------------------------------------------------
   *  绘制
   * ------------------------------------------------------- */

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.arcTo(x + w, y, x + w, y + rr, rr);
    c.lineTo(x + w, y + h - rr);
    c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    c.lineTo(x + rr, y + h);
    c.arcTo(x, y + h, x, y + h - rr, rr);
    c.lineTo(x, y + rr);
    c.arcTo(x, y, x + rr, y, rr);
    c.closePath();
  }

  /* 程序化奶蛙（换皮 & 贴图缺失时的兜底） */
  function drawCuteFrog(c, r, tier) {
    const f = FROGS[tier];
    const gold = (tier === MAX_TIER);

    /* 身体 */
    const g = c.createRadialGradient(-r * 0.34, -r * 0.42, r * 0.12, 0, 0, r * 1.14);
    g.addColorStop(0, f.c1);
    g.addColorStop(1, f.c2);
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();

    /* 肚皮 */
    c.beginPath();
    c.ellipse(0, r * 0.30, r * 0.58, r * 0.42, 0, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,.42)';
    c.fill();

    /* 眼睛 */
    const eyeR = r * 0.30, eyeX = r * 0.40, eyeY = -r * 0.46;
    c.fillStyle = f.c1;
    c.beginPath(); c.arc(-eyeX, eyeY, eyeR, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc( eyeX, eyeY, eyeR, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(-eyeX, eyeY, eyeR * 0.74, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc( eyeX, eyeY, eyeR * 0.74, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(34,26,20,.9)';
    if (r >= 20) {
      c.beginPath(); c.arc(-eyeX + eyeR * 0.16, eyeY, eyeR * 0.40, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc( eyeX + eyeR * 0.16, eyeY, eyeR * 0.40, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.95)';
      c.beginPath(); c.arc(-eyeX - eyeR * 0.14, eyeY - eyeR * 0.24, eyeR * 0.16, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc( eyeX - eyeR * 0.14, eyeY - eyeR * 0.24, eyeR * 0.16, 0, Math.PI * 2); c.fill();
    } else {
      c.beginPath(); c.arc(-eyeX, eyeY, eyeR * 0.34, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc( eyeX, eyeY, eyeR * 0.34, 0, Math.PI * 2); c.fill();
    }

    /* 大嘴（奶蛙的招牌笑） */
    if (r >= 16) {
      c.beginPath();
      c.arc(0, r * 0.02, r * 0.46, 0.12 * Math.PI, 0.88 * Math.PI);
      c.lineWidth = Math.max(1.2, r * 0.075);
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(38,28,20,.70)';
      c.stroke();
    }

    /* 腮红 + 斑点 */
    if (r >= 20) {
      c.fillStyle = 'rgba(255,140,150,.36)';
      c.beginPath(); c.ellipse(-r * 0.62, r * 0.16, r * 0.15, r * 0.10, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse( r * 0.62, r * 0.16, r * 0.15, r * 0.10, 0, 0, Math.PI * 2); c.fill();
    }
    if (tier >= 5 && r >= 30) {
      c.fillStyle = 'rgba(255,255,255,.32)';
      for (let i = 0; i < 3; i++) {
        const a = -0.35 + i * 0.35;
        c.beginPath();
        c.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5 + r * 0.05, r * 0.08, 0, Math.PI * 2);
        c.fill();
      }
    }

    /* 2048 加顶小皇冠 */
    if (gold) {
      c.save();
      c.translate(0, -r * 0.92);
      c.beginPath();
      c.moveTo(-r * 0.34, r * 0.16);
      c.lineTo(-r * 0.20, -r * 0.10);
      c.lineTo(-r * 0.06, r * 0.06);
      c.lineTo(0, -r * 0.16);
      c.lineTo(r * 0.06, r * 0.06);
      c.lineTo(r * 0.20, -r * 0.10);
      c.lineTo(r * 0.34, r * 0.16);
      c.closePath();
      c.fillStyle = '#ffd23f';
      c.fill();
      c.lineWidth = Math.max(1, r * 0.045);
      c.strokeStyle = 'rgba(150,96,0,.55)';
      c.stroke();
      c.restore();
    }
  }

  function drawFrog(c, x, y, r, tier, angle, scale, squashShape) {
    const s = scale === undefined ? 1 : scale;

    c.save();
    c.translate(x, y);
    if (squashShape && squashShape.k > 0.004) {
      c.rotate(squashShape.a);
      c.scale(1 - squashShape.k, 1 + squashShape.k * 0.85);
      c.rotate(-squashShape.a);
    }
    if (s !== 1) c.scale(s, s);
    c.rotate(angle || 0);

    const img = FROGS[tier].img;
    if (img) {
      const box = (r * 2) / 0.92;    // 贴图主体占画布长边 92%，保证视觉大小 = 物理直径
      c.drawImage(img, -box / 2, -box / 2, box, box);
      c.restore();
      return;
    }

    drawCuteFrog(c, r, tier);
    c.restore();
  }

  /* 等级数字牌（永远水平，盖在奶蛙身上） */
  function drawBadge(c, x, y, r, v) {
    if (r < 12) return;
    const fs = clamp(r * 0.52, 9, 30);
    c.save();
    c.font = '800 ' + fs.toFixed(1) + 'px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const tw = c.measureText(String(v)).width;
    const bw = tw + fs * 0.72;
    const bh = fs * 1.42;
    const by = y + r * 0.44;

    roundRect(c, x - bw / 2, by - bh / 2, bw, bh, bh / 2);
    c.fillStyle = 'rgba(14,84,62,.92)';
    c.fill();
    c.lineWidth = Math.max(1, fs * 0.14);
    c.strokeStyle = 'rgba(255,255,255,.92)';
    c.stroke();

    c.fillStyle = '#ffffff';
    c.fillText(String(v), x, by + fs * 0.04);
    c.restore();
  }

  /* 池底装饰：只留一点点水泡和暗角，不加荷叶/水草这些会被误认成物件的东西 */
  function drawPondDecor() {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 10; i++) {
      const x = W * ((i * 0.618 + 0.07) % 1);
      const y = H * ((i * 0.377 + 0.13) % 1);
      const r = 3 + ((i * 13) % 4);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBoard() {
    /* 池塘水底 */
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#eefaf3');
    bg.addColorStop(0.55, '#d9f3e7');
    bg.addColorStop(1, '#bfe9d8');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    /* 水波 */
    const t = (performance.now() / 2600) % 1;
    ctx.save();
    ctx.strokeStyle = 'rgba(110,196,170,.30)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const k = (t + i / 3) % 1;
      ctx.globalAlpha = (1 - k) * 0.45;
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.5, 40 + k * W * 0.66, 30 + k * W * 0.40, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    /* 池底装饰 */
    drawPondDecor();

    /* 四周压一点暗角，方棋盘更立体 */
    const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34,
                                         W / 2, H / 2, Math.max(W, H) * 0.72);
    vig.addColorStop(0, 'rgba(40,110,86,0)');
    vig.addColorStop(1, 'rgba(28,88,68,.16)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    /* 重力那一侧的水压光晕：一眼看出现在往哪边掉 */
    if (state.dir) {
      const d = DIRS[state.dir];
      const gx0 = W / 2, gy0 = H / 2;
      const gx1 = W / 2 + d.x * W * 0.62, gy1 = H / 2 + d.y * H * 0.62;
      const grd = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      grd.addColorStop(0, 'rgba(96,205,160,0)');
      grd.addColorStop(1, 'rgba(56,170,130,.30)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
    }

    /* 池塘边 */
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(48,132,104,.45)';
    ctx.strokeRect(WALL - 1.5, WALL - 1.5, W - 2 * WALL + 3, H - 2 * WALL + 3);
    ctx.restore();

    /* 危险带虚线 */
    const line = dangerLine(state.dir);
    if (line) {
      const hot = state.danger;
      ctx.save();
      ctx.setLineDash([9, 9]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hot
        ? 'rgba(255,72,72,' + (0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 140))) + ')'
        : 'rgba(214,140,110,.42)';
      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(line.x2, line.y2);
      ctx.stroke();
      ctx.restore();
    } else {
      /* 还没开始滑：四条虚线都画淡一点，提示“哪个方向都行” */
      ctx.save();
      ctx.setLineDash([6, 10]);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(160,200,185,.5)';
      const yy = IN_Y0 + AX_Y * (1 - JAM_COV), xx = IN_X0 + AX_X * (1 - JAM_COV);
      const yy2 = IN_Y1 - AX_Y * (1 - JAM_COV), xx2 = IN_X1 - AX_X * (1 - JAM_COV);
      ctx.beginPath(); ctx.moveTo(IN_X0, yy); ctx.lineTo(IN_X1, yy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(IN_X0, yy2); ctx.lineTo(IN_X1, yy2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xx, IN_Y0); ctx.lineTo(xx, IN_Y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xx2, IN_Y0); ctx.lineTo(xx2, IN_Y1); ctx.stroke();
      ctx.restore();
    }
  }

  /* 角上的重力罗盘（只有真会被拒的时候才画成灰的 + 一圈虚环） */
  function drawCompass() {
    const cx = W - WALL - 54, cy = WALL + 54, R0 = 27;
    const locked = state.blocked;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R0, 0, Math.PI * 2);
    ctx.fillStyle = locked ? 'rgba(255,255,255,.66)' : 'rgba(255,255,255,.86)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = locked ? 'rgba(150,170,164,.5)' : 'rgba(48,150,116,.42)';
    ctx.stroke();

    if (locked) {
      /* 还没轮到下一轮：外面套一圈会转的虚线，提示“等” */
      ctx.save();
      ctx.setLineDash([4, 7]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(90,160,140,.75)';
      ctx.translate(cx, cy);
      ctx.rotate((performance.now() / 1400) * Math.PI * 2);
      ctx.beginPath();
      ctx.arc(0, 0, R0 + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (state.dir) {
      const d = DIRS[state.dir];
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(d.y, d.x));
      ctx.beginPath();
      ctx.moveTo(R0 * 0.62, 0);
      ctx.lineTo(-R0 * 0.30, -R0 * 0.44);
      ctx.lineTo(-R0 * 0.10, 0);
      ctx.lineTo(-R0 * 0.30, R0 * 0.44);
      ctx.closePath();
      ctx.fillStyle = locked ? '#a9bdb6' : '#1f8f6c';
      ctx.fill();
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 13px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      ctx.fillStyle = '#2a9b74';
      ctx.fillText('漂浮', cx, cy + 1);
    }
    ctx.restore();
  }

  /* 滑动被拒时飘一句“为什么” */
  function drawDenyToast(dt) {
    const a = state.denyFlash;
    if (a <= 0) return;
    state.denyFlash = Math.max(0, a - dt * 1.6);

    const p = 1 - state.denyFlash / 0.85;          // 0 → 1
    const alpha = state.denyFlash > 0.65 ? (0.85 - state.denyFlash) / 0.2 : Math.min(1, state.denyFlash / 0.35);
    const y = H * 0.30 + p * 14;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = '700 17px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(state.denyText).width;
    const bw = tw + 40, bh = 38;

    roundRect(ctx, W / 2 - bw / 2, y - bh / 2, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(28,92,72,.88)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(state.denyText, W / 2, y + 1);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  /* 下一批奶蛙的虚像：下落期间就摆在那儿，半透明 + 虚线环 + 淡淡的等级牌，
     一眼看出“这仨马上要出现在这里”。等整池静止，它们就地变成实体。 */
  function drawGhosts() {
    if (!state.ghost.length) return;
    const now = performance.now();

    for (let i = 0; i < state.ghost.length; i++) {
      const g = state.ghost[i];
      const r = FROGS[g.tier].r;
      const pulse = 0.5 + 0.5 * Math.sin(now / 420 + i * 1.1);
      /* 刚滑完那一下从 0 淡入，别“啪”地冒出来 */
      const inK = state.ghostAt ? Math.min(1, (now - state.ghostAt) / 260) : 1;

      ctx.save();
      ctx.globalAlpha = inK * (0.20 + 0.10 * pulse);
      drawFrog(ctx, g.x, g.y, r, g.tier, 0, 1, null);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = inK * (0.28 + 0.18 * pulse);
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3ba97f';
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.rb + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (state.showBadge) {
        ctx.save();
        ctx.globalAlpha = inK * (0.30 + 0.16 * pulse);
        drawBadge(ctx, g.x, g.y, r, FROGS[g.tier].v);
        ctx.restore();
      }
    }
  }

  function drawFrogs() {
    const now = performance.now();
    const sorted = state.balls.slice().sort((a, b) => a.r - b.r);

    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i];
      if (b.dead) continue;

      let scale = 1;
      if (b.popAt) {
        const k = (now - b.popAt) / 220;
        if (k < 1) scale = 1 + 0.28 * (1 - k);
        else b.popAt = 0;
      }

      /* 漂着的那只：上下轻轻浮一下 + 一圈虚光，一眼看出它还没受重力 */
      let y = b.y;
      if (b.float) {
        y += Math.sin(now / 520 + b.seed) * 3.2;
        ctx.save();
        ctx.globalAlpha = 0.32 + 0.18 * Math.sin(now / 520 + b.seed);
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#3ba97f';
        ctx.beginPath();
        ctx.arc(b.x, y, b.rb + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      const shape = b.sq > 0.004 ? { a: b.sqA, k: b.sq } : null;
      drawFrog(ctx, b.x, y, b.r, b.tier, b.angle, scale, shape);
      if (state.showBadge) drawBadge(ctx, b.x, y, b.r, b.v);
    }
  }

  /* 滑动时中间闪过的大箭头 */
  function drawArrowFlash(dt) {
    const a = state.arrow;
    if (!a) return;
    a.life -= dt * 2.4;
    if (a.life <= 0) { state.arrow = null; return; }

    const d = DIRS[a.dir];
    const p = 1 - a.life;
    const cx = W / 2, cy = H / 2;
    const len = 70 + p * 60;

    ctx.save();
    ctx.globalAlpha = Math.max(0, a.life) * 0.42;
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(d.y, d.x));
    ctx.beginPath();
    ctx.moveTo(len * 0.62, 0);
    ctx.lineTo(-len * 0.34, -len * 0.30);
    ctx.lineTo(-len * 0.12, 0);
    ctx.lineTo(-len * 0.34, len * 0.30);
    ctx.closePath();
    ctx.fillStyle = '#2fa87d';
    ctx.fill();
    ctx.restore();
  }

  function drawEffects(dt) {
    /* 粒子 */
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      if (state.dir) { p.vx += DIRS[state.dir].x * 900 * dt; p.vy += DIRS[state.dir].y * 900 * dt; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.99;
      p.life -= p.decay * dt;
      if (p.life <= 0) { state.particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life) * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* 飘字 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = state.floats.length - 1; i >= 0; i--) {
      const f = state.floats[i];
      f.y -= 46 * dt;
      f.life -= dt * 1.05;
      if (f.life <= 0) { state.floats.splice(i, 1); continue; }
      const size = f.big ? 40 : 20;
      ctx.font = '800 ' + size + 'px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      ctx.globalAlpha = Math.min(1, f.life * 1.4);
      ctx.lineWidth = f.big ? 7 : 4;
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = '#f4623a';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  /* 面板里的「下一个」：一次要出的那几只一起显示 */
  function drawNext() {
    const w = nextCanvas.width;
    const h = nextCanvas.height;
    nextCtx.setTransform(1, 0, 0, 1, 0, 0);
    nextCtx.clearRect(0, 0, w, h);

    const list = state.nextBatch.length ? state.nextBatch : [0];
    const slot = w / list.length;
    const cy = h * 0.46;
    const radius = Math.min(slot * 0.40, h * 0.34);

    for (let i = 0; i < list.length; i++) {
      const tier = list[i];
      const r = FROGS[tier].r;
      const k = radius / r;
      const x = slot * (i + 0.5);
      drawFrog(nextCtx, x, cy, r * k, tier, 0, 1);
      drawBadge(nextCtx, x, cy, r * k, FROGS[tier].v);
    }
  }

  /* 面板里的「合成表」：两行排开，每只下面写清数值 */
  function drawChain() {
    const cw = chainCanvas.width;
    const ch = chainCanvas.height;
    chainCtx.setTransform(1, 0, 0, 1, 0, 0);
    chainCtx.clearRect(0, 0, cw, ch);

    const perRow = 6;
    const rows = Math.ceil(FROGS.length / perRow);
    const cellW = cw / perRow;
    const cellH = ch / rows;

    for (let i = 0; i < FROGS.length; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, FROGS.length - row * perRow);
      const offset = (cw - inRow * cellW) / 2;
      const x = offset + cellW * (col + 0.5);
      const cy = cellH * row + cellH * 0.38;
      const r = Math.min(cellW, cellH) * 0.30;

      drawFrog(chainCtx, x, cy, r, i, 0, 1);
      chainCtx.save();
      chainCtx.font = '800 ' + Math.round(cellH * 0.19) + 'px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      chainCtx.textAlign = 'center';
      chainCtx.textBaseline = 'middle';
      chainCtx.fillStyle = '#2a6b56';
      chainCtx.fillText(String(FROGS[i].v), x, cellH * row + cellH * 0.82);
      chainCtx.restore();
    }
  }

  /* ---------------------------------------------------------
   *  主循环
   * ------------------------------------------------------- */

  let last = performance.now();
  let acc = 0;
  const FIXED = 1 / 60;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;

    let guard = 0;
    while (acc >= FIXED && guard < 5) {
      update(FIXED);
      acc -= FIXED;
      guard++;
    }
    if (guard >= 5) acc = 0;

    render(dt);
    requestAnimationFrame(frame);
  }

  let jamPaint = 0;

  /* 把「一帧该算的东西」单独拆出来：主循环用它推进，快进也用它推进 ——
     同一套代码，所以快进出来的结果和真等下去完全一样（只是瞬间算完）。 */
  function simulate(dt) {
    if (state.over) return;

    if (state.swipeCd > 0) state.swipeCd = Math.max(0, state.swipeCd - dt);

    const sub = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) stepPhysics(sub);

    /* “整池停下来了”是个带迟滞的状态：
       连续静止 SETTLE_HOLD 秒才算停下；停下之后要连续动 SETTLE_WAKE 秒才算又开始动。
       少了这道迟滞，PBD 堆叠时那种“一帧 40px/s、一帧 30px/s”的微抖会让判定反复横跳，
       结果就是永远等不到“静止”，玩家被锁死。 */
    const insta = allSettled();
    if (insta) {
      state.settleTimer += dt;
      state.moveTime = 0;
    } else {
      state.moveTime += dt;
      state.settleTimer = 0;
    }

    if (!state.rest) {
      if (state.settleTimer >= SETTLE_HOLD) state.rest = true;
    } else if (state.moveTime >= SETTLE_WAKE) {
      state.rest = false;
    }

    if (state.rest) state.unrestTimer = 0;
    else state.unrestTimer += dt;

    /* 结算：静止了就出；实在静不下来就超时放行（每隔一小会儿才放一次，别刷屏） */
    const giveUp = state.unrestTimer >= SPAWN_TIMEOUT;
    if (state.owed > 0) {
      state.owedTimer += dt;
      if (state.rest || (giveUp && state.owedTimer >= 1.5)) deliverSpawn();
    } else {
      state.owedTimer = 0;
    }

    /* 什么时候才允许做下一轮选择：
       ① 上一滑欠的那批新奶蛙已经出现了；② 整池停下来了（或已经超时放行，绝不软锁） */
    state.locked = state.owed > 0 || (!state.rest && !giveUp);
    /* 连按不会被拒（按下就先快进到静止），所以「变淡 / 等一等」这套视觉只在
       真会拒的那一种情况下出现：池子卡住、欠账都顶到 MAX_OWED 了 */
    state.blocked = state.locked && state.owed >= MAX_OWED;

    checkJam(dt);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.2);
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 3.4);
    if (state.warp > 0) state.warp = Math.max(0, state.warp - dt * 3.2);
  }

  /* 快进到「整池完全静止 + 欠的那批已经出现」，返回推进了多少步（0 = 本来就静止）。
     上限 FASTFWD_MAX_SEC 秒：真卡住了就交给 SPAWN_TIMEOUT 那条超时放行的老路。 */
  function fastForwardToRest() {
    const STEP = 1 / 60;
    const MAX = Math.ceil(FASTFWD_MAX_SEC / STEP);
    let n = 0;
    while (n < MAX && !state.over) {
      if (state.rest && state.owed === 0) break;
      simulate(STEP);
      n++;
    }
    state.ffSteps = n;
    state.ffSettled = !!(state.rest && state.owed === 0);
    return n;
  }

  function update(dt) {
    simulate(dt);

    /* 面板上的拥挤度不用每帧刷 DOM */
    jamPaint -= dt;
    if (jamPaint <= 0) { jamPaint = 0.12; paintJam(); paintGravity(); paintNextTip(); paintFoot(); }
  }

  /* 快进特效：一圈从中心往外冲的短划线，让人一眼看出“时间被压过去了”，
     而不是以为奶蛙瞬移了 */
  function drawWarp() {
    const a = state.warp;
    if (a <= 0) return;
    const k = 1 - a;                        // 0 → 1
    ctx.save();
    ctx.globalAlpha = a * 0.55;
    ctx.strokeStyle = 'rgba(47,168,125,.9)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + k * 0.9;
      const r0 = 70 + k * 90;
      const r1 = r0 + 60 + k * 150;
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(ang) * r0, H / 2 + Math.sin(ang) * r0);
      ctx.lineTo(W / 2 + Math.cos(ang) * r1, H / 2 + Math.sin(ang) * r1);
      ctx.stroke();
    }
    ctx.globalAlpha = a * 0.22;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 60 + k * 200, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function render(dt) {
    ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (state.shake > 0) {
      const k = state.shake * 4;
      ctx.translate(rand(-k, k), rand(-k, k));
    }

    drawBoard();
    drawGhosts();
    drawFrogs();
    drawWarp();
    drawArrowFlash(dt);
    drawEffects(dt);
    drawCompass();
    drawDenyToast(dt);

    if (state.flash > 0) {
      ctx.save();
      ctx.globalAlpha = state.flash * 0.32;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------
   *  输入：滑动 / 方向键
   * ------------------------------------------------------- */

  let drag = null;

  function dirFromDelta(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  stage.addEventListener('pointerdown', (e) => {
    if (state.over) return;
    Sound.ensure();
    drag = { x0: e.clientX, y0: e.clientY };
    if (stage.setPointerCapture) {
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!drag || state.over) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (hypot2(dx, dy) < SWIPE_MIN) return;
    drag = null;                        // 一次手势只触发一次
    if (state.swipeCd > 0) return;      // 两次手势之间留一点冷却，防手抖连甩
    applySwipe(dirFromDelta(dx, dy));
  });

  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('pointercancel', () => { drag = null; });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  /* 输入框里打字时不抢按键 */
  function isTyping(e) {
    const t = e.target;
    if (!t) return false;
    const tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || t.isContentEditable === true;
  }

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;

    const code = e.code;
    if (code === 'ArrowUp' || code === 'KeyW')         { applySwipe('up');    e.preventDefault(); }
    else if (code === 'ArrowDown' || code === 'KeyS')  { applySwipe('down');  e.preventDefault(); }
    else if (code === 'ArrowLeft' || code === 'KeyA')  { applySwipe('left');  e.preventDefault(); }
    else if (code === 'ArrowRight' || code === 'KeyD') { applySwipe('right'); e.preventDefault(); }
    else if (code === 'Space' || code === 'Enter')     { if (!state.over) e.preventDefault(); }
    else if (code === 'KeyR')                          { reset(); e.preventDefault(); }
  });

  soundBtn.addEventListener('click', () => {
    Sound.muted = !Sound.muted;
    localStorage.setItem(MUTE_KEY, Sound.muted ? '1' : '0');
    paintSoundBtn();
    if (!Sound.muted) Sound.merge(1);
  });

  resetBtn.addEventListener('click', reset);
  restartBtn.addEventListener('click', reset);

  /* 面板上的四个方向键（手机竖屏时就是分数栏下面那一排）：
     点一下等于滑一下，同样受“整池停下来才能滑”的限制 */
  DIR_KEYS.forEach(function (k) {
    const el = chips[k];
    if (!el) return;
    el.addEventListener('click', function () {
      Sound.ensure();
      applySwipe(k);
      paintGravity();
    });
  });

  /* ---------------------------------------------------------
   *  素材加载（缺图自动回退成程序化奶蛙，不影响游玩）
   * ------------------------------------------------------- */

  function loadSprites() {
    let left = 0;
    for (let i = 0; i < FROGS.length; i++) {
      const f = FROGS[i];
      if (!f.file) continue;
      left++;
      const img = new Image();
      img.onload = () => {
        const ready = () => {
          f.img = img;
          left--;
          if (left === 0) { drawNext(); drawChain(); }
        };
        if (img.decode) img.decode().then(ready, ready);
        else ready();
      };
      img.onerror = () => {
        left--;
        if (window.console) console.warn('[naiwa] 贴图载入失败，已回退为程序化奶蛙：' + f.file);
      };
      img.src = f.file;
    }
    return left;
  }

  /* ---------------------------------------------------------
   *  启动
   * ------------------------------------------------------- */

  function boot() {
    resizeCanvas();
    if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(stage);
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));

    paintSoundBtn();
    drawChain();
    reset();
    loadSprites();
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* 调试句柄：__NW__.state / .reset() / .applySwipe('up') / .FROGS / .spawnFrog(3) */
  window.__NW__ = {
    state, reset, applySwipe, stepPhysics, makeBall, spawnFrog, dealInitial,
    simulate, fastForwardToRest, previewSpawn, INSTANT_INPUT, FASTFWD_MAX_SEC,
    Sound,                        // 宣传片录制页会把它静音，免得游戏音效和震动混进来
    FROGS, DIRS, coverageOf, coverageAll, checkJam, W, H, WALL,
    INIT_FROGS, MAX_TIER, MAX_BONUS, JAM_COV, JAM_LIMIT, FRICTION, CONTACT_PAD,
    DAMPING, AIR_DAMP, SETTLE_SPEED, SETTLE_HOLD, SPAWN_TIMEOUT, MAX_OWED, SPAWN_PER_TURN, MAX_FROGS,
    render, resizeCanvas, shapeOf, clampInside,
    update, gameOver, pickSpawnTier, findSpot, setGravity, dangerLine,
    allSettled, deliverSpawn
  };
})();
