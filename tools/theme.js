/* 工具页共用的主题按钮：读写 localStorage 里的 lzh.theme（和首页同一个开关）
   页面里只需要放一个 <button id="themeBtn" class="back ghost">🌙</button> */
(function () {
  var KEY = 'lzh.theme';
  function meta(dark) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#10141c' : '#f8fafd');
  }
  function isDark() { return document.body.classList.contains('dark'); }
  function apply(dark) {
    document.body.classList.toggle('dark', dark);
    meta(dark);
    var b = document.getElementById('themeBtn');
    if (b) {
      b.textContent = dark ? '☀️' : '🌙';
      b.title = dark ? '切换成浅色' : '切换成深色';
    }
  }
  // 进页面先按保存的偏好（没有就默认深色，与首页一致）
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved ? saved === 'dark' : true);

  // 按钮在页面里可能还没解析到（本脚本放在 <body> 开头，为了不闪白），所以等 DOM
  function wire() {
    var b = document.getElementById('themeBtn');
    if (!b) return;
    b.textContent = isDark() ? '☀️' : '🌙';
    b.title = isDark() ? '切换成浅色' : '切换成深色';
    b.addEventListener('click', function () {
      var dark = !isDark();
      try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch (e) {}
      apply(dark);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();