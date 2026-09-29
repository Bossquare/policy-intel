#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建站点数据。

输入：
    assets/data/brief-*.json           各期简报（extract_seed.py / build_weekly.py / run_weekly.py 产出）
    agent/insights.json                强相关条目的影响分析与应对建议（人工撰写）
    agent/source_fixes.json            来源链接人工修正表（改链接 / 标注栏目页 / 补备用来源）
    assets/data/source-health.json     来源链接健康检查结果（可选，由 check_sources.py 产出）
    各期 meta.narrative_source 指向的 HTML 报告（可选，抽取叙述）
输出：
    assets/data/brief-*.json           合并后的完整简报
    assets/data/index.json             站点索引（简报列表 + 全局统计）
    assets/data/site-data.js           前端唯一数据入口
    assets/data/a4-assets.js           A4 导出样式与内联徽标（由 a4.css / logo.svg 生成，
                                       供「下载 HTML」离线自包含使用）

简报排序：按覆盖周期的截止日降序（最新一期在前），而不是按 id 字典序——
这样周报（2026-W37）与月报（2026-09）混排时依然按时间先后排列。

用法：
    python3 agent/build_data.py
"""

import json
import re
import html as htmllib
import pathlib
import sys
from datetime import datetime, timezone, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "assets" / "data"
BRIEF = DATA / "brief-2026-09.json"
INSIGHTS = ROOT / "agent" / "insights.json"
SOURCE_FIXES = ROOT / "agent" / "source_fixes.json"
SOURCE_HEALTH = DATA / "source-health.json"
SIX_NETWORKS = ROOT / "agent" / "six_networks.json"
SEED = ROOT / "seed" / "2026-09-report.html"
INDEX = DATA / "index.json"
A4_CSS = ROOT / "assets" / "css" / "a4.css"
LOGO_SVG = ROOT / "assets" / "img" / "logo.svg"
PDF_DIR = ROOT / "assets" / "briefs"

SITE = {
    "title": "建筑智能化市场洞察·政策情报分析",
    "subtitle": "政策跟踪 · 标准动态 · 赛道研判",
    "owner": "Bossquare",
}


def strip_tags(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", htmllib.unescape(s)).strip()


def extract_narrative(raw: str):
    """从报告 HTML 抽出核心结论 / 市场影响分析 / 趋势展望。"""
    out = {"conclusions": [], "impacts": [], "outlook": []}

    m = re.search(r'class="concl"(.*?)</ol>', raw, re.S)
    if m:
        for li in re.findall(r"<li>(.*?)</li>", m.group(1), re.S):
            b = re.search(r"<b>(.*?)</b>", li, re.S)
            title = strip_tags(b.group(1)) if b else ""
            body = strip_tags(re.sub(r"<b>.*?</b>", "", li, flags=re.S))
            out["conclusions"].append({"title": title, "body": body})

    chunks = re.split(r'<div class="mx"[^>]*>', raw)[1:]
    for ch in chunks:
        h = re.search(r"<h4>(.*?)</h4>", ch, re.S)
        if not h:
            continue
        lv = re.search(r'<div class="lv">(.*?)</div>', ch, re.S)
        rest = ch[h.end():]
        rest = re.split(r"</section>", rest)[0]
        rest = re.sub(r'<div class="lv">.*?</div>', "", rest, flags=re.S)
        rest = re.sub(r"<h4>.*?</h4>", "", rest, flags=re.S)
        out["impacts"].append({
            "title": strip_tags(h.group(1)),
            "level": strip_tags(lv.group(1)) if lv else "",
            "body": strip_tags(rest),
        })

    for fn, h4, p in re.findall(
            r'<div class="fc"><div class="fn">(\d+)</div><h4>(.*?)</h4><p>(.*?)</p></div>', raw, re.S):
        out["outlook"].append({"no": int(fn), "title": strip_tags(h4), "body": strip_tags(p)})

    return out


def period_end(brief) -> str:
    """从 meta.period（如「2026-08-31 至 2026-09-06」）取截止日，用于跨期排序。"""
    m = re.search(r"(\d{4}-\d{2}-\d{2})\s*$", brief["meta"].get("period", ""))
    return m.group(1) if m else brief["meta"].get("generated_at", "")


def apply_source_fix(source: dict, fix: dict) -> dict:
    """把修正表条目应用到 source 字段上（不改动原报告抽取结果，随时可回退）。"""
    if not isinstance(fix, dict):
        return source
    if fix.get("url"):
        source["url"] = fix["url"]
        # 链接被替换后，label 若原为域名则同步域名
        host = fix["url"].split("//")[-1].split("/")[0]
        if source.get("label") and "/" not in source["label"]:
            source["label"] = host
    if fix.get("kind"):
        source["kind"] = fix["kind"]
    if fix.get("note"):
        source["note"] = fix["note"]
    if fix.get("alt"):
        source["alt"] = fix["alt"]
    return source


def main():
    files = sorted(DATA.glob("brief-*.json"))
    if not files:
        sys.exit("assets/data/ 下没有 brief-*.json，请先运行 extract_seed.py")

    insights = json.loads(INSIGHTS.read_text(encoding="utf-8")) if INSIGHTS.exists() else {}
    fixes = json.loads(SOURCE_FIXES.read_text(encoding="utf-8")) if SOURCE_FIXES.exists() else {}
    health_raw = json.loads(SOURCE_HEALTH.read_text(encoding="utf-8")) if SOURCE_HEALTH.exists() else {}
    health = health_raw.get("_items", {}) if isinstance(health_raw, dict) else {}
    now = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")

    fixed = 0
    briefs = []
    for path in files:
        b = json.loads(path.read_text(encoding="utf-8"))

        # 人工撰写的洞察优先覆盖自动生成的草稿
        merged = 0
        for it in b["items"]:
            ins = insights.get(it["id"])
            if ins and isinstance(ins, dict):
                if ins.get("impact"):
                    it["impact"] = ins["impact"]
                if ins.get("action"):
                    it["action"] = ins["action"]
            if it.get("impact"):
                merged += 1

            # 来源链接修正（链接替换 / 栏目页标注 / 备用来源）
            fix = fixes.get(it["id"])
            if fix and isinstance(it.get("source"), dict):
                apply_source_fix(it["source"], fix)
                fixed += 1

            # 链接健康状态（由 check_sources.py 探测产出，按 url 匹配）
            if it.get("source", {}).get("url"):
                st = health.get(it["source"]["url"])
                if st:
                    it["source"]["status"] = st.get("status")
                    it["source"]["checked_at"] = st.get("checked_at")

        # 叙述（核心结论 / 市场影响 / 趋势展望）按 meta 里声明的来源抽取
        ns = b["meta"].get("narrative_source")
        if ns and (ROOT / ns).exists():
            b["narrative"] = extract_narrative((ROOT / ns).read_text(encoding="utf-8"))

        b["meta"]["built_at"] = now
        b["meta"]["insight_count"] = merged
        b["meta"]["source_fixed"] = sum(1 for i in b["items"] if i["id"] in fixes)
        path.write_text(json.dumps(b, ensure_ascii=False, indent=2), encoding="utf-8")
        briefs.append(b)

    briefs.sort(key=lambda x: (period_end(x), x["meta"]["id"]), reverse=True)
    latest = briefs[0]

    counts = {"focus": 0, "track": 0, "watch": 0}
    for it in latest["items"]:
        counts[it["tier"]] = counts.get(it["tier"], 0) + 1

    def focus_preview(b):
        return [
            {"id": i["id"], "title": i["title"], "org": i["org"],
             "date": i["date"], "relevance": i["relevance"], "tracks": i["tracks"]}
            for i in sorted([x for x in b["items"] if x["tier"] == "focus"],
                            key=lambda x: -x["relevance"])[:6]
        ]

    # 已预渲染的 A4 静态 PDF（由 agent/build_pdf.py 产出），用于前端「一键下载 PDF」
    pdf_ids = {p.stem for p in PDF_DIR.glob("*.pdf")} if PDF_DIR.exists() else set()

    # ---- 「六张网」专题 ----------------------------------------------------
    # 口径、主干政策与关键词表都在 agent/six_networks.json（人工维护）。
    # 这里只做一件事：按关键词给条目打 nets 标签，供专题页分栏。
    # 标签只进 site-data / index，**不回写 brief-*.json**，避免历史数据被反复改动。
    six_raw = json.loads(SIX_NETWORKS.read_text(encoding="utf-8")) if SIX_NETWORKS.exists() else {}
    six_nets = six_raw.get("nets", [])
    # 跨网条目（顶层部署 / 协调机制 / 投融资 —— 如「国家发展改革委召开『六张网』重大项目协调推进会」）
    # 不属于任何单张网。不给它一个归宿的话，这类最重要的条目反而不会出现在专题页里。
    # 用独立的 umbrella 标签承载，不计入六张网各自的命中数，前端筛选项里单列一个「六网协同」。
    umbrella = six_raw.get("umbrella") or {}
    tag_defs = ([umbrella] if umbrella else []) + six_nets
    net_stats = {n["key"]: 0 for n in tag_defs}
    for b in briefs:
        for it in b["items"]:
            hay = " ".join([it.get("title", ""), it.get("summary", ""),
                            it.get("org", ""), it.get("region", "")])
            nets = [n["key"] for n in tag_defs
                    if any(w in hay for w in n.get("keywords", []))]
            it["nets"] = nets
            for k in nets:
                net_stats[k] = net_stats.get(k, 0) + 1

    six_out = dict(six_raw)
    six_out["stats"] = net_stats
    if umbrella:
        six_out["umbrella"] = {**{k: v for k, v in umbrella.items() if k != "keywords"},
                               "count": net_stats.get(umbrella["key"], 0)}
    # 关键词表只是打标签用的实现细节，不必发给前端
    six_out["nets"] = [{**{k: v for k, v in n.items() if k != "keywords"},
                        "count": net_stats.get(n["key"], 0)} for n in six_nets]

    index = {
        "site": SITE,
        "updated_at": now,
        "tracks": latest["tracks"],
        # 「六张网」政策专题（口径 / 六张网界定 / 关键指标 / 政策脉络 / 主干文件 / 条目命中统计）
        "six": six_out,
        "totals": {
            "items": len(latest["items"]),
            "focus": counts["focus"],
            "track": counts["track"],
            "watch": counts["watch"],
            "insights": latest["meta"]["insight_count"],
        },
        "briefs": [{
            "id": b["meta"]["id"],
            "title": b["meta"]["title"],
            "period": b["meta"]["period"],
            "generated_at": b["meta"]["generated_at"],
            "file": f"brief-{b['meta']['id']}.json",
            "total": len(b["items"]),
            "insights": b["meta"]["insight_count"],
            "stats": b["stats"],
            "conclusions": b.get("narrative", {}).get("conclusions", []),
            # 叙述来源：manual 人工撰写 / llm 模型草稿 / rule 规则兜底 / none 未生成
            "narrative_mode": b["meta"].get("narrative_mode",
                                            "manual" if b.get("narrative") and
                                            b["narrative"].get("conclusions") else "none"),
            "focus_preview": focus_preview(b),
            # A4 静态 PDF 是否已生成（true 直接下载；false 走「打印 → 另存为 PDF」）
            "pdf": b["meta"]["id"] in pdf_ids,
        } for b in briefs],
    }
    INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    # 前端入口：打包成单个 JS，双击本地文件打开也能跑（绕开 file:// 的 fetch 限制）
    payload = {
        "index": index,
        "briefs": {b["meta"]["id"]: b for b in briefs},
        "six": six_out,
        "source_health": {
            "checked_at": health_raw.get("_checked_at", ""),
            "items": health,
        },
    }
    (DATA / "site-data.js").write_text(
        "/* 由 agent/build_data.py 自动生成，请勿手改 */\n"
        "window.INTEL_SITE = " + json.dumps(payload, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )

    # A4 导出资源：把样式表与徽标内联成 JS，让「下载 HTML」产出的文件在没有
    # 网络、没有 assets/ 目录的情况下也能独立打开（file:// 下无法 fetch 外部文件）。
    css_text = A4_CSS.read_text(encoding="utf-8") if A4_CSS.exists() else ""
    logo_text = LOGO_SVG.read_text(encoding="utf-8") if LOGO_SVG.exists() else ""
    (DATA / "a4-assets.js").write_text(
        "/* 由 agent/build_data.py 自动生成，请勿手改。\n"
        "   源：assets/css/a4.css + assets/img/logo.svg */\n"
        "window.INTEL_A4_ASSETS = "
        + json.dumps({"css": css_text, "logo": logo_text}, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )

    dead = sum(1 for v in health.values() if v.get("status") == "dead")
    listy = sum(1 for b in briefs for i in b["items"] if i.get("source", {}).get("kind") == "list")

    print(f"✅ 已构建 {len(briefs)} 期：{', '.join(b['meta']['id'] for b in briefs)}")
    print(f"   最新期 {latest['meta']['id']}：{len(latest['items'])} 条，含影响分析 {latest['meta']['insight_count']} 条")
    print(f"   叙述：结论 {len(latest.get('narrative', {}).get('conclusions', []))} / "
          f"影响 {len(latest.get('narrative', {}).get('impacts', []))} / "
          f"展望 {len(latest.get('narrative', {}).get('outlook', []))}")
    print(f"   来源修正：{fixed} 条（其中标注为栏目页 {listy} 条）"
          + (f"，健康检查已失效 {dead} 条" if health else "，尚未运行来源健康检查"))
    print(f"✅ 站点索引：{INDEX.name}（{len(index['briefs'])} 期）  最新期分档 {counts}")
    if six_nets:
        hit = sum(1 for b in briefs for i in b["items"] if i.get("nets"))
        cross = f"（跨网 {net_stats.get(umbrella['key'], 0)}）" if umbrella else ""
        detail = "、".join(f"{n['name']} {net_stats.get(n['key'], 0)}" for n in six_nets)
        print(f"✅ 六张网专题：{len(six_nets)} 张网，主干政策 {len(six_raw.get('documents', []))} 份，"
              f"条目命中 {hit} 条{cross}（{detail}）")
    else:
        print("   ⚠ 未找到 agent/six_networks.json，六张网专题数据为空")
    print(f"✅ A4 导出资源：a4-assets.js（样式 {len(css_text)} 字符，徽标 {'已内联' if logo_text else '缺失'}）")
    if pdf_ids:
        got = [b["meta"]["id"] for b in briefs if b["meta"]["id"] in pdf_ids]
        print(f"   静态 PDF：{len(got)} 期已就绪（{'、'.join(got)}），归档页可一键下载")
    else:
        print("   静态 PDF：尚未生成，导出 PDF 走「打印 → 另存为 PDF」；"
              "运行 agent/build_pdf.py 可预渲染")


if __name__ == "__main__":
    main()
