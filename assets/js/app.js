/* ==========================================================================
   建筑智能化政策与技术情报站 —— 前端逻辑
   数据来源：assets/data/site-data.js（由 agent/build_data.py 生成）
   无框架依赖，GitHub Pages / 本地 file:// 均可直接运行。
   ========================================================================== */
(function () {
  "use strict";

  const SITE = window.INTEL_SITE;
  if (!SITE) {
    document.body.innerHTML =
      '<div class="loading">数据未加载：请确认 assets/data/site-data.js 存在（可运行 <code>python3 agent/build_data.py</code> 生成）。</div>';
    return;
  }

  const INDEX = SITE.index;
  const BRIEFS = SITE.briefs;
  const TRACKS = INDEX.tracks;

  /* 所有条目打平，附带所属简报。
     周报与月报可能共享同一条目（同 id），按 id 去重，保留先出现的一版
     （简报按周期截止日降序排列，内容最全的一期排最前）。 */
  const ALL = [];
  const SEEN = {};
  Object.keys(BRIEFS).forEach(function (bid) {
    BRIEFS[bid].items.forEach(function (it) {
      if (SEEN[it.id]) return;
      SEEN[it.id] = 1;
      ALL.push(Object.assign({}, it, { brief: bid }));
    });
  });

  /* ---------------------------------------------------------------- 元数据 */
  const TIERS = {
    focus: { label: "重点关注", desc: "与主营赛道强相关，建议本周内研读并落到具体动作" },
    track: { label: "持续跟踪", desc: "相关但不紧急，纳入跟踪清单，出现后续文件时评估" },
    watch: { label: "一般了解", desc: "行业氛围与生态信息，了解即可" }
  };
  const LEVELS = {
    national: "国家层面",
    "key-city": "重点省市",
    other: "其他省市",
    industry: "行业层面"
  };
  const LEVEL_BADGE = { national: "nat", "key-city": "loc", other: "loc", industry: "ind" };

  /* ---------------------------------------------------------------- 工具 */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function params() {
    const o = {};
    location.search.replace(/^\?/, "").split("&").forEach(function (kv) {
      if (!kv) return;
      const p = kv.split("=");
      o[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " "));
    });
    return o;
  }
  function tierBadge(it) {
    return '<span class="badge tier-' + it.tier + '">' + TIERS[it.tier].label + "</span>";
  }
  function levelBadge(it) {
    return '<span class="badge ' + (LEVEL_BADGE[it.level] || "") + '">' + esc(it.region || LEVELS[it.level] || "") + "</span>";
  }
  function trackBadges(it, limit) {
    const list = (it.tracks || []).slice(0, limit || 3);
    return list.map(function (t) {
      return '<span class="badge">' + esc((TRACKS[t] || {}).label || t) + "</span>";
    }).join("");
  }
  function fmtDate(d) {
    if (!d) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    return m ? m[1] + "-" + m[2] + "-" + m[3] : d;
  }

  /* ---------------------------------------------------------- 来源链接 */
  /* 链接可用性由 agent/check_sources.py 联网探测产出（打包在 site-data.js 的 source_health） */
  const HEALTH = (SITE.source_health && SITE.source_health.items) || {};
  const HEALTH_AT = (SITE.source_health && SITE.source_health.checked_at) || "";

  function healthTag(url) {
    const h = HEALTH[url];
    if (!h || h.status === "ok") return "";
    if (h.status === "dead") {
      return '<span class="src-status dead" title="最近一次检查返回 ' + esc(h.code) + '，链接可能已失效">链接失效</span>';
    }
    return '<span class="src-status warn" title="站点拒绝脚本访问，用浏览器通常可正常打开">请用浏览器打开</span>';
  }

  function kindTag(sp) {
    return sp.kind === "list"
      ? '<span class="src-kind" title="原报告只记录到栏目页，需在该栏目内按标题或文号检索">栏目页</span>'
      : "";
  }

  /* 详情页「来源与可信度」区块 */
  function sourceBlock(it) {
    const sp = it.source || {};
    if (!sp.url) {
      return "<p>来源：未记录　｜　可信度：" + esc(it.confidence || "未标注") + "</p>";
    }
    let h = '<div class="src-box">';
    h += '<div class="src-main">' + kindTag(sp) + healthTag(sp.url) +
      '<a href="' + esc(sp.url) + '" target="_blank" rel="noopener">' + esc(sp.label || sp.url) + "</a></div>";
    h += '<div class="src-url"><code>' + esc(sp.url) + "</code>" +
      '<button type="button" class="src-copy" data-copy="' + esc(sp.url) + '">复制链接</button></div>';
    if (sp.note) h += '<div class="src-note">' + esc(sp.note) + "</div>";
    if (sp.alt && sp.alt.length) {
      h += '<div class="src-alt">备用来源：' + sp.alt.map(function (a) {
        return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.label) + "</a>" + healthTag(a.url);
      }).join("　") + "</div>";
    }
    h += '<p class="src-conf">可信度：' + esc(it.confidence || "未标注") +
      '<span class="src-hint">可信度沿用原始检索状态；标注「待核实」的条目表示附件或正文尚未逐条核验。' +
      (HEALTH_AT ? "链接可用性最近检查于 " + esc(HEALTH_AT) + "。" : "") + "</span></p>";
    h += "</div>";
    return h;
  }

  /* 复制到剪贴板：https 下用 clipboard API，file:// 打开时降级到 execCommand */
  function copyText(text, btn) {
    const old = btn.textContent;
    function done(ok) {
      btn.textContent = ok ? "已复制" : "复制失败";
      btn.classList.toggle("ok", ok);
      setTimeout(function () { btn.textContent = old; btn.classList.remove("ok"); }, 1600);
    }
    function fallback() {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
    } else {
      done(fallback());
    }
  }
  document.addEventListener("click", function (e) {
    const b = e.target && e.target.closest ? e.target.closest(".src-copy") : null;
    if (b) copyText(b.getAttribute("data-copy") || "", b);
  });

  /* ---------------------------------------------------------- 简报下载 */
  /* 按钮本身只带 data-dl / data-brief，真正的导出逻辑在 assets/js/export.js */
  function dlGroup(bid) {
    return '<span class="dl-group">' +
      '<span class="dl-label">下载</span>' +
      '<button type="button" class="btn sm ghost" data-dl="pdf" data-brief="' + esc(bid) + '" ' +
        'title="A4 竖版（210×297mm）PDF">PDF</button>' +
      '<button type="button" class="btn sm ghost" data-dl="html" data-brief="' + esc(bid) + '" ' +
        'title="自包含 A4 竖版 HTML，双击即可离线打开">HTML</button>' +
      '<span class="dl-hint">A4 竖版</span>' +
      "</span>";
  }

  function currentBriefId() {
    if (document.body.dataset.page === "brief") {
      return params().id || ((INDEX.briefs[0] || {}).id || "");
    }
    return "";
  }

  document.addEventListener("click", function (e) {
    const btn = e.target && e.target.closest ? e.target.closest("[data-dl]") : null;
    if (!btn) return;
    e.preventDefault();
    const id = btn.getAttribute("data-brief") || currentBriefId();
    const api = window.INTEL_EXPORT;
    if (!api) { alert("导出模块未加载，请刷新页面后重试"); return; }
    if (btn.getAttribute("data-dl") === "pdf") api.pdf(id);
    else api.html(id);
  });

  /* ---------------------------------------------------------------- 卡片 */
  function intelCard(it) {
    const hasInsight = !!(it.impact || it.action);
    return (
      '<article class="intel tier-' + it.tier + '">' +
        '<div>' + tierBadge(it) + levelBadge(it) + trackBadges(it, 2) + "</div>" +
        '<h3><a href="item.html?id=' + encodeURIComponent(it.id) + '">' + esc(it.title) + "</a></h3>" +
        '<div class="info">' + esc(it.org) + "　·　" + esc(it.date || it.date_raw) + "　·　" + esc(it.form) + "</div>" +
        '<p class="sum">' + esc(it.summary) + "</p>" +
        '<div class="actions">' +
          '<a class="btn sm" href="item.html?id=' + encodeURIComponent(it.id) + '">查看详情</a>' +
          (hasInsight ? '<a class="btn sm ghost" href="item.html?id=' + encodeURIComponent(it.id) + '#insight">影响分析</a>' : "") +
          (it.source && it.source.url
            ? '<a class="btn sm ghost" href="' + esc(it.source.url) + '" target="_blank" rel="noopener">' +
              (it.source.kind === "list" ? "栏目页" : "原文") + healthTag(it.source.url) + "</a>"
            : "") +
        "</div>" +
        '<div class="intel-foot"><span>' + esc(it.confidence || "") + "</span>" +
          '<span class="rel">相关性 ' + it.relevance + '<i class="rel-bar"><i style="width:' + it.relevance + '%"></i></i></span>' +
        "</div>" +
      "</article>"
    );
  }

  /* ================================================================ 首页 */
  function renderHome() {
    const t = INDEX.totals;
    const brief = INDEX.briefs[0];
    const body = BRIEFS[brief.id];

    $("#ov-items").textContent = t.items;
    $("#ov-focus").textContent = t.focus;
    $("#ov-track").textContent = t.track;
    $("#ov-watch").textContent = t.watch;
    $("#ov-extra").textContent = t.insights;

    // 核心结论
    const concl = $("#conclusions");
    if (concl && brief.conclusions) {
      concl.innerHTML =
        '<div class="concl"><ol>' +
        brief.conclusions.map(function (c) {
          return "<li><b>" + esc(c.title) + "</b>" + esc(c.body) + "</li>";
        }).join("") +
        "</ol></div>";
    }

    // 重点关注
    const focus = ALL.filter(function (i) { return i.tier === "focus"; })
      .sort(function (a, b) { return b.relevance - a.relevance; });
    $("#focus-list").innerHTML = focus.map(intelCard).join("");
    $("#focus-count").textContent = focus.length;

    // 持续跟踪（预览 6 条）
    const track = ALL.filter(function (i) { return i.tier === "track"; })
      .sort(function (a, b) { return b.relevance - a.relevance; });
    $("#track-list").innerHTML = track.slice(0, 6).map(intelCard).join("");
    $("#track-count").textContent = track.length;

    // 一般了解
    const watch = ALL.filter(function (i) { return i.tier === "watch"; });
    $("#watch-list").innerHTML = watch.map(intelCard).join("");
    $("#watch-count").textContent = watch.length;

    // 赛道热度
    const byTrack = {};
    ALL.forEach(function (i) {
      (i.tracks || []).forEach(function (k) { byTrack[k] = (byTrack[k] || 0) + 1; });
    });
    const max = Math.max.apply(null, Object.keys(byTrack).map(function (k) { return byTrack[k]; }));
    $("#track-heat").innerHTML = Object.keys(TRACKS).map(function (k) {
      const v = byTrack[k] || 0;
      return '<div class="track-row">' +
        '<div class="track-name">' + esc(TRACKS[k].label) + "</div>" +
        '<div class="track-track"><i style="width:' + (max ? (v / max * 100) : 0) + '%"></i></div>' +
        '<div class="track-val">' + v + "</div>" +
        '<div class="track-desc">' + esc(TRACKS[k].desc) + "</div>" +
      "</div>";
    }).join("");

    // 影响矩阵
    const impacts = (body.narrative && body.narrative.impacts) || [];
    $("#matrix").innerHTML = impacts.map(function (m) {
      return '<div class="mx"><h4>' + esc(m.title) + '</h4><div class="lv">' + esc(m.level) + "</div><p>" + esc(m.body) + "</p></div>";
    }).join("");

    // 趋势
    const outlook = (body.narrative && body.narrative.outlook) || [];
    $("#outlook").innerHTML = outlook.map(function (o) {
      return '<div class="fc"><div class="fn">' + o.no + "</div><h4>" + esc(o.title) + "</h4><p>" + esc(o.body) + "</p></div>";
    }).join("");
  }

  /* ============================================================ 条目库 */
  const state = { tier: "all", level: "all", track: "all", q: "" };

  function renderItems() {
    const levels = {};
    ALL.forEach(function (i) { levels[i.level] = (levels[i.level] || 0) + 1; });

    $("#f-tier").innerHTML = [["all", "全部", ALL.length]].concat(
      ["focus", "track", "watch"].map(function (k) {
        const n = ALL.filter(function (i) { return i.tier === k; }).length;
        return [k, TIERS[k].label, n];
      })
    ).map(function (r) {
      return '<button class="chip' + (state.tier === r[0] ? " on" : "") + '" data-f="tier" data-v="' + r[0] + '">' +
        r[1] + '<span class="c">' + r[2] + "</span></button>";
    }).join("");

    $("#f-level").innerHTML = [["all", "全部", ALL.length]].concat(
      Object.keys(LEVELS).filter(function (k) { return levels[k]; })
        .map(function (k) { return [k, LEVELS[k], levels[k]]; })
    ).map(function (r) {
      return '<button class="chip' + (state.level === r[0] ? " on" : "") + '" data-f="level" data-v="' + r[0] + '">' +
        r[1] + '<span class="c">' + r[2] + "</span></button>";
    }).join("");

    const tc = {};
    ALL.forEach(function (i) { (i.tracks || []).forEach(function (k) { tc[k] = (tc[k] || 0) + 1; }); });
    $("#f-track").innerHTML = [["all", "全部", ALL.length]].concat(
      Object.keys(TRACKS).filter(function (k) { return tc[k]; })
        .map(function (k) { return [k, TRACKS[k].label, tc[k]]; })
    ).map(function (r) {
      return '<button class="chip' + (state.track === r[0] ? " on" : "") + '" data-f="track" data-v="' + r[0] + '">' +
        r[1] + '<span class="c">' + r[2] + "</span></button>";
    }).join("");

    $$(".chip").forEach(function (b) {
      b.addEventListener("click", function () {
        state[b.dataset.f] = b.dataset.v;
        runFilter();
      });
    });
    $("#search").addEventListener("input", function (e) {
      state.q = e.target.value.trim();
      runFilter();
    });
    $("#reset").addEventListener("click", function () {
      state.tier = state.level = state.track = "all";
      state.q = "";
      $("#search").value = "";
      runFilter();
    });

    runFilter();
  }

  function runFilter() {
    // 更新 chip 选中态
    $$(".chip").forEach(function (b) {
      b.classList.toggle("on", state[b.dataset.f] === b.dataset.v);
    });

    const q = state.q.toLowerCase();
    const list = ALL.filter(function (i) {
      if (state.tier !== "all" && i.tier !== state.tier) return false;
      if (state.level !== "all" && i.level !== state.level) return false;
      if (state.track !== "all" && (i.tracks || []).indexOf(state.track) < 0) return false;
      if (q) {
        const hay = (i.title + i.org + i.summary + i.form + i.region + (i.impact || "")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return b.relevance - a.relevance; });

    $("#result").innerHTML =
      "共 <b>" + list.length + "</b> 条" +
      (state.q ? "　关键词「" + esc(state.q) + "」" : "");
    $("#list").innerHTML = list.length
      ? list.map(intelCard).join("")
      : '<div class="empty">没有符合条件的条目，换个筛选条件试试。</div>';
  }

  /* ============================================================ 条目详情 */
  function renderItem() {
    const id = params().id;
    const it = ALL.filter(function (x) { return x.id === id; })[0];
    const root = $("#detail");
    if (!it) {
      root.innerHTML = '<div class="empty">未找到该条目：' + esc(id || "(缺少 id 参数)") + "</div>";
      return;
    }
    document.title = it.title + " · 情报条目";

    root.innerHTML =
      "<div>" + tierBadge(it) + levelBadge(it) + trackBadges(it, 6) + "</div>" +
      "<h1>" + esc(it.title) + "</h1>" +
      '<div class="kv">' +
        "<div><dt>发布机构</dt><dd>" + esc(it.org) + "</dd></div>" +
        "<div><dt>时间</dt><dd>" + esc(it.date || it.date_raw) + "</dd></div>" +
        "<div><dt>形式</dt><dd>" + esc(it.form) + "</dd></div>" +
        "<div><dt>相关性</dt><dd>" + it.relevance + " / 100</dd></div>" +
      "</div>" +
      '<div class="block"><h4>核心内容</h4><p>' + esc(it.summary) + "</p></div>" +
      (it.impact
        ? '<div class="block focus-block"><h4>影响分析</h4><p>' + esc(it.impact) + "</p></div>"
        : '<div class="block"><h4>影响分析</h4><p style="color:var(--muted)">该条目为「' + TIERS[it.tier].label +
          "」级别，暂未单独出具影响分析。判定说明：" + TIERS[it.tier].desc + "</p></div>") +
      (it.action
        ? '<div class="block action-block"><h4>应对建议</h4><p>' + esc(it.action) + "</p></div>"
        : "") +
      '<div class="block"><h4>来源与可信度</h4>' + sourceBlock(it) + '</div>' +
      '<div class="block"><h4>归档信息</h4><p style="font-size:13px;color:var(--muted)">条目编号 ' + esc(it.id) +
        "　｜　所属简报：" + esc(it.brief) + '</p></div>' +
      '<div style="margin-top:22px"><a class="btn ghost" href="items.html">← 返回条目库</a> ' +
        '<a class="btn ghost" href="brief.html?id=' + encodeURIComponent(it.brief) + '">查看本期简报</a></div>';
  }

  /* ============================================================ 简报详情 */
  function renderBrief() {
    const bid = params().id || INDEX.briefs[0].id;
    const b = BRIEFS[bid];
    const root = $("#brief");
    if (!b) {
      root.innerHTML = '<div class="empty">未找到该期简报：' + esc(bid) + "</div>";
      return;
    }
    document.title = b.meta.title;

    const byTier = { focus: [], track: [], watch: [] };
    b.items.forEach(function (i) { byTier[i.tier].push(i); });
    Object.keys(byTier).forEach(function (k) {
      byTier[k].sort(function (a, c) { return c.relevance - a.relevance; });
    });

    const n = b.narrative || {};
    let html = "";

    html += '<div class="block"><h4>核心结论</h4><div class="concl" style="box-shadow:none;padding:6px 0"><ol>' +
      (n.conclusions || []).map(function (c) {
        return "<li><b>" + esc(c.title) + "</b>" + esc(c.body) + "</li>";
      }).join("") + "</ol></div></div>";

    ["focus", "track", "watch"].forEach(function (k) {
      html += '<div class="block"><h4>' + TIERS[k].label + "（" + byTier[k].length + " 条）</h4>" +
        '<p style="font-size:13px;color:var(--muted);margin-bottom:14px">' + TIERS[k].desc + "</p>" +
        '<div class="intel-grid g2">' + byTier[k].map(intelCard).join("") + "</div></div>";
    });

    if ((n.impacts || []).length) {
      html += '<div class="block"><h4>市场影响分析</h4><div class="matrix">' +
        n.impacts.map(function (m) {
          return '<div class="mx"><h4>' + esc(m.title) + '</h4><div class="lv">' + esc(m.level) +
            "</div><p>" + esc(m.body) + "</p></div>";
        }).join("") + "</div></div>";
    }
    if ((n.outlook || []).length) {
      html += '<div class="block"><h4>趋势展望</h4><div class="future">' +
        n.outlook.map(function (o) {
          return '<div class="fc"><div class="fn">' + o.no + "</div><h4>" + esc(o.title) +
            "</h4><p>" + esc(o.body) + "</p></div>";
        }).join("") + "</div></div>";
    }

    html += '<div class="block"><h4>附录：全部条目明细</h4><div class="tbl-wrap"><table>' +
      "<thead><tr><th>#</th><th>档级</th><th>发布机构</th><th>日期</th><th>名称</th><th>形式</th><th>相关性</th><th>来源</th></tr></thead><tbody>" +
      b.items.map(function (i) {
        return "<tr><td>" + i.no + "</td><td>" + TIERS[i.tier].label + "</td><td>" + esc(i.org) +
          "</td><td>" + esc(i.date_raw) + '</td><td><a href="item.html?id=' + encodeURIComponent(i.id) + '">' +
          esc(i.title) + "</a></td><td>" + esc(i.form) + "</td><td>" + i.relevance + "</td><td>" +
          (i.source && i.source.url
            ? '<a href="' + esc(i.source.url) + '" target="_blank" rel="noopener">' +
              (i.source.kind === "list" ? "栏目页" : "链接") + "</a>" + healthTag(i.source.url)
            : "-") +
          "</td></tr>";
      }).join("") + "</tbody></table></div></div>";

    root.innerHTML = html;
  }

  /* ============================================================ 归档列表 */
  function renderBriefs() {
    $("#archive").innerHTML = INDEX.briefs.map(function (b) {
      const isWeek = /-W\d+/.test(b.id);
      const kind = isWeek
        ? '<span class="badge wk">周报 · ' + esc(b.id.replace(/^20\d\d-/, "")) + "</span>"
        : '<span class="badge mo">月报 · ' + esc(b.id) + "</span>";
      const tier = (b.stats && b.stats.by_tier) || {};
      return '<article class="intel">' +
        '<div>' + kind + '<span class="badge">' + b.total + " 条</span></div>" +
        '<h3><a href="brief.html?id=' + encodeURIComponent(b.id) + '">' + esc(b.title) + "</a></h3>" +
        '<div class="info">时间窗口 ' + esc(b.period) + "　·　生成于 " + esc(b.generated_at) + "</div>" +
        '<p class="sum">' + (b.conclusions.length ? esc(b.conclusions[0].body) : "") + "</p>" +
        '<div class="mini-stats">' +
          '<span class="ms-focus">重点关注 <b>' + (tier.focus || 0) + "</b></span>" +
          '<span class="ms-track">持续跟踪 <b>' + (tier.track || 0) + "</b></span>" +
          '<span class="ms-watch">一般了解 <b>' + (tier.watch || 0) + "</b></span>" +
          (b.insights ? '<span style="margin-left:auto">影响分析 <b>' + b.insights + "</b> 条</span>" : "") +
        "</div>" +
        '<div class="actions"><a class="btn sm" href="brief.html?id=' + encodeURIComponent(b.id) + '">打开简报</a>' +
          dlGroup(b.id) + "</div>" +
      "</article>";
    }).join("");
  }

  /* ============================================================ 启动 */
  function boot() {
    const page = document.body.dataset.page;
    try {
      if (page === "home") renderHome();
      else if (page === "items") renderItems();
      else if (page === "item") renderItem();
      else if (page === "brief") renderBrief();
      else if (page === "briefs") renderBriefs();
    } catch (e) {
      console.error(e);
      const box = document.createElement("div");
      box.className = "empty";
      box.textContent = "页面渲染出错：" + e.message;
      document.querySelector("main, .wrap") .appendChild(box);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
