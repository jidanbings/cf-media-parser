/* ==========================================================================
   平台解析页 — 共享前端逻辑
   被 douyin.html / kuaishou.html / bilibili.html 复用

   页面通过 window.PLATFORM_CONFIG 注入平台差异：
     { name, icon, accent, match: [域名] }

   下载方式：
     · 不打包 ZIP
     · 图片 → 网格展示 + 灯箱放大 + 一键复制直链
     · 视频 → 内联播放 + 复制直链 + 单文件下载
     · 提供「复制全部链接」与「复制 JSON」批量导出
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.PLATFORM_CONFIG || {};
  var W = window.Warmth;
  var id = function (s) { return document.getElementById(s); };

  /* ---------- 元素 ---------- */
  var urlInput = id('urlInput');
  var parseBtn = id('parseBtn');
  var loading = id('loading');
  var loadLabel = id('loadLabel');
  var errorBox = id('error');
  var errorDetail = id('errorDetail');
  var resultEl = id('result');
  var detectBadge = id('detectBadge');
  var clearBtn = document.querySelector('.clear-btn');

  /* ---------- 状态 ---------- */
  var curData = null;
  var lightboxIndex = -1;
  var lightboxItems = [];

  /* ---------- 工具 ---------- */
  function esc(s) { return W.esc(s); }

  function mediaUrl(u, filename, mode) {
    if (!u) return '';
    if (String(u).indexOf('/api/') === 0) return u;
    var s = '/api/media?url=' + encodeURIComponent(u)
      + '&filename=' + encodeURIComponent(filename || 'media.mp4');
    if (mode) s += '&mode=' + mode;
    return s;
  }

  /**
   * 图片 URL 策略：直连优先，失败回退代理
   *
   * 默认直接返回 CDN 原链（referrerpolicy="no-referrer"），完全不经 Worker；
   * 仅当直连失败（img onerror 触发）时，才回退到 Worker 代理。
   *
   * 返回 { direct, proxy }，其中 direct 是优先加载的原链，
   * proxy 是失败后兜底的 /api/proxy/image 地址（挂在 data-fallback 上）。
   */
  function imgDirect(u) {
    if (!u) return null;
    if (String(u).indexOf('/api/') === 0) return { direct: u, proxy: u };
    return {
      direct: u,
      proxy: '/api/proxy/image?url=' + encodeURIComponent(u)
    };
  }

  /** 图片标签：直连原链 + referrerpolicy + 失败回退代理 */
  function imgTag(u, alt, extra) {
    var s = imgDirect(u);
    if (!s) return '';
    return '<img src="' + W.esc(s.direct) + '"'
      + ' alt="' + (alt || '') + '"'
      + ' loading="lazy" referrerpolicy="no-referrer"'
      + ' data-fallback="' + W.esc(s.proxy) + '"'
      + (extra || '') + '>';
  }

  // 全局图片加载失败回退：直连失败时，切到 Worker 代理
  // （事件委托；只回退一次，避免死循环）
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    var fb = img.getAttribute('data-fallback');
    if (!fb) return;
    if (img.getAttribute('data-fallback-used') === '1') return;
    if (img.src === fb) return;
    img.setAttribute('data-fallback-used', '1');
    img.src = fb;
  }, true);

  /**
   * 该地址是否更像视频容器（而非图片）
   *
   * 只认得出的视频扩展名才算。抖音动图直链形如
   *   https://www.douyin.com/aweme/v1/play/?video_id=...
   * 完全没有后缀，这里会返回 false，需由调用方结合 animated 标记判断。
   */
  function looksLikeVideo(u) {
    return /\.(mp4|mov|webm|m4v|m3u8)(\?|$)/i.test(String(u || ''));
  }

  /** 是否是"图片文件"的扩展名（含动图文件 .gif / .webp） */
  function looksLikeImage(u) {
    return /\.(gif|webp|png|jpe?g|avif|bmp)(\?|$)/i.test(String(u || ''));
  }

  /**
   * 计算某条目应按 <video> 还是 <img> 渲染
   *
   * 动图有两种形态，仅凭扩展名无法区分：
   *   · 真 MP4 流（抖音 LivePhoto）→ URL 常无后缀，必须 <video>
   *   · 真正的 .gif / .webp 动图  → 仍是图片，用 <img>
   *
   * 规则：明确是视频扩展名 → video；
   *       否则若是「动图」且不是图片文件 → 视为视频流。
   */
  function computeIsVideo(url, animated) {
    if (looksLikeVideo(url)) return true;
    if (animated && !looksLikeImage(url)) return true;
    return false;
  }

  /**
   * 该条目是否应按 <video> 渲染
   *
   * 以 computeIsVideo 的结果为准；缺省（如旧数据未带标记）时回退到
   * 扩展名判断，避免出现"静默降级成 <img>"而把视频送去图片代理。
   */
  function renderAsVideo(item) {
    if (!item) return false;
    if (typeof item.isVideo === 'boolean') return item.isVideo;
    return computeIsVideo(item.url, item.animated);
  }

  /**
   * 构建「图片 + 动图」统一列表（保序去重）
   *
   * 网格与灯箱共用此函数 —— 此前两处各写了一份 push，
   * 灯箱那份漏了 isVideo 参数，导致点开动图时按 <img> 渲染并报 415。
   * 合并为一处后不可能再出现这种分叉。
   *
   * @param {object} d 解析结果
   * @returns {{url:string, animated:boolean, isVideo:boolean}[]}
   */
  function buildMediaList(d) {
    var out = [];
    var seen = {};
    var push = function (url, animated) {
      if (!url || seen[url]) return;
      seen[url] = 1;
      out.push({
        url: url,
        animated: !!animated,
        isVideo: computeIsVideo(url, animated)
      });
    };
    (d.gifs || []).forEach(function (g) { push(g.url, true); });
    (d.images || []).forEach(function (i) { push(i.url, false); });
    return out;
  }

  /** 复制到剪贴板（带降级） */
  function copyText(text, okMsg) {
    if (!text) { W.toast('没有可复制的内容'); return; }
    function done() { W.toast(okMsg || '已复制到剪贴板'); }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) {
        W.toast('复制失败，请手动选择');
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  /* ---------- 输入 ---------- */
  var detectTimer = null;
  urlInput.addEventListener('input', function () {
    if (clearBtn) clearBtn.classList.toggle('is-visible', !!this.value.trim());
    clearTimeout(detectTimer);
    detectTimer = setTimeout(function () {
      var v = urlInput.value.trim();
      if (!v) { resetDetect(); return; }
      var p = W.detect(W.extract(v)) || W.detect(v);
      if (p) {
        detectBadge.textContent = p.n;
        detectBadge.classList.add('is-visible');
      } else {
        resetDetect();
      }
    }, 250);
  });

  urlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); parse(); }
  });

  function resetDetect() {
    detectBadge.classList.remove('is-visible');
    detectBadge.textContent = '';
  }

  function clearUrl() {
    urlInput.value = '';
    if (clearBtn) clearBtn.classList.remove('is-visible');
    hideError(); hideResult(); resetDetect();
    urlInput.focus();
  }

  function fillEg(u) {
    urlInput.value = u || '';
    if (clearBtn) clearBtn.classList.add('is-visible');
    urlInput.dispatchEvent(new Event('input'));
    urlInput.focus();
  }

  /* ---------- 解析 ---------- */
  async function parse() {
    var raw = urlInput.value.trim();
    if (!raw) { W.toast('请粘贴链接'); return; }

    var url = W.extract(raw);
    if (!url || url.indexOf('http') !== 0) { W.toast('未识别到有效链接'); return; }

    // ---- 平台校验：每个页面只解析对应平台的链接 ----
    // CFG.match 为该页面允许的域名白名单（由各平台页的 PLATFORM_CONFIG 注入）。
    // 若链接域名不在白名单内，直接拒绝，避免串平台解析。
    if (CFG.match && CFG.match.length) {
      var matched = CFG.match.some(function (d) {
        return url.toLowerCase().indexOf(d.toLowerCase()) !== -1;
      });
      if (!matched) {
        showError('请粘贴 ' + CFG.name + ' 链接：本页面仅支持 ' + CFG.name
          + ' 内容，检测到的是其他平台链接。');
        return;
      }
    }

    loadLabel.textContent = '正在解析…';
    hideError(); hideResult();
    loading.classList.add('is-active');
    parseBtn.disabled = true;

    try {
      var resp = await fetch('/api/parse?url=' + encodeURIComponent(url));
      var payload = await resp.json();
      if (!resp.ok || !payload.success) throw new Error(payload.error || '未找到媒体信息');
      loading.classList.remove('is-active');
      render(payload.data);
    } catch (err) {
      loading.classList.remove('is-active');
      showError(err.message === 'Failed to fetch' ? '网络异常，请稍后重试' : err.message);
    } finally {
      parseBtn.disabled = false;
    }
  }

  /* ---------- 渲染 ---------- */
  function render(d) {
    if (!d) { showError('未获取到媒体信息'); return; }
    curData = d;

    var pf = d.platform || CFG.name || '媒体';
    var pi = d.platformIcon || CFG.icon || '🔗';
    var stamp = W.stamp();

    // 文件名前缀：平台名多为中文，直接过滤非 ASCII 会得到空串，
    // 因此用固定映射表转成英文缩写。
    var SLUG = {
      '抖音': 'douyin', '快手': 'kuaishou', '哔哩哔哩': 'bilibili', 'B站': 'bilibili'
    };
    var pn = SLUG[pf] || String(pf).toLowerCase().replace(/[^a-z0-9]/g, '') || 'media';

    var TYPE = {
      video: '视频', images: '图文', gif: '动图', mixed: '混合内容',
      video_images: '视频 + 图文', video_gif: '视频 + 动图', gif_images: '动图 + 图文'
    };

    var vs = d.videos || [], im = d.images || [], gs = d.gifs || [];

    // 图片 / 动图合并去重（保序）—— 与灯箱共用 buildMediaList，避免逻辑分叉
    var allIm = buildMediaList(d);

    // 封面若与首图相同，则不再单独使用，避免重复展示
    var cover = d.cover || '';
    var mainVideo = vs.length ? vs[0] : null;

    var h = '<div class="result-card">';

    /* ---- 徽章行：平台 · 类型 · 数量 ---- */
    h += '<div class="result-top">';
    h += '<span class="badge pill">' + esc(pi) + ' ' + esc(pf) + '</span>';
    h += '<span class="badge pill">' + esc(TYPE[d.type] || '媒体') + '</span>';
    if (vs.length > 1) h += '<span class="badge pill dim">' + vs.length + ' 段视频</span>';
    if (gs.length) h += '<span class="badge pill dim">' + gs.length + ' 个动图</span>';
    if (im.length) h += '<span class="badge pill dim">' + im.length + ' 张图</span>';
    h += '</div>';

    /* ---- 已有元信息但拿不到播放流时，明确告知原因 ---- */
    if (!mainVideo && d.noPlayUrl) {
      h += '<div class="result-note">未能取到播放地址，该内容可能受地区限制、'
        + '需要充电/付费，或已被 UP 主设为不可见。</div>';
    }

    /* ---- 标题与作者 ---- */
    h += '<div class="result-head">';
    if (d.title) h += '<h2>' + esc(d.title) + '</h2>';
    if (d.author || d.authorId) {
      h += '<div class="author-row">';
      h += '<span class="author-av">';
      h += d.avatar
        ? imgTag(d.avatar, '')
        : esc(pi);
      h += '</span>';
      h += '<span class="author-name">' + esc(d.author || '未知作者') + '</span>';
      if (d.authorId) h += '<span class="author-id">@' + esc(d.authorId) + '</span>';
      h += '</div>';
    }
    h += '</div>';

    /* ---- 视频：封面直接作为 poster，避免与下方画面重复 ---- */
    if (mainVideo) {
      h += '<div class="player-block">';
      h += '<div class="player">';
      h += '<video id="mainVideo" controls playsinline webkit-playsinline preload="none"'
        + (cover ? ' poster="' + W.esc(cover) + '"' : '')
        + ' src="' + mediaUrl(mainVideo.url, 'video.mp4', 'stream') + '"></video>';
      h += '</div>';

      h += '<div class="player-meta">'
        + '<span class="player-quality mono">' + esc(mainVideo.quality || '高清') + '</span>'
        + '<span class="player-actions">'
        + '<button class="btn btn-outline btn-sm" type="button" data-action="copy-video-url">复制直链</button>'
        + '<a class="btn btn-primary btn-sm" href="'
        + mediaUrl(mainVideo.url, stamp + '_' + pn + '_video.mp4') + '" download>下载视频</a>'
        + '</span></div>';

      /* 多分段：做成可切换的胶囊组 */
      if (vs.length > 1) {
        h += '<div class="seg-row"><span class="seg-label mono">分段</span><div class="seg-list">';
        vs.forEach(function (v, i) {
          h += '<button class="seg' + (i === 0 ? ' on' : '') + '" type="button"'
            + ' data-action="switch-video" data-index="' + i + '"'
            + ' data-url="' + esc(v.url) + '" data-quality="' + esc(v.quality || '') + '"'
            + ' aria-pressed="' + (i === 0 ? 'true' : 'false') + '">'
            + (i + 1)
            + (v.quality ? '<span class="seg-q">' + esc(v.quality) + '</span>' : '')
            + '</button>';
        });
        h += '</div></div>';
      }

      h += '</div>';
    }

    /* ---- 图片 / 动图网格 ---- */
    if (allIm.length) {
      var gifCount = gs.length;
      var imgCount = im.length;
      var parts = [];
      if (gifCount) parts.push(gifCount + ' 个动图');
      if (imgCount) parts.push(imgCount + ' 张图');

      h += '<div class="thumbs"><div class="thumbs-head">'
        + '<span class="sec">' + esc(parts.join(' · ')) + '</span>'
        + '<button class="btn btn-text btn-sm" type="button" data-action="copy-all-images">复制全部链接</button>'
        + '</div><div class="thumb-grid">';

      allIm.forEach(function (item, i) {
        var u = item.url;
        h += '<button class="thumb' + (item.animated ? ' is-anim' : '') + '" type="button"'
          + ' data-action="open-lightbox" data-index="' + i + '"'
          + ' aria-label="查看第 ' + (i + 1) + (item.animated ? ' 个动图' : ' 张图片') + '">';

        // 动图是 MP4 视频流：必须用 <video>，否则会被送到图片代理并报错
        if (renderAsVideo(item)) {
          h += '<video src="' + mediaUrl(u, 'anim.mp4', 'stream') + '" muted loop playsinline'
            + ' preload="metadata" referrerpolicy="no-referrer"></video>';
        } else {
          h += imgTag(u, '');
        }

        if (item.animated) h += '<span class="thumb-tag">动图</span>';
        h += '</button>';
      });

      h += '</div></div>';
    }

    /* ---- 底部操作 ---- */
    h += '<div class="result-actions">';
    h += '<button class="btn btn-outline btn-sm" type="button" data-action="copy-formatted">格式化复制</button>';
    h += '<button class="btn btn-outline btn-sm" type="button" data-action="copy-json">复制 JSON</button>';
    h += '<button class="btn btn-outline btn-sm" type="button" data-action="open-detail">查看详情</button>';
    h += '</div>';

    h += '</div>';
    resultEl.innerHTML = h;
    resultEl.classList.add('is-active');
    setTimeout(function () {
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  /* ---------- 灯箱 ---------- */
  function openLightbox(index) {
    var d = curData;
    if (!d) return;

    // 与网格共用 buildMediaList：此处曾各自实现一遍 push，
    // 灯箱那份漏了 isVideo 参数，导致点开动图时按 <img> 渲染并报 415。
    var list = buildMediaList(d);

    if (!list.length) return;
    lightboxItems = list;
    lightboxIndex = Math.max(0, Math.min(index, lightboxItems.length - 1));
    paintLightbox();
    id('lightbox').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function paintLightbox() {
    var item = lightboxItems[lightboxIndex];
    if (!item) return;

    var img = id('lightboxImg');
    var vid = id('lightboxVideo');

    // 动图（MP4）用 <video> 自动循环播放；静态图仍用 <img>
    if (renderAsVideo(item) && vid) {
      img.style.display = 'none';
      img.removeAttribute('src');
      vid.style.display = '';
      vid.src = mediaUrl(item.url, 'anim.mp4', 'stream');
      vid.play().catch(function () { /* 自动播放被拦截时忽略 */ });
    } else {
      if (vid) {
        vid.style.display = 'none';
        vid.pause();
        vid.removeAttribute('src');
      }
      img.style.display = '';
      var s = imgDirect(item.url);
      if (s) {
        img.setAttribute('referrerpolicy', 'no-referrer');
        img.setAttribute('data-fallback', s.proxy);
        img.removeAttribute('data-fallback-used');
        img.src = s.direct;
      } else {
        img.removeAttribute('src');
      }
    }

    id('lightboxCount').textContent = (lightboxIndex + 1) + ' / ' + lightboxItems.length;
    id('lightboxPrev').style.visibility = lightboxItems.length > 1 ? 'visible' : 'hidden';
    id('lightboxNext').style.visibility = lightboxItems.length > 1 ? 'visible' : 'hidden';
  }

  function stepLightbox(delta) {
    if (lightboxItems.length < 2) return;
    lightboxIndex = (lightboxIndex + delta + lightboxItems.length) % lightboxItems.length;
    paintLightbox();
  }

  function closeLightbox() {
    id('lightbox').classList.remove('active');
    id('lightboxImg').removeAttribute('src');
    var vid = id('lightboxVideo');
    if (vid) { vid.pause(); vid.removeAttribute('src'); }
    lightboxIndex = -1;
    document.body.style.overflow = '';
  }

  /* ---------- 详情 ---------- */
  function openDetail() {
    var d = curData;
    if (!d) return;

    var h = '<table class="dtable">';
    h += '<tr><td>platform</td><td>' + esc(d.platform || '') + '</td></tr>';
    if (d.title) h += '<tr><td>title</td><td>' + esc(d.title) + '</td></tr>';
    if (d.author) h += '<tr><td>author</td><td>' + esc(d.author) + '</td></tr>';
    if (d.authorId) h += '<tr><td>author_id</td><td>' + esc(d.authorId) + '</td></tr>';
    if (d.type) h += '<tr><td>type</td><td>' + esc(d.type) + '</td></tr>';

    (d.videos || []).forEach(function (v, i) {
      if (i === 0) h += '<tr><td colspan="2" class="dsec">videos · ' + d.videos.length + '</td></tr>';
      h += '<tr><td>#' + (i + 1) + ' ' + esc(v.quality || '') + '</td><td><div class="durl-row">'
        + '<span class="durl">' + esc(v.url) + '</span>'
        + '<button class="btn btn-outline btn-sm" type="button" data-action="copy-one" data-url="'
        + esc(v.url) + '">复制</button></div></td></tr>';
    });

    var all = (d.gifs || []).map(function (g) { return g.url; })
      .concat((d.images || []).map(function (i) { return i.url; }));
    var seen = {};
    all = all.filter(function (u) { if (!u || seen[u]) return false; seen[u] = 1; return true; });

    all.forEach(function (u, i) {
      if (i === 0) h += '<tr><td colspan="2" class="dsec">images · ' + all.length + '</td></tr>';
      h += '<tr><td>#' + (i + 1) + '</td><td><div class="durl-row">'
        + '<span class="durl">' + esc(u) + '</span>'
        + '<button class="btn btn-outline btn-sm" type="button" data-action="copy-one" data-url="'
        + esc(u) + '">复制</button></div></td></tr>';
    });

    if (d.cover) {
      h += '<tr><td colspan="2" class="dsec">cover</td></tr><tr><td></td><td><div class="durl-row">'
        + '<span class="durl">' + esc(d.cover) + '</span>'
        + '<button class="btn btn-outline btn-sm" type="button" data-action="copy-one" data-url="'
        + esc(d.cover) + '">复制</button></div></td></tr>';
    }
    h += '</table>';

    id('detailBody').innerHTML = h;
    id('detailModal').classList.add('active');
    // 锁定背景滚动，防止模态框打开时页面仍可滑动
    document.body.style.overflow = 'hidden';
  }

  function closeDetail() {
    id('detailModal').classList.remove('active');
    document.body.style.overflow = '';
  }

  /* ---------- 复制 ---------- */
  function allImageUrls() {
    var d = curData;
    if (!d) return [];
    var all = (d.gifs || []).map(function (g) { return g.url; })
      .concat((d.images || []).map(function (i) { return i.url; }));
    var seen = {};
    return all.filter(function (u) { if (!u || seen[u]) return false; seen[u] = 1; return true; });
  }

  function copyAllImages() {
    var urls = allImageUrls();
    if (!urls.length) { W.toast('暂无图片'); return; }
    copyText(urls.join('\n'), '已复制 ' + urls.length + ' 条图片直链');
  }

  function copyFormatted() {
    var d = curData;
    if (!d) return;
    var lines = [];
    lines.push('平台：' + (d.platform || ''));
    if (d.title) lines.push('标题：' + d.title);
    if (d.author) lines.push('作者：' + d.author);
    if (d.authorId) lines.push('作者 ID：' + d.authorId);

    var vs = d.videos || [];
    if (vs.length) {
      lines.push('', '视频：');
      vs.forEach(function (v, i) {
        lines.push('- 视频 ' + (i + 1) + (v.quality ? '（' + v.quality + '）' : '') + '：' + v.url);
      });
    }

    var urls = allImageUrls();
    if (urls.length) {
      lines.push('', '图集：');
      urls.forEach(function (u, i) { lines.push('- 图片 ' + (i + 1) + '：' + u); });
    }

    if (d.cover) lines.push('', '封面：' + d.cover);

    lines.push('', '【声明】素材版权归原平台及创作者所有，仅供个人学习研究，严禁商用。');
    copyText(lines.join('\n'), '已格式化复制解析结果');
  }

  function copyJson() {
    if (!curData) return;
    copyText(JSON.stringify(curData, null, 2), '已复制完整 JSON');
  }

  /* ---------- 状态 ---------- */
  function showError(m) { errorDetail.textContent = m; errorBox.classList.add('is-active'); }
  function hideError() { errorBox.classList.remove('is-active'); errorDetail.textContent = ''; }
  function hideResult() {
    resultEl.classList.remove('is-active');
    resultEl.innerHTML = '';
    curData = null;
  }

  /* ---------- 切换分段 ---------- */
  function switchVideo(el) {
    var v = id('mainVideo');
    if (!v) return;

    v.src = mediaUrl(el.dataset.url, 'video.mp4', 'stream');
    v.load();

    var q = document.querySelector('.player-quality');
    if (q) q.textContent = el.dataset.quality || '高清';

    // 更新分段胶囊的选中态
    document.querySelectorAll('.seg').forEach(function (btn) {
      var on = btn === el;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    });

    v.play().catch(function () { /* 自动播放被拦截时忽略 */ });
  }

  /* ---------- 事件委托 ---------- */
  W.on('parse', parse);
  W.on('clear-url', clearUrl);
  W.on('fill-example', function (el) { fillEg(el.dataset.value || ''); });
  W.on('open-detail', openDetail);
  W.on('close-detail', closeDetail);
  W.on('copy-all-images', copyAllImages);
  W.on('copy-formatted', copyFormatted);
  W.on('copy-json', copyJson);
  W.on('copy-one', function (el) { copyText(el.dataset.url, '已复制链接'); });
  W.on('copy-video-url', function () {
    var d = curData;
    if (d && d.videos && d.videos.length) copyText(d.videos[0].url, '已复制视频直链');
  });
  W.on('switch-video', switchVideo);
  W.on('open-lightbox', function (el) { openLightbox(parseInt(el.dataset.index, 10) || 0); });
  W.on('close-lightbox', closeLightbox);
  W.on('lightbox-prev', function () { stepLightbox(-1); });
  W.on('lightbox-next', function () { stepLightbox(1); });
  W.on('copy-lightbox-url', function () {
    if (lightboxIndex >= 0) {
      var it = lightboxItems[lightboxIndex];
      copyText(it && it.url ? it.url : '', '已复制图片直链');
    }
  });

  /* 灯箱键盘导航 */
  document.addEventListener('keydown', function (e) {
    if (!id('lightbox').classList.contains('active')) return;
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
  });
})();
