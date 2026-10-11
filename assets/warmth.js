/* ==========================================================================
   Cursor-Light-Warmth — 全站公共脚本

   包含：
     · 主题（浅色 / 深色 / 跟随系统）
     · 移动端导航抽屉
     · 入场动画（IntersectionObserver）
     · Toast
     · 平台检测与链接抽取
     · 事件委托注册表 —— 替代 inline onclick
       （CSP 的 script-src 不覆盖 inline 事件属性，所有交互必须走委托）
   ========================================================================== */
(function () {
  'use strict';

  /* ==========================================================
     平台元数据与工具函数
     ========================================================== */
  var PLATFORMS = [
    { n: '抖音',     i: '🎵', d: ['douyin.com', 'iesdouyin.com'] },
    { n: '快手',     i: '🎬', d: ['kuaishou.com', 'chenzhongtech.com'] },
    { n: '小红书',   i: '📕', d: ['xiaohongshu.com'] },
    { n: '微博',     i: '📱', d: ['weibo.com', 'weibo.cn'] },
    { n: 'TikTok',   i: '🎵', d: ['tiktok.com'] },
    { n: 'YouTube',  i: '▶️', d: ['youtube.com', 'youtu.be'] },
    { n: '西瓜视频', i: '🍉', d: ['ixigua.com'] },
    { n: '好看视频', i: '🎥', d: ['haokan.baidu.com', 'hao123.com'] },
    { n: '知乎',     i: '💡', d: ['zhihu.com'] },
    { n: '皮皮虾',   i: '🦐', d: ['pipix.com'] },
    { n: '全民K歌',  i: '🎤', d: ['kg.qq.com'] },
    { n: 'AcFun',    i: '🔴', d: ['acfun.cn'] }
  ];
  var ALL_DOMAINS = PLATFORMS.reduce(function (a, p) { return a.concat(p.d); }, []);

  window.Warmth = {
    PLATFORMS: PLATFORMS,
    ALL_DOMAINS: ALL_DOMAINS,

    /** 从文本中检测平台 */
    detect: function (text) {
      if (!text) return null;
      for (var i = 0; i < PLATFORMS.length; i++) {
        var p = PLATFORMS[i];
        for (var j = 0; j < p.d.length; j++) {
          if (text.indexOf(p.d[j]) !== -1) return p;
        }
      }
      return null;
    },

    /** 从分享文本中提取链接 */
    extract: function (raw) {
      if (!raw) return '';
      var urls = raw.match(/https?:\/\/[^\s"'<>，、'》【】\[\]{}|]+/gi);
      if (!urls) {
        var ds = raw.match(/v\.douyin\.com\/\w+/i);
        if (ds) return 'https://' + ds[0];
        var ks = raw.match(/v\.kuaishou\.com\/\w+/i);
        if (ks) return 'https://' + ks[0];
        return String(raw).trim();
      }
      for (var i = 0; i < urls.length; i++) {
        var c = urls[i].replace(/["'<>，、》】]+$/, '').trim();
        if (c.indexOf('http') !== 0) continue;
        for (var j = 0; j < ALL_DOMAINS.length; j++) {
          if (c.indexOf(ALL_DOMAINS[j]) !== -1) return c;
        }
      }
      return urls[0].replace(/["'<>，、》】]+$/, '').trim();
    },

    /** HTML 转义 */
    esc: function (s) {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /** 时间戳文件名前缀 */
    stamp: function () {
      var d = new Date();
      return d.getFullYear()
        + String(d.getMonth() + 1).padStart(2, '0')
        + String(d.getDate()).padStart(2, '0') + '_' + d.getTime();
    },

    /** Toast 提示 */
    toast: function (msg, ms) {
      var el = document.getElementById('toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(el._timer);
      el._timer = setTimeout(function () { el.classList.remove('show'); }, ms || 2400);
    },

    /* ==========================================================
       事件委托
       ----------------------------------------------------------
       用法：Warmth.on('action-name', handler)
            页面元素写 <button data-action="action-name">
       handler 接收 (element, event)
       ========================================================== */
    _actions: {},
    on: function (name, handler) {
      this._actions[name] = handler;
    }
  };

  // 单一委托监听器
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var fn = window.Warmth._actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'BUTTON' || el.getAttribute('href') === null) e.preventDefault();
    fn(el, e);
  });

  /* ==========================================================
     主题
     ========================================================== */
  var THEME_KEY = 'warmth-theme';   // 'light' | 'dark' | 'system'

  function systemPrefersDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(mode) {
    var dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
    document.body.classList.toggle('is-dark', dark);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0a0a0f' : '#f4f5f9');

    document.querySelectorAll('[data-set-theme]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.setTheme === mode));
    });
  }

  var savedTheme = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(savedTheme);

  window.Warmth.setTheme = function (mode) {
    localStorage.setItem(THEME_KEY, mode);
    applyTheme(mode);
  };

  // 跟随系统时，系统切换需实时响应
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if ((localStorage.getItem(THEME_KEY) || 'light') === 'system') applyTheme('system');
  });

  window.Warmth.on('set-theme', function (el) {
    window.Warmth.setTheme(el.dataset.setTheme);
  });

  /* ==========================================================
     移动端导航抽屉
     ========================================================== */
  window.Warmth.on('toggle-nav', function () {
    var nav = document.getElementById('mobileNav');
    var btn = document.getElementById('navToggle');
    if (!nav) return;
    var open = nav.classList.toggle('is-open');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  });

  // 抽屉内点击链接后关闭
  document.addEventListener('click', function (e) {
    var link = e.target.closest('.mobile-nav a');
    if (!link) return;
    var nav = document.getElementById('mobileNav');
    if (nav) nav.classList.remove('is-open');
    document.body.style.overflow = '';
  });

  /* ==========================================================
     入场动画
     ========================================================== */
  function setupReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    if (!('IntersectionObserver' in window)
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ==========================================================
     模态框：点击遮罩 / Esc 关闭
     ========================================================== */
  document.addEventListener('click', function (e) {
    if (e.target.classList && e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('active');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay.active').forEach(function (el) {
      el.classList.remove('active');
    });
    var nav = document.getElementById('mobileNav');
    if (nav && nav.classList.contains('is-open')) {
      nav.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  });

  /* ==========================================================
     初始化
     ========================================================== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupReveal);
  } else {
    setupReveal();
  }
})();
