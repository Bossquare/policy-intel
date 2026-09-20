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

  /* 所有条目打平，附带所属简报 */
  const ALL = [];
  Object.keys(BRIEFS).forEach(function (bid) {
    BRIEFS[bid].items.forEach(function (it) {
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
          (it.source && it.source.url ? '<a class="btn sm ghost" href="' + esc(it.source.url) + '" target="_blank" rel="noopener">原文</a>' : "") +
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

    const src = it.source && it.source.url
      ? '<a href="' + esc(it.source.url) + '" target="_blank" rel="noopener">' + esc(it.source.label || it.source.url) + "</a>"
      : "<span>未记录</span>";

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
      '<div class="block"><h4>来源与可信度</h4><p>来源：' + src + "　｜　可信度：" + esc(it.confidence || "未标注") +
        '<br><span style="color:var(--muted);font-size:13px">可信度沿用原始检索状态；标注「待核实」的条目表示附件或正文尚未逐条核验。</span></p></div>' +
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
          (i.source && i.source.url ? '<a href="' + esc(i.source.url) + '" target="_blank" rel="noopener">链接</a>' : "-") +
          "</td></tr>";
      }).join("") + "</tbody></table></div></div>";

    root.innerHTML = html;
  }

  /* ============================================================ 归档列表 */
  function renderBriefs() {
    $("#archive").innerHTML = INDEX.briefs.map(function (b) {
      return '<article class="intel">' +
        '<div><span class="badge nat">' + esc(b.id) + '</span><span class="badge">' + b.total + " 条</span></div>" +
        '<h3><a href="brief.html?id=' + encodeURIComponent(b.id) + '">' + esc(b.title) + "</a></h3>" +
        '<div class="info">时间窗口 ' + esc(b.period) + "　·　生成于 " + esc(b.generated_at) + "</div>" +
        '<p class="sum">' + (b.conclusions.length ? esc(b.conclusions[0].body) : "") + "</p>" +
        '<div class="actions"><a class="btn sm" href="brief.html?id=' + encodeURIComponent(b.id) + '">打开简报</a></div>' +
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
