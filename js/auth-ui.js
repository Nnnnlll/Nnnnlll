/* js/auth-ui.js —— 登录/注册弹层 + 顶栏账号按钮（依赖 js/api.js 的 window.NNN）
 * 样式复用主页的 .glass 风格；面板注入到 body 末尾，避免影响现有布局。
 */
(function () {
  'use strict';
  if (!window.NNN) return;

  var css = ''
    + '#nnnAcct{font-size:18px;line-height:1}'
    + '#nnnAuthMask{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;'
    + 'background:rgba(10,20,40,.28);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:18px}'
    + '#nnnAuthMask.open{display:flex}'
    + '#nnnAuthBox{width:min(360px,100%);background:var(--glass-bg-strong,rgba(255,255,255,.95));'
    + 'border:1px solid var(--glass-line,rgba(255,255,255,.9));border-radius:20px;padding:22px 20px 18px;'
    + 'box-shadow:0 20px 50px rgba(20,40,90,.18);color:var(--ink,#1b2a3f);font-size:14px}'
    + '#nnnAuthBox h3{margin:0 0 14px;font-size:17px;font-weight:600;text-align:center}'
    + '#nnnAuthBox input{width:100%;padding:11px 12px;margin-bottom:10px;border-radius:12px;'
    + 'border:1px solid rgba(120,150,200,.35);background:rgba(255,255,255,.7);color:inherit;font-size:14px;outline:none}'
    + '#nnnAuthBox input:focus{border-color:var(--accent,#3b7cff)}'
    + '#nnnAuthBox button{width:100%;padding:11px;border:0;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;'
    + 'background:var(--accent,#3b7cff);color:#fff;transition:transform .15s}'
    + '#nnnAuthBox button:active{transform:scale(.97)}'
    + '#nnnAuthBox .nnn-switch{margin-top:12px;text-align:center;font-size:13px;color:var(--ink-soft,#5f6f8a);cursor:pointer}'
    + '#nnnAuthBox .nnn-msg{min-height:18px;margin-top:9px;font-size:13px;text-align:center;color:#d9484b}'
    + '#nnnAuthBox .nnn-user-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}'
    + '#nnnAuthBox .nnn-uavatar{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;'
    + 'background:linear-gradient(135deg,#3b7cff,#8c64dc);color:#fff;font-weight:700;font-size:16px}'
    + '#nnnAuthBox .nnn-badge{padding:3px 9px;border-radius:999px;background:rgba(59,124,255,.12);color:var(--accent,#3b7cff);font-size:12px}'
    + '#nnnAuthBox .nnn-close{float:right;cursor:pointer;opacity:.5;font-size:18px;line-height:1}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var mask = document.createElement('div');
  mask.id = 'nnnAuthMask';
  mask.innerHTML = '<div id="nnnAuthBox"></div>';
  document.body.appendChild(mask);

  var box = mask.querySelector('#nnnAuthBox');
  var mode = 'login'; // login | register | profile

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&' + 'quot;' }[c];
    });
  }

  function render() {
    if (mode === 'profile') return renderProfile();
    var isReg = mode === 'register';
    box.innerHTML = ''
      + '<span class="nnn-close" data-act="close">×</span>'
      + '<h3>' + (isReg ? '注册账号' : '登录') + '</h3>'
      + '<input id="nnnU" type="text" placeholder="用户名" autocomplete="username" maxlength="20">'
      + '<input id="nnnP" type="password" placeholder="密码" autocomplete="current-password" maxlength="64">'
      + '<button data-act="submit">' + (isReg ? '注册并登录' : '登录') + '</button>'
      + '<div class="nnn-msg" id="nnnMsg"></div>'
      + '<div class="nnn-switch" data-act="toggle">' + (isReg ? '已有账号？去登录' : '没有账号？去注册') + '</div>';
  }

  function renderProfile() {
    var u = NNN.auth.user;
    if (!u) { mode = 'login'; return render(); }
    var initial = (u.username || '?').slice(0, 1).toUpperCase();
    box.innerHTML = ''
      + '<span class="nnn-close" data-act="close">×</span>'
      + '<div class="nnn-user-row">'
      + '  <div style="display:flex;align-items:center;gap:11px">'
      + '    <div class="nnn-uavatar">' + esc(initial) + '</div>'
      + '    <div><div style="font-weight:600">' + esc(u.username) + '</div>'
      + '    <div class="nnn-badge">已登录</div></div>'
      + '  </div>'
      + '</div>'
      + '<div id="nnnMyScores" style="font-size:13px;color:var(--ink-soft,#5f6f8a);margin-bottom:14px">加载成绩…</div>'
      + '<button data-act="logout" style="background:rgba(217,72,75,.92)">退出登录</button>';

    NNN.scores.me().then(function (d) {
      var el = document.getElementById('nnnMyScores');
      if (!el) return;
      var games = (d && d.games) || [];
      if (!games.length) { el.textContent = '还没有成绩记录'; return; }
      el.innerHTML = games.map(function (g) {
        return '<div style="display:flex;justify-content:space-between;padding:3px 0">'
          + '<span>' + esc(g.game) + '</span><b>' + g.best + '</b></div>';
      }).join('');
    }).catch(function () {
      var el = document.getElementById('nnnMyScores');
      if (el) el.textContent = '成绩加载失败';
    });
  }

  function msg(t) {
    var el = document.getElementById('nnnMsg');
    if (el) el.textContent = t || '';
  }

  function submit() {
    var u = (document.getElementById('nnnU') || {}).value || '';
    var p = (document.getElementById('nnnP') || {}).value || '';
    u = u.trim();
    if (!u || !p) { msg('请输入用户名和密码'); return; }
    msg('');
    var btn = box.querySelector('[data-act="submit"]');
    if (btn) btn.disabled = true;
    var fn = mode === 'register' ? NNN.auth.register : NNN.auth.login;
    fn.call(NNN.auth, u, p).then(function () {
      mode = 'profile'; render(); updateBadge();
    }).catch(function (e) {
      msg(e.message || '操作失败');
      if (btn) btn.disabled = false;
    });
  }

  var badge = document.createElement('button');
  badge.id = 'nnnAcctBtn';
  badge.className = 'glass-btn';
  badge.title = '账号';
  badge.innerHTML = '<span id="nnnAcct">👤</span>';

  function updateBadge() {
    var u = NNN.auth.user;
    var el = document.getElementById('nnnAcct');
    if (el) el.textContent = u ? u.username.slice(0, 2) : '👤';
    badge.title = u ? ('已登录：' + u.username) : '登录 / 注册';
  }

  function mountButton() {
    var right = document.querySelector('.hero-right');
    if (right && !document.getElementById('nnnAcctBtn')) {
      var setting = document.getElementById('settingBtn');
      if (setting) right.insertBefore(badge, setting);
      else right.appendChild(badge);
    }
  }

  badge.onclick = function () {
    NNN.auth.me().then(function (u) { mode = u ? 'profile' : 'login'; render(); });
    mask.classList.add('open');
  };
  mask.onclick = function (e) {
    var t = e.target;
    if (t === mask) { mask.classList.remove('open'); return; }
    var act = t.getAttribute && t.getAttribute('data-act');
    if (!act) return;
    if (act === 'close') mask.classList.remove('open');
    else if (act === 'toggle') { mode = mode === 'register' ? 'login' : 'register'; render(); }
    else if (act === 'submit') submit();
    else if (act === 'logout') {
      NNN.auth.logout().then(function () { mode = 'login'; render(); updateBadge(); });
    }
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') mask.classList.remove('open');
  });

  function boot() {
    mountButton();
    NNN.auth.me().then(updateBadge).catch(function () { updateBadge(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();