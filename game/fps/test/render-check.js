/* 真实浏览器渲染验证：打开生成的单文件页面，等渲染完成，检查
   ① 无 JS 报错 ② canvas 真的画出了东西 ③ 画面里人形占比合理
   并输出像素统计 + PNG 截图。 */
const { chromium } = require('/tmp/node_modules/playwright-core');
const path = require('path');
const fs = require('fs');

const FILE = '/root/nnnnlll/game/fps/test/character-v1.0-standalone.html';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1248/chrome-linux-arm64/chrome',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox',
      '--disable-gpu-sandbox',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-features=Vulkan,DBus',
      '--disable-background-networking', '--no-first-run'
    ]
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 800 }, deviceScaleFactor: 1 });

  const errors = [], logs = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); else logs.push(m.text()); });

  await page.goto('file://' + FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);   // 等渲染稳定

  // 页面自身错误框
  const errText = await page.evaluate(() => {
    const e = document.getElementById('err');
    return e && e.style.display !== 'none' ? e.textContent : '';
  });

  // 渲染统计
  const info = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return { canvas: false };
    const g = document.createElement('canvas');
    g.width = c.width; g.height = c.height;
    const ctx = g.getContext('2d');
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, g.width, g.height).data;
    const colors = new Map();
    let nonBg = 0, total = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {   // 抽样
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      total++;
      const key = (r >> 4) + ',' + (gg >> 4) + ',' + (b >> 4);
      colors.set(key, (colors.get(key) || 0) + 1);
      // 背景色 0x87b6d9 ≈ (135,182,217)
      if (Math.abs(r - 135) > 26 || Math.abs(gg - 182) > 26 || Math.abs(b - 217) > 26) nonBg++;
    }
    const sorted = [...colors.entries()].sort((a, b) => b[1] - a[1]);
    return {
      canvas: true, w: c.width, h: c.height, total,
      nonBgRatio: nonBg / total,
      distinctColors: colors.size,
      topColors: sorted.slice(0, 6).map(([k, v]) => k + '×' + v),
      tri: document.getElementById('tri').textContent,
      fps: document.getElementById('fps').textContent,
      anim: document.getElementById('anim').textContent
    };
  });

  await page.screenshot({ path: '/tmp/render-idle.png' });

  // 逐个动作截图
  for (const a of ['walk', 'attack', 'dead']) {
    await page.click(`#bar button[data-a="${a}"]`);
    await page.waitForTimeout(a === 'dead' ? 1200 : 700);
    await page.screenshot({ path: `/tmp/render-${a}.png` });
  }
  await page.click('#bar button[data-a="idle"]');

  // 三种姿态下角色在画面里的纵向范围（判断是否真的画出了人形）
  const spans = await page.evaluate(async () => {
    const s = window.__soldier;
    const THREE = window.THREE;
    const out = {};
    for (const st of ['idle', 'walk', 'attack', 'dead']) {
      s.setState(st);
      for (let i = 0; i < 30; i++) s.update(1 / 30);
      s.group.updateMatrixWorld(true);
      const box = new THREE.Box3(), tmp = new THREE.Box3();
      s.group.traverse(o => { if (o.isMesh) { o.updateMatrixWorld(true); tmp.setFromObject(o); box.union(tmp); } });
      out[st] = { minY: +box.min.y.toFixed(3), maxY: +box.max.y.toFixed(3) };
    }
    return out;
  });

  console.log('页面错误框: ' + (errText ? '❌ ' + errText : '✅ 无'));
  console.log('JS 报错: ' + (errors.length ? '❌ ' + errors.join(' | ') : '✅ 无'));
  console.log('canvas: ' + (info.canvas ? '✅ ' + info.w + '×' + info.h : '❌ 未创建'));
  if (info.canvas) {
    const ok = info.nonBgRatio > 0.03 && info.distinctColors > 20;
    console.log((ok ? '✅' : '❌') + ' 画面有实际内容  非背景像素 ' + (info.nonBgRatio * 100).toFixed(1) + '%  颜色数 ' + info.distinctColors);
    console.log('   主色: ' + info.topColors.join(' '));
    console.log('   HUD: 三角面=' + info.tri + ' 动画=' + info.anim + ' 帧率=' + info.fps);
  }
  console.log('\n四种姿态包围盒:');
  for (const k in spans) {
    const v = spans[k];
    console.log('  ' + k.padEnd(7) + ' y ' + v.minY + ' ~ ' + v.maxY +
      '  高度 ' + (v.maxY - v.minY).toFixed(2) + 'm' +
      (Math.abs(v.minY) < 0.05 ? '  贴地✅' : '  离地❌'));
  }
  console.log('\n截图: /tmp/render-idle.png /tmp/render-walk.png /tmp/render-attack.png /tmp/render-dead.png');
  for (const f of ['idle', 'walk', 'attack', 'dead']) {
    const p = '/tmp/render-' + f + '.png';
    console.log('  ' + p + '  ' + (fs.existsSync(p) ? (fs.statSync(p).size / 1024).toFixed(0) + ' KB' : '缺失'));
  }

  await browser.close();
  if (errors.length || !info.canvas || info.nonBgRatio <= 0.03) process.exit(1);
  console.log('\n真实渲染验证通过 ✅');
})().catch(e => { console.error('失败:', e.message); process.exit(1); });