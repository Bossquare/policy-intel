/* ==========================================================================
   建筑智能化市场洞察·政策情报分析 —— 简报导出（PDF / HTML）
   --------------------------------------------------------------------------
   依赖：
     window.INTEL_SITE       站点数据（assets/data/site-data.js）
     window.INTEL_A4_ASSETS  版式样式与内联徽标（assets/data/a4-assets.js，构建产物）
   对外接口（供 app.js 调用）：
     INTEL_EXPORT.pdf(id)     下载 / 导出 PDF
     INTEL_EXPORT.html(id)    下载自包含 HTML
     INTEL_EXPORT.print(id)   直接唤起打印
     INTEL_EXPORT.open(id)    打开导出预览页
   页面为 export.html 时自动渲染版式；?print=1 渲染后自动唤起打印对话框。
   另外在简报相关页面自动挂载右下角浮动下载入口（.dl-dock）。
   ========================================================================== */
(function () {
  "use strict";

  var SITE = window.INTEL_SITE;
  var ASSETS = window.INTEL_A4_ASSETS || {};

  var TIERS = {
    focus: { label: "重点关注", cls: "tf", desc: "与主营赛道强相关，建议本周内研读并落到具体动作" },
    track: { label: "持续跟踪", cls: "tt", desc: "相关但不紧急，纳入跟踪清单，出现后续文件时评估" },
    watch: { label: "一般了解", cls: "tw", desc: "行业氛围与生态信息，了解即可" }
  };
  var LEVELS = {
    national: "国家层面", "key-city": "重点省市", other: "其他省市", industry: "行业层面"
  };
  var CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

  /* ---------------------------------------------------------------- 工具 */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function qs(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }
  function trackLabel(brief, key) {
    var t = (brief && brief.tracks) || (SITE && SITE.index && SITE.index.tracks) || {};
    return (t[key] || {}).label || key;
  }
  function safeName(s) {
    return String(s || "brief").replace(/[\\/:*?"<>|\r\n\t]/g, "-").replace(/\s+/g, " ").trim();
  }
  /* 把「2026-09-07 至 2026-09-13」里的两端日期变成不可断行的原子片段，
     避免排版时把 2026-09-13 拆到下一行。 */
  function periodHtml(p) {
    var s = String(p || "").trim();
    if (!s) return "-";
    var m = /^(.*?)(\s*至\s*)(.*)$/.exec(s);
    if (!m) return '<span class="dt">' + esc(s) + "</span>";
    return '<span class="dt">' + esc(m[1]) + "</span>" + esc(m[2]) +
      '<span class="dt">' + esc(m[3]) + "</span>";
  }
  function briefOf(id) {
    return SITE && SITE.briefs ? SITE.briefs[id] : null;
  }
  /* docHtml / standalone 接受「期号」或「简报对象」，避免误传字符串时静默生成空文档 */
  function asBrief(x) {
    if (x && typeof x === "object") return x;
    return briefOf(x);
  }
  function hasAssets() {
    return !!(ASSETS.css && ASSETS.css.length > 500);
  }
  function briefMeta(id) {
    var list = (SITE && SITE.index && SITE.index.briefs) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function pdfPath(id) { return "assets/briefs/" + id + ".pdf"; }

  /* ---------------------------------------------------------------- 提示条 */
  function toast(msg, ms) {
    var el = document.getElementById("a4-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "a4-toast";
      el.style.cssText =
        "position:fixed;left:50%;bottom:78px;transform:translateX(-50%) translateY(12px);z-index:200;" +
        "max-width:min(560px,88vw);background:#0f2c4d;color:#fff;font-size:13px;line-height:1.6;" +
        "padding:10px 16px;border-radius:9px;box-shadow:0 8px 26px rgba(0,0,0,.32);" +
        "opacity:0;pointer-events:none;transition:.22s ease;text-align:center;" +
        "font-family:\"PingFang SC\",\"Microsoft YaHei\",-apple-system,sans-serif;";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(function () {
      el.style.opacity = "1";
      el.style.transform = "translateX(-50%) translateY(0)";
    });
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(12px)";
    }, ms || 3600);
  }

  /* ------------------------------------------------------------ 版式生成 */
  /* logo.svg 自身不带尺寸，需注入 .dh-logo（44px）否则在文档头里不显示 */
  function logoHtml() {
    var svg = ASSETS.logo || "";
    if (!svg) return "";
    var m = /<svg\b[^>]*>/.exec(svg);
    if (!m) return svg;
    var tag = m[0];
    if (/\bclass\s*=/.test(tag)) return svg;
    return svg.replace(tag, tag.slice(0, -1) + ' class="dh-logo">');
  }

  function itemCard(brief, it, mode) {
    var t = TIERS[it.tier] || TIERS.watch;
    var h = '<article class="d-item ' + t.cls + (mode === "mini" ? " compact" : "") + '">';

    h += '<div class="d-tags">' +
      '<span class="d-tag ' + t.cls + '">' + t.label + "</span>" +
      (it.region || LEVELS[it.level]
        ? '<span class="d-tag">' + esc(it.region || LEVELS[it.level]) + "</span>" : "") +
      (it.form && mode !== "mini" ? '<span class="d-tag">' + esc(it.form) + "</span>" : "") +
      (it.tracks || []).slice(0, mode === "full" ? 3 : 2).map(function (k) {
        return '<span class="d-tag">' + esc(trackLabel(brief, k)) + "</span>";
      }).join("") +
      '<span class="d-tag no">#' + it.no + "　相关性 " + it.relevance + "</span>" +
      "</div>";

    h += "<h3>" + esc(it.title) + "</h3>";
    h += '<div class="d-info">' + esc(it.org) + "　·　" + esc(it.date || it.date_raw || "") + "</div>";
    h += '<p class="d-sum">' + esc(it.summary) + "</p>";

    if (mode === "full" && it.impact) {
      h += '<div class="d-sub imp"><b>影响分析</b>' + esc(it.impact) + "</div>";
    }
    if (mode === "full" && it.action) {
      h += '<div class="d-sub act"><b>应对建议</b>' + esc(it.action) + "</div>";
    }
    if (mode === "mid" && it.impact) {
      h += '<div class="d-sub imp"><b>影响分析</b>' + esc(it.impact) + "</div>";
    }

    var sp = it.source || {};
    if (sp.url && mode !== "mini") {
      h += '<div class="d-src"><b>来源</b> ' + esc(sp.label || "") +
        '　<span class="u">' + esc(sp.url) + "</span>" +
        (sp.kind === "list" ? "　（栏目页，需按标题或文号检索）" : "") +
        "　·　可信度 " + esc(it.confidence || "未标注") + "</div>";
    }

    h += "</article>";
    return h;
  }

  /* 生成 .a4-doc 的内部 HTML */
  function docInner(brief) {
    var m = brief.meta || {};
    var n = brief.narrative || {};
    var st = (brief.stats && brief.stats.by_tier) || {};
    var items = brief.items || [];
    var byTier = { focus: [], track: [], watch: [] };
    items.forEach(function (i) { (byTier[i.tier] || byTier.watch).push(i); });
    ["focus", "track", "watch"].forEach(function (k) {
      byTier[k].sort(function (a, b) { return b.relevance - a.relevance; });
    });

    var h = "";
    var sec = 0;
    function secHead(title, en, extra) {
      sec++;
      return '<div class="ds"><h2>' + CN[(sec - 1) % 10] + "、" + esc(title) +
        (en ? "<em>" + esc(en) + "</em>" : "") +
        (extra ? '<span class="n">' + esc(extra) + "</span>" : "") + "</h2>";
    }

    /* —— 文档头 —— */
    h += '<header class="dh">' + logoHtml() +
      '<div class="dh-txt"><div class="dh-org">建筑智能化市场洞察·政策情报分析' +
      "<i>MARKET &amp; POLICY INSIGHT</i></div></div>" +
      '<div class="dh-date">简报导出<br>' + esc(m.generated_at || "") + "</div>" +
      "</header>";

    h += '<h1 class="d-title">' + esc(m.title || "情报简报") + "</h1>";

    h += "<dl class=\"d-meta\">" +
      "<div><dt>时间窗口</dt><dd>" + periodHtml(m.period) + "</dd></div>" +
      "<div><dt>生成日期</dt><dd>" + esc(m.generated_at || "-") + "</dd></div>" +
      "<div><dt>收录条目</dt><dd>" + items.length + " 条</dd></div>" +
      "<div><dt>影响分析</dt><dd>" + (m.insight_count || 0) + " 条</dd></div>" +
      "</dl>";

    h += '<div class="d-strip">' +
      '<span class="s-focus">重点关注 <b>' + (st.focus || 0) + "</b></span>" +
      '<span class="s-track">持续跟踪 <b>' + (st.track || 0) + "</b></span>" +
      '<span class="s-watch">一般了解 <b>' + (st.watch || 0) + "</b></span>" +
      "</div>";

    if (m.note) h += '<div class="d-note" style="margin-top:9px">' + esc(m.note) + "</div>";

    /* —— 一、核心结论 —— */
    if ((n.conclusions || []).length) {
      h += secHead("核心结论", "KEY FINDINGS", (n.conclusions || []).length + " 条");
      h += '<ol class="d-concl">' + n.conclusions.map(function (c) {
        return "<li><b>" + esc(c.title) + "</b>" + esc(c.body) + "</li>";
      }).join("") + "</ol></div>";
    }

    /* —— 各档条目 —— */
    [["focus", "重点条目", "FOCUS", "full"],
     ["track", "持续跟踪", "TRACK", "mid"],
     ["watch", "一般了解", "WATCH", "mini"]].forEach(function (cfg) {
      var list = byTier[cfg[0]];
      if (!list.length) return;
      h += secHead(cfg[1], cfg[2], list.length + " 条");
      h += '<p class="ds-desc">' + esc(TIERS[cfg[0]].desc) + "</p>";
      h += '<div class="d-list' + (cfg[3] === "mini" ? " two" : "") + '">' +
        list.map(function (it) { return itemCard(brief, it, cfg[3]); }).join("") +
        "</div></div>";
    });

    /* —— 市场影响分析 —— */
    if ((n.impacts || []).length) {
      h += secHead("市场影响分析", "IMPACT ANALYSIS", (n.impacts || []).length + " 条");
      h += '<div class="d-matrix">' + n.impacts.map(function (x) {
        return '<div class="d-mx"><h3>' + esc(x.title) + "</h3>" +
          (x.level ? '<div class="d-lv">' + esc(x.level) + "</div>" : "") +
          "<p>" + esc(x.body) + "</p></div>";
      }).join("") + "</div></div>";
    }

    /* —— 趋势展望 —— */
    if ((n.outlook || []).length) {
      h += secHead("趋势展望", "OUTLOOK", (n.outlook || []).length + " 条");
      h += '<div class="d-future">' + n.outlook.map(function (x) {
        return '<div class="d-fc"><div class="d-fn">' + x.no + "</div><h3>" + esc(x.title) +
          "</h3><p>" + esc(x.body) + "</p></div>";
      }).join("") + "</div></div>";
    }

    /* —— 附表：全部条目明细 —— */
    h += secHead("附录：本期条目明细", "APPENDIX", items.length + " 条");
    h += '<table class="d-tbl"><colgroup>' +
      '<col style="width:4.5%"><col style="width:7.5%"><col style="width:10.5%"><col style="width:6.5%">' +
      '<col style="width:35%"><col style="width:9.5%"><col style="width:5.5%"><col style="width:21%">' +
      "</colgroup><thead><tr>" +
      "<th>序号</th><th>档级</th><th>发布机构</th><th>日期</th><th>名称</th><th>形式</th>" +
      "<th>相关性</th><th>来源</th></tr></thead><tbody>";
    h += items.slice().sort(function (a, b) { return (a.no || 0) - (b.no || 0); }).map(function (i) {
      var sp = i.source || {};
      var host = sp.label || (sp.url ? sp.url.split("/")[2] : "") || "-";
      return "<tr><td class=\"n\">" + i.no + "</td>" +
        '<td class="tier ' + i.tier + '">' + (TIERS[i.tier] || TIERS.watch).label + "</td>" +
        "<td>" + esc(i.org) + "</td>" +
        '<td class="n">' + esc(i.date_raw || i.date || "") + "</td>" +
        "<td>" + esc(i.title) + "</td>" +
        "<td>" + esc(i.form) + "</td>" +
        '<td class="n">' + i.relevance + "</td>" +
        '<td class="src">' + esc(host) + (sp.kind === "list" ? "（栏目页）" : "") + "</td></tr>";
    }).join("");
    h += "</tbody></table></div>";

    /* —— 文末声明 —— */
    h += '<footer class="d-foot">' +
      "<div><b>建筑智能化市场洞察·政策情报分析</b>本简报按期冻结归档，内容不再回改，历史可追溯。</div>" +
      "<div><b>数据说明</b>条目检索自公开渠道，链接可用性定期体检；正式决策请以官方原文为准。</div>" +
      "</footer>";

    return h;
  }

  /* 下载 HTML 时追加的基础样式（跟随内联的 A4 样式之后） */
  var EXTRA_CSS =
    "\nhtml,body{margin:0;padding:0;background:#5b6472}\n" +
    "@media print{html,body{background:#fff}}\n";

  function docHtml(brief) {
    var b = asBrief(brief);
    if (!b) return '<div class="a4-doc"></div>';
    return '<div class="a4-doc">' + docInner(b) + "</div>";
  }

  /* 自包含 HTML：内联 A4 样式与徽标，双击即可离线打开 */
  function standaloneHtml(brief) {
    var b = asBrief(brief);
    if (!b) return "";
    var css = ASSETS.css || "";
    // 兜底：构建产物缺失时至少挂上外部样式，避免导出文件完全无版式
    var styleBlock = css
      ? "<style>\n" + css + "\n" + EXTRA_CSS + "</style>"
      : '<link rel="stylesheet" href="assets/css/a4.css">';
    var title = (b.meta && b.meta.title) || "情报简报";
    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<meta name="generator" content="建筑智能化市场洞察·政策情报分析 · 简报导出">\n' +
      "<title>" + esc(title) + "</title>\n" + styleBlock + "\n</head>\n" +
      '<body class="a4-screen">\n' +
      '<div class="a4-stage">' + docHtml(b) + "</div>\n</body>\n</html>\n";
  }

  /* ------------------------------------------------------------ 下载实现 */
  function saveBlob(text, filename, mime) {
    try {
      var blob = new Blob([text], { type: mime + ";charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      return true;
    } catch (e) { return false; }
  }

  function directDownload(url, filename) {
    var a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function saveHtml(id) {
    var b = asBrief(id);
    if (!b) { toast("未找到该期简报：" + id); return false; }
    var ok = saveBlob(standaloneHtml(b), safeName(b.meta.title) + ".html", "text/html");
    toast(ok
      ? "已开始下载：" + safeName(b.meta.title) + ".html（单文件，双击即可离线打开）"
      : "浏览器拒绝了本地下载，请改用「打印」并另存为 PDF");
    return ok;
  }

  function onExportPage() { return document.body && document.body.dataset.page === "export"; }

  function openPrintView(id) {
    if (onExportPage()) { window.print(); return; }
    var w = window.open("export.html?id=" + encodeURIComponent(id) + "&print=1", "_blank");
    if (!w) { toast("浏览器拦截了新窗口，请允许弹窗后重试"); return; }
    toast("已打开导出预览，在打印对话框中把「目标」选为「另存为 PDF」即可", 5200);
  }

  function savePdf(id) {
    var meta = briefMeta(id);
    var b = briefOf(id);
    if (!b) { toast("未找到该期简报：" + id); return; }

    if (meta && meta.pdf === true) {
      directDownload(pdfPath(id), safeName(b.meta.title) + ".pdf");
      toast("已开始下载 PDF：" + safeName(b.meta.title) + ".pdf");
      return;
    }
    if (meta && meta.pdf === false) { openPrintView(id); return; }

    // 索引未标注（老数据）：在线时探测一次静态 PDF 是否存在
    if (/^https?:$/.test(location.protocol)) {
      fetch(pdfPath(id), { method: "GET", headers: { Range: "bytes=0-0" } })
        .then(function (r) {
          if (r && r.ok) {
            directDownload(pdfPath(id), safeName(b.meta.title) + ".pdf");
            toast("已开始下载 PDF：" + safeName(b.meta.title) + ".pdf");
          } else { openPrintView(id); }
        })
        .catch(function () { openPrintView(id); });
    } else {
      openPrintView(id);
    }
  }

  /* ------------------------------------------------------ 浮动下载入口 */
  /* 在简报相关页面右下角常驻一个下载坞：不随页面滚动，任何位置都能下载 */
  var DOCK_PAGES = { briefs: 1, brief: 1 };
  var DL_ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M8 1.7v8.1M4.7 6.7 8 10l3.3-3.3M2.7 12.7h10.6" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    'stroke-linejoin="round"/></svg>';

  /* 「2026-09-07 至 2026-09-13」→「9.7–9.13」，坞内一行放得下 */
  function shortPeriod(p) {
    var m = /(\d{4})-(\d{2})-(\d{2})\s*至\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(p || ""));
    if (!m) return String(p || "");
    return (+m[2]) + "." + (+m[3]) + "–" + (+m[5]) + "." + (+m[6]);
  }

  function dockRowsHtml() {
    var list = (SITE && SITE.index && SITE.index.briefs) || [];
    /* 只有简报详情页才有「当前浏览」这一说 */
    var cur = (document.body.dataset.page === "brief")
      ? (qs("id") || ((list[0] || {}).id || "")) : "";
    return list.map(function (b) {
      var kind = /-W\d+/.test(b.id) ? "周报" : "月报";
      var per = shortPeriod(b.period);
      var safe = esc(b.id);
      return '<div class="dl-dock-row' + (b.id === cur ? " cur" : "") + '" data-brief="' + safe + '">' +
        '<div class="dl-dock-meta">' +
          "<b>" + safe + "</b>" +
          "<i>" + kind + (per ? " · " + esc(per) : "") + "</i>" +
          (b.id === cur ? "<em>当前浏览</em>" : "") +
        "</div>" +
        '<div class="dl-dock-btns">' +
          '<button type="button" class="dl-b pdf" data-dl="pdf" data-brief="' + safe + '" ' +
            'title="下载 PDF' + (b.pdf === true ? "" : "（将打开导出预览，再另存为 PDF）") + '">' +
            "PDF</button>" +
          '<button type="button" class="dl-b html" data-dl="html" data-brief="' + safe + '" ' +
            'title="下载单文件 HTML，含全部样式，双击即可离线打开">HTML</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  function mountDock() {
    var page = document.body && document.body.dataset.page;
    if (!DOCK_PAGES[page] || document.getElementById("dl-dock")) return;
    if (!(SITE && SITE.index && SITE.index.briefs && SITE.index.briefs.length)) return;

    var dock = document.createElement("div");
    dock.className = "dl-dock";
    dock.id = "dl-dock";
    dock.innerHTML =
      '<div class="dl-dock-panel" role="dialog" aria-label="简报下载">' +
        '<div class="dl-dock-h">' +
          '<span class="dl-dock-ht">简报下载</span>' +
          '<span class="dl-dock-hs">选期次 · 选格式</span>' +
          '<button type="button" class="dl-dock-x" data-dock="close" aria-label="收起">&#10005;</button>' +
        "</div>" +
        '<div class="dl-dock-body">' + dockRowsHtml() + "</div>" +
        '<div class="dl-dock-f">HTML 为单文件，样式全部内联，可直接归档、转发或离线打开</div>' +
      "</div>" +
      '<button type="button" class="dl-dock-fab" data-dock="toggle" aria-expanded="false">' +
        DL_ARROW + "<span>下载简报</span>" +
      "</button>";
    document.body.appendChild(dock);
    document.body.classList.add("with-dl-dock");

    function clearHl() {
      [].forEach.call(dock.querySelectorAll(".dl-dock-row.hl"), function (r) {
        r.classList.remove("hl");
      });
    }

    function setOpen(v) {
      dock.classList[v ? "add" : "remove"]("on");
      var fab = dock.querySelector(".dl-dock-fab");
      if (fab) fab.setAttribute("aria-expanded", v ? "true" : "false");
      if (!v) clearHl();
    }

    dock.querySelector(".dl-dock-fab").addEventListener("click", function () {
      setOpen(!dock.classList.contains("on"));
    });
    dock.addEventListener("click", function (e) {
      var t = e.target;
      if (!(t && t.closest)) return;
      var cl = t.closest("[data-dock]");
      if (cl && cl.getAttribute("data-dock") === "close") { setOpen(false); return; }
      var b = t.closest("[data-dl]");
      if (!b) return;
      e.preventDefault();
      var id = b.getAttribute("data-brief");
      if (b.getAttribute("data-dl") === "pdf") savePdf(id);
      else saveHtml(id);
    });
    document.addEventListener("click", function (e) {
      if (dock.classList.contains("on") && !dock.contains(e.target)) setOpen(false);
    });
    /* 列表卡片上的「↓ 下载」：展开坞并高亮对应期次 */
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!(t && t.closest)) return;
      var o = t.closest("[data-dock-open]");
      if (!o) return;
      e.preventDefault();
      var id = o.getAttribute("data-dock-open");
      setOpen(true);
      var row = dock.querySelector('.dl-dock-row[data-brief="' + id + '"]');
      if (!row) return;
      clearHl();
      row.classList.add("hl");
      if (row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setOpen(false);
    });
  }

  /* ------------------------------------------------------------ 导出视图 */
  function renderExportView() {
    var id = qs("id") || ((SITE.index.briefs[0] || {}).id);
    var b = briefOf(id);
    var root = document.getElementById("a4-root");
    if (!root) return;

    if (!b) {
      root.innerHTML = '<div class="a4-doc" style="padding:80px 60px;text-align:center;color:#6b7280">' +
        "未找到该期简报：" + esc(id) + "</div>";
      return;
    }
    document.title = b.meta.title + " · 简报导出";
    root.innerHTML = docHtml(b);

    var t = document.getElementById("a4-bar-t");
    if (t) {
      t.innerHTML = esc(b.meta.id) + " 简报导出" +
        '<small>' + esc(b.meta.period || "") + "</small>";
    }
    var tip = document.getElementById("a4-tip");
    if (tip) {
      tip.textContent = b.meta.title +
        "　|　屏幕预览为连续长纸，打印或导出时自动分页";
    }

    var bar = document.querySelector(".a4-bar");
    if (bar) {
      bar.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
        if (!btn) return;
        var act = btn.getAttribute("data-act");
        if (act === "pdf") {
          if (briefMeta(id) && briefMeta(id).pdf === true) {
            savePdf(id);
          } else {
            toast("在打印对话框把「目标」选为「另存为 PDF」即可", 6000);
            setTimeout(function () { window.print(); }, 260);
          }
        } else if (act === "html") { saveHtml(id); }
        else if (act === "print") { window.print(); }
      });
    }

    if (qs("print")) setTimeout(function () { window.print(); }, 480);
  }

  /* ------------------------------------------------------------ 对外接口 */
  window.INTEL_EXPORT = {
    pdf: savePdf,
    html: saveHtml,
    print: function (id) {
      if (onExportPage()) { window.print(); return; }
      window.open("export.html?id=" + encodeURIComponent(id) + "&print=1", "_blank");
    },
    open: function (id) {
      location.href = "export.html?id=" + encodeURIComponent(id);
    },
    standalone: standaloneHtml,
    docHtml: docHtml,
    ready: hasAssets,
    dock: mountDock,
    toast: toast
  };

  if (!hasAssets()) {
    console.warn("[export] 未找到导出版式资源（assets/data/a4-assets.js）。" +
      "导出预览将缺少徽标，下载的 HTML 也不会内联样式。" +
      "请运行 python3 agent/build_data.py 重新生成。");
  }

  if (document.body && document.body.dataset.page === "export") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", renderExportView);
    } else { renderExportView(); }
  } else if (document.body && DOCK_PAGES[document.body.dataset.page]) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountDock);
    } else { mountDock(); }
  }
})();
