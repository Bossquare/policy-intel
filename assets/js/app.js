/* ==========================================================================
   建筑智能化市场洞察·政策情报分析 —— 前端逻辑
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
  /* 静态容器写纯文本（专题页的子标题、说明文字都由数据驱动，避免 HTML 与 JSON 双份维护） */
  function setText(sel, v) { const e = $(sel); if (e) e.textContent = v || ""; }
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
  /* 简报下载入口已统一改为右下角浮动坞（assets/js/export.js 的 .dl-dock） */

  /* ---------------------------------------------------------------- 卡片 */
  function intelCard(it) {
    const hasInsight = !!(it.impact || it.action);
    return (
      '<article class="intel tier-' + it.tier + '">' +
        '<div>' + tierBadge(it) + levelBadge(it) + trackBadges(it, 2) + netBadges(it, 2) + "</div>" +
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

    // 核心结论（模型生成或人工撰写；两处都没有时给空状态提示，别留一块白）
    const concl = $("#conclusions");
    if (concl) {
      const cs = brief.conclusions || [];
      concl.innerHTML = cs.length
        ? '<div class="concl"><ol>' +
            cs.map(function (c) {
              return "<li><b>" + esc(c.title) + "</b>" + esc(c.body) + "</li>";
            }).join("") +
          "</ol></div>" +
          (brief.narrative_mode === "llm"
            ? '<p class="narr-note">本期研判为模型草稿，待人工复核。</p>' : "")
        : '<div class="empty">本期尚未生成核心结论。' +
          "流水线会在分析阶段自动汇总，也可在 agent/weekly_narratives.json 人工撰写后重建。</div>";
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
    $("#matrix").innerHTML = impacts.length
      ? impacts.map(function (m) {
          return '<div class="mx"><h4>' + esc(m.title) + '</h4><div class="lv">' + esc(m.level) + "</div><p>" + esc(m.body) + "</p></div>";
        }).join("")
      : '<div class="empty">本期尚未生成市场影响分析（随核心结论一并产出）。</div>';

    // 趋势
    const outlook = (body.narrative && body.narrative.outlook) || [];
    $("#outlook").innerHTML = outlook.length
      ? outlook.map(function (o) {
          return '<div class="fc"><div class="fn">' + o.no + "</div><h4>" + esc(o.title) + "</h4><p>" + esc(o.body) + "</p></div>";
        }).join("")
      : '<div class="empty">本期尚未生成趋势展望（随核心结论一并产出）。</div>';
  }

  /* ======================================================== 六张网专题 */
  /* 口径 / 六张网界定 / 关键指标 / 政策脉络 / 主干政策清单 来自
     agent/six_networks.json（人工维护）；条目的 nets 标签由 build_data.py
     按关键词匹配生成。两者都在 site-data.js 的 SITE.six 里。 */
  const SIX = SITE.six || (INDEX && INDEX.six) || null;
  const SIX_NETS = (SIX && SIX.nets) || [];
  /* 跨网条目（顶层部署 / 协调机制 / 投融资）不属于任何单张网，单独一个标签。
     「逐张看」只画六张网，但筛选器与徽标要把它算进来，否则这类最重要的条目在专题页里反而找不到。 */
  const SIX_UMB = (SIX && SIX.umbrella) || null;
  const SIX_TAGS = (SIX_UMB ? [SIX_UMB] : []).concat(SIX_NETS);
  const sixState = { net: "all" };

  /* 「全部」指命中六张网的条目，不是条目库里的全部条目 —— 这个专题页只关心
     与六张网相关的条目，把 132 条一般条目都列出来就失去专题的意义了。 */
  function hasNet(it, key) {
    if (key === "all") return (it.nets || []).length > 0;
    return (it.nets || []).indexOf(key) >= 0;
  }
  function sixCount(key) {
    return ALL.filter(function (i) { return hasNet(i, key); }).length;
  }
  /* 指向机构官网首页（需站内检索）还是精确原文 —— 别把首页伪装成原文链接 */
  function isHomeUrl(u) {
    return /^https?:\/\/[^/]+\/?$/.test(u || "");
  }

  /* 条目详情里标注该条目命中的「六张网」，便于从条目反查专题归属 */
  function netBadges(it, limit) {
    const ks = (it.nets || []).slice(0, limit || 6);
    if (!ks.length) return "";
    return ks.map(function (k) {
      const n = SIX_TAGS.filter(function (x) { return x.key === k; })[0];
      return '<span class="badge six" title="该条目被判定为「六张网」相关">六张网 · ' +
        esc(n ? n.name : k) + "</span>";
    }).join("");
  }

  function renderSix() {
    const up = $("#six-updated");
    if (up) up.textContent = SIX && SIX.updated_at ? "口径更新 " + SIX.updated_at : "";

    if (!SIX || !SIX_NETS.length) {
      const box = $("#six-intro");
      if (box) {
        box.innerHTML = '<div class="empty">六张网专题数据未加载：请确认 <code>agent/six_networks.json</code> 存在，' +
          "并重新运行 <code>python3 agent/build_data.py</code>。</div>";
      }
      ["#six-indicators", "#six-nets", "#six-timeline", "#six-docs", "#six-items",
       "#six-verdicts", "#six-phases", "#six-toolbox", "#six-mandates", "#six-watch",
       "#six-actions", "#six-moves",
       "#six-sizing", "#six-bars", "#six-matrix", "#six-plays", "#six-risks"].forEach(function (s) {
        const e = $(s); if (e) e.innerHTML = "";
      });
      return;
    }

    /* ---- 口径 ---- */
    const inv = SIX.investment || {};
    $("#six-intro").innerHTML =
      '<div class="six-intro">' +
        "<div>" +
          "<h3>" + esc(SIX.title) + "</h3>" +
          '<p class="six-def">' + esc(SIX.definition) + "</p>" +
          '<p class="six-origin">' + esc(SIX.origin) + "</p>" +
        "</div>" +
        '<div class="six-invest">' +
          '<div class="si-t">投资规模</div>' +
          '<div class="si-big">' + esc(inv.total || "—") + "</div>" +
          "<ul>" + [inv.y2026, inv.multiplier].filter(Boolean).map(function (x) {
            return "<li>" + esc(x) + "</li>";
          }).join("") + "</ul>" +
          (inv.note ? '<p class="si-note">' + esc(inv.note) + "</p>" : "") +
        "</div>" +
      "</div>";

    /* ---- 关键指标 ---- */
    $("#six-indicators").innerHTML = (SIX.indicators || []).map(function (k) {
      return '<div class="ov-card"><div class="n si-num">' + esc(k.v) + "</div>" +
        '<div class="l">' + esc(k.k) + "</div>" +
        '<div class="d">' + esc(k.note) + "</div></div>";
    }).join("");

    /* ---- 六张网逐张 ---- */
    $("#six-nets").innerHTML = SIX_NETS.map(function (n) {
      const cnt = sixCount(n.key);
      return '<article class="net-card">' +
        '<div class="net-head"><span class="net-name">' + esc(n.name) + "</span>" +
          '<span class="net-en">' + esc(n.en || "") + "</span></div>" +
        '<div class="net-org">主管：' + esc(n.authority || "—") + "</div>" +
        '<p class="net-scope">' + esc(n.scope) + "</p>" +
        '<div class="net-row"><span class="net-k">建设规模</span><span class="net-v">' + esc(n.scale) + "</span></div>" +
        '<div class="net-row"><span class="net-k">智能化要点</span><span class="net-v">' + esc(n.smart) + "</span></div>" +
        '<div class="net-row net-opp"><span class="net-k">落地机会</span><span class="net-v">' + esc(n.opportunity) + "</span></div>" +
        '<div class="net-foot"><button type="button" class="btn sm ghost" data-net="' + esc(n.key) + '">' +
          "相关情报 " + cnt + " 条 →</button></div>" +
      "</article>";
    }).join("");

    /* ---- 政策脉络 ---- */
    $("#six-timeline").innerHTML = (SIX.timeline || []).map(function (t, i) {
      return '<div class="fc"><div class="fn">' + (i + 1) + "</div>" +
        "<h4><span class=\"badge\">" + esc(t.date) + (t.tag ? " · " + esc(t.tag) : "") + "</span> " +
        esc(t.title) + "</h4><p>" + esc(t.body) +
        (t.url ? ' <a class="tl-src" href="' + esc(t.url) + '" target="_blank" rel="noopener">原文</a>' : "") +
        "</p></div>";
    }).join("");

    /* ---- 主干政策清单 ---- */
    const docs = SIX.documents || [];
    $("#six-doc-count").textContent = docs.length;
    $("#six-docs").innerHTML = docs.map(function (d) {
      const home = isHomeUrl(d.url);
      return '<article class="doc-card">' +
        '<div class="doc-head"><span class="doc-date">' + esc(d.date) + "</span>" +
          "<span>" + esc(d.org) + "</span></div>" +
        "<h4>" + esc(d.title) + "</h4>" +
        '<ul class="doc-points">' + (d.points || []).map(function (p) {
          return "<li>" + esc(p) + "</li>";
        }).join("") + "</ul>" +
        (d.url
          ? '<div class="doc-src">' + (home ? '<span class="src-kind">官网</span>' : "") +
            '<a href="' + esc(d.url) + '" target="_blank" rel="noopener">' +
            (home ? "在机构官网检索原文" : "查看原文") + "</a></div>"
          : "") +
      "</article>";
    }).join("");

    /* ---- 政策分析 ---- */
    const AN = SIX.analysis || {};
    setText("#six-analysis-desc", AN.desc);
    setText("#six-phase-title", AN.phase_title);
    setText("#six-toolbox-title", AN.toolbox_title);
    setText("#six-mandates-title", AN.mandates_title);
    setText("#six-mandates-note", AN.mandates_note);
    setText("#six-watch-title", AN.watch_title);

    $("#six-verdicts").innerHTML = (AN.verdicts || []).map(function (v) {
      return '<article class="verdict"><div class="vn">' + esc(v.n) + "</div>" +
        "<h4>" + esc(v.h) + "</h4><p>" + esc(v.p) + "</p></article>";
    }).join("");

    $("#six-phases").innerHTML = (AN.phases || []).map(function (p) {
      return '<div class="phase-card"><div class="pt">' + esc(p.tag) + "</div>" +
        "<h4>" + esc(p.name) + '</h4><div class="pd">' + esc(p.period) + "</div>" +
        "<p>" + esc(p.body) + "</p>" +
        (p.signal ? '<div class="psig">观察点：' + esc(p.signal) + "</div>" : "") +
        "</div>";
    }).join("");

    /* data-label 供窄屏把表格折成卡片（见 style.css 的 ≤720px 段），空值不能省。 */
    const cells = function (pairs) {
      return pairs.map(function (p) {
        return '<td data-label="' + esc(p[0]) + '">' + esc(p[1]) + "</td>";
      }).join("");
    };
    $("#six-toolbox").innerHTML = (AN.toolbox || []).map(function (t) {
      return "<tr>" + cells([["工具类型", t.k], ["文件形态", t.v],
        ["决定什么", t.effect], ["对我们的用法", t.use]]) + "</tr>";
    }).join("");

    $("#six-mandates").innerHTML = (AN.mandates || []).map(function (m) {
      return '<article class="mandate"><h5>' + esc(m.k) + "</h5><p>" + esc(m.v) +
        '</p><div class="msrc">出处：' + esc(m.src) + "</div></article>";
    }).join("");

    $("#six-watch").innerHTML = (AN.watch || []).map(function (w) {
      return "<li>" + esc(w) + "</li>";
    }).join("");

    /* ---- 市场洞察 ---- */
    const IN = SIX.insight || {};

    /* 「我们能做什么」在页面上是独立一节（位于上部，页内目录第一项），数据仍来自 insight */
    setText("#six-actions-title", IN.actions_title);
    setText("#six-actions-note", IN.actions_note);
    setText("#six-moves-title", IN.moves_title);

    const STANCE = { "主攻": "s-main", "跟随": "s-follow", "不碰": "s-skip" };
    $("#six-actions").innerHTML = (IN.actions || []).map(function (a) {
      const cls = STANCE[a.stance] || "s-follow";
      return '<article class="act ' + cls + '">' +
        '<div class="act-head"><span class="stance ' + cls + '">' + esc(a.stance) + "</span>" +
          "<h4>" + esc(a.h) + '</h4><span class="act-net">' + esc(a.net) + "</span></div>" +
        '<div class="act-row"><span class="act-k">交付物</span>' +
          '<span class="act-v">' + esc(a.sell) + "</span></div>" +
        '<div class="act-row"><span class="act-k">客户与资金</span>' +
          '<span class="act-v">' + esc(a.buyer) + "</span></div>" +
        '<div class="act-row"><span class="act-k">门槛与窗口</span>' +
          '<span class="act-v">' + esc(a.gate) + "</span></div>" +
      "</article>";
    }).join("");

    $("#six-moves").innerHTML = (IN.moves || []).map(function (m) {
      return '<article class="move-card"><div class="mn">' + esc(m.n) + "</div>" +
        "<h4>" + esc(m.h) + "</h4><p>" + esc(m.p) + "</p></article>";
    }).join("");

    setText("#six-insight-desc", IN.desc);
    setText("#six-sizing-title", IN.sizing_title);
    setText("#six-sizing-note", IN.sizing_note);
    setText("#six-bars-title", IN.bars_title);
    setText("#six-matrix-title", IN.matrix_title);
    setText("#six-matrix-note", IN.matrix_note);
    setText("#six-plays-title", IN.plays_title);
    setText("#six-risks-title", IN.risks_title);
    setText("#six-caveat", IN.caveat);

    $("#six-sizing").innerHTML = (IN.sizing || []).map(function (s) {
      return '<div class="ov-card"><div class="n si-num">' + esc(s.v) + "</div>" +
        '<div class="l">' + esc(s.k) + '</div><div class="d">' + esc(s.note) + "</div></div>";
    }).join("");

    const bars = IN.bars || [];
    const maxV = bars.reduce(function (m, b) { return Math.max(m, b.v || 0); }, 0) || 1;
    $("#six-bars").innerHTML = bars.map(function (b) {
      const w = b.v ? Math.max(8, Math.round((b.v / maxV) * 100)) : 100;
      return '<div class="bar-row"><div class="bar-label">' + esc(b.label) + "</div>" +
        '<div class="bar-mid"><div class="bar-track"><i' + (b.v ? "" : ' class="zero"') +
        ' style="width:' + w + '%"></i></div>' +
        (b.note ? '<div class="bar-note">' + esc(b.note) + "</div>" : "") + "</div>" +
        '<div class="bar-val">' + esc(b.text) + "</div></div>";
    }).join("");

    const certCls = { "高": "c-hi", "中高": "c-mh", "中": "c-mid" };
    $("#six-matrix").innerHTML = (IN.matrix || []).map(function (m) {
      return "<tr>" +
        '<td data-label="机会">' + esc(m.opp) + "</td>" +
        '<td data-label="所属网">' + esc(m.net) + "</td>" +
        '<td data-label="政策依据">' + esc(m.basis) + "</td>" +
        '<td data-label="确定性"><span class="cert ' + (certCls[m.cert] || "c-mid") + '">' +
          esc(m.cert) + "</span></td>" +
        '<td data-label="切入方式">' + esc(m.entry) + "</td>" +
      "</tr>";
    }).join("");

    $("#six-plays").innerHTML = (IN.plays || []).map(function (p) {
      return '<article class="play-card"><div class="pn">' + esc(p.n) + "</div>" +
        "<h4>" + esc(p.h) + "</h4><p>" + esc(p.p) + "</p></article>";
    }).join("");

    $("#six-risks").innerHTML = (IN.risks || []).map(function (r, i) {
      return '<article class="risk"><div class="rh"><span class="rw">R' + (i + 1) +
        '</span><h5>' + esc(r.h) + "</h5></div><p>" + esc(r.p) + "</p></article>";
    }).join("");

    /* ---- 相关情报 ---- */
    $("#six-filter").innerHTML = [["all", "全部", sixCount("all")]]
      .concat(SIX_TAGS.map(function (n) { return [n.key, n.name, sixCount(n.key)]; }))
      .map(function (r) {
        return '<button class="chip' + (sixState.net === r[0] ? " on" : "") +
          '" data-net-filter="' + esc(r[0]) + '">' + esc(r[1]) + '<span class="c">' + r[2] + "</span></button>";
      }).join("");

    $$("[data-net-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        sixState.net = b.getAttribute("data-net-filter");
        runSixFilter();
      });
    });
    $$("[data-net]").forEach(function (b) {
      b.addEventListener("click", function () {
        sixState.net = b.getAttribute("data-net");
        runSixFilter();
        const t = $("#six-items");
        if (t && t.scrollIntoView) t.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    runSixFilter();
  }

  function runSixFilter() {
    $$("[data-net-filter]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-net-filter") === sixState.net);
    });
    const cur = SIX_TAGS.filter(function (n) { return n.key === sixState.net; })[0];
    const list = ALL.filter(function (i) { return hasNet(i, sixState.net); })
      .sort(function (a, b) { return (b.date || "").localeCompare(a.date || "") || b.relevance - a.relevance; });

    const desc = cur ? (cur.scope || cur.note || "") : "";
    $("#six-result").innerHTML = "共 <b>" + list.length + "</b> 条" +
      (cur ? "　·　" + esc(cur.name) + (desc ? "：" + esc(desc).slice(0, 40) + "…" : "") : "");
    $("#six-items").innerHTML = list.length
      ? list.map(intelCard).join("")
      : '<div class="empty">本站已收录条目中暂未命中该网。六张网的归口部门（水利部、国家能源局、' +
        "工业和信息化部、国家发展改革委、国家数据局等）已纳入采集范围，但发布频率低于住建系统，" +
        "收录量会随每周采集逐步累积。</div>";
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
      "<div>" + tierBadge(it) + levelBadge(it) + trackBadges(it, 6) + netBadges(it) + "</div>" +
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

    const cs = n.conclusions || [];
    html += '<div class="block"><h4>核心结论' +
      (b.meta.narrative_mode === "llm" ? '<span class="narr-tag">模型草稿</span>' : "") +
      "</h4>" + (cs.length
        ? '<div class="concl" style="box-shadow:none;padding:6px 0"><ol>' +
          cs.map(function (c) {
            return "<li><b>" + esc(c.title) + "</b>" + esc(c.body) + "</li>";
          }).join("") + "</ol></div>"
        : '<div class="empty">本期尚未生成核心结论。</div>') + "</div>";

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
      const cs = b.conclusions || [];
      return '<article class="intel">' +
        '<div>' + kind + '<span class="badge">' + b.total + " 条</span></div>" +
        '<h3><a href="brief.html?id=' + encodeURIComponent(b.id) + '">' + esc(b.title) + "</a></h3>" +
        '<div class="info">时间窗口 ' + esc(b.period) + "　·　生成于 " + esc(b.generated_at) + "</div>" +
        '<p class="sum">' + (cs.length ? esc(cs[0].body)
          : '<span style="color:var(--muted)">本期核心结论待生成</span>') + "</p>" +
        '<div class="mini-stats">' +
          '<span class="ms-focus">重点关注 <b>' + (tier.focus || 0) + "</b></span>" +
          '<span class="ms-track">持续跟踪 <b>' + (tier.track || 0) + "</b></span>" +
          '<span class="ms-watch">一般了解 <b>' + (tier.watch || 0) + "</b></span>" +
          (b.insights ? '<span style="margin-left:auto">影响分析 <b>' + b.insights + "</b> 条</span>" : "") +
        "</div>" +
        '<div class="actions"><a class="btn sm" href="brief.html?id=' + encodeURIComponent(b.id) + '">打开简报</a>' +
          '<button type="button" class="btn sm ghost dl-open" data-dock-open="' + esc(b.id) + '">↓ 下载</button></div>' +
      "</article>";
    }).join("");
  }

  /* ============================================================ 启动 */
  function boot() {
    const page = document.body.dataset.page;
    try {
      if (page === "home") renderHome();
      else if (page === "items") renderItems();
      else if (page === "six") renderSix();
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
