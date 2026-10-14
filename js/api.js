/* js/api.js —— nnnnlll 前端 SDK（零依赖，挂到 window.NNN）
 * 用法：
 *   NNN.auth.register('user','pass')   NNN.auth.login(...)   NNN.auth.logout()
 *   NNN.auth.me()                      当前用户（缓存）
 *   NNN.scores.submit('fps', 120, {kills:5})
 *   NNN.scores.top('fps', 20)          NNN.scores.me('fps')
 *   NNN.ai.ask('写个标题')
 */
(function (global) {
  'use strict';

  var BASE = ''; // 同域；跨域部署时改成 'https://你的域名'

  function req(method, path, body) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    };
    if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
    return fetch(BASE + path, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: { code: 'BAD_RESPONSE', message: 'HTTP ' + r.status } }; });
    });
  }

  function unwrap(p) {
    return p.then(function (j) {
      if (j && j.ok) return j.data;
      var e = new Error((j && j.error && j.error.message) || '请求失败');
      e.code = j && j.error && j.error.code;
      e.status = j;
      throw e;
    });
  }

  var cachedUser = null;
  var resolved = false;

  var auth = {
    register: function (username, password) {
      return unwrap(req('POST', '/api/auth/register', { username: username, password: password }))
        .then(function (d) { cachedUser = d.user; resolved = true; return d; });
    },
    login: function (username, password) {
      return unwrap(req('POST', '/api/auth/login', { username: username, password: password }))
        .then(function (d) { cachedUser = d.user; resolved = true; return d; });
    },
    logout: function () {
      return unwrap(req('POST', '/api/auth/logout', {}))
        .then(function (d) { cachedUser = null; resolved = true; return d; });
    },
    me: function (force) {
      if (resolved && !force) return Promise.resolve(cachedUser);
      return unwrap(req('GET', '/api/auth/me')).then(function (d) {
        cachedUser = d.user; resolved = true; return cachedUser;
      });
    },
    get user() { return cachedUser; },
  };

  var scores = {
    submit: function (game, score, meta) {
      return unwrap(req('POST', '/api/scores/submit', { game: game, score: score, meta: meta }));
    },
    top: function (game, limit) {
      var q = '?game=' + encodeURIComponent(game) + (limit ? '&limit=' + limit : '');
      return unwrap(req('GET', '/api/scores/top' + q));
    },
    me: function (game) {
      var q = game ? '?game=' + encodeURIComponent(game) : '';
      return unwrap(req('GET', '/api/scores/me' + q));
    },
  };

  var ai = {
    ask: function (prompt) {
      return unwrap(req('POST', '/api/tools/ai', { prompt: prompt }));
    },
  };

  var tools = {
    ping: function () { return unwrap(req('GET', '/api/tools/ping')); },
  };

  global.NNN = { auth: auth, scores: scores, ai: ai, tools: tools, base: BASE };
})(window);
