#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每周情报流水线：采集 → 分析 → 成稿 → 构建站点数据。

分析阶段除逐条摘要/分档/影响分析外，还会汇总本期「核心结论 / 市场影响 / 趋势展望」，
写进成稿的 narrative 字段（首页看板与 A4 版式消费）。人工精修入口是
agent/weekly_narratives.json（按期号覆盖，如 {"2026-W38": {...}}），有则优先。

用法：
    python3 agent/run_weekly.py                 # 完整跑一遍（需已配置模型端点，见 analyze.py）
    python3 agent/run_weekly.py --dry-run       # 离线演练，仅用规则打分，不调模型
    python3 agent/run_weekly.py --skip-collect  # 跳过采集，直接分析已有 raw 文件
    python3 agent/run_weekly.py --no-narrative  # 不生成核心结论/影响/展望
    python3 agent/run_weekly.py --days 14       # 采集窗口改为 14 天

产出：
    agent/out/raw-<期>.json / analyzed-<期>.json
    assets/data/brief-<期>.json + index.json + site-data.js
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
AGENT = ROOT / "agent"
OUT = AGENT / "out"
DATA = ROOT / "assets" / "data"
NARRATIVES = AGENT / "weekly_narratives.json"
PY = sys.executable
CST = timezone(timedelta(hours=8))

EMPTY_NARRATIVE = {"conclusions": [], "impacts": [], "outlook": []}


def resolve_narrative(pid: str, analyzed: dict):
    """定本期叙述：人工撰写 > 模型草稿 > 空。

    weekly_narratives.json 是人工精修入口（键为期号，如 2026-W38），
    有它就用它，模型草稿不覆盖人工判断；没有才落模型生成的版本。
    """
    mine = (analyzed.get("narrative") or {})
    if mine.get("conclusions"):
        auto, auto_mode = mine, "llm"
    else:
        auto, auto_mode = EMPTY_NARRATIVE, (analyzed.get("narrative_mode") or "none")

    if NARRATIVES.exists():
        try:
            hand = json.loads(NARRATIVES.read_text(encoding="utf-8")).get(pid) or {}
        except Exception as e:                                # noqa: BLE001
            print(f"  ⚠ {NARRATIVES.name} 解析失败，已忽略：{e}")
            hand = {}
        if hand.get("conclusions"):
            return {
                "conclusions": hand.get("conclusions", []),
                "impacts": hand.get("impacts", []),
                "outlook": hand.get("outlook", []),
            }, "manual"
    return auto, auto_mode

LEVEL_LABEL = {"national": "国家层面", "key-city": "重点省市", "other": "其他省市", "industry": "行业层面"}
TIER_LABEL = {"focus": "重点关注", "track": "持续跟踪", "watch": "一般了解"}
TRACKS = {
    "smart-building": {"label": "智慧建筑", "desc": "楼宇智能化、智能家居、数字家庭、智慧建筑评价"},
    "bim-cim": {"label": "BIM/CIM", "desc": "BIM、CIM、数字孪生、实景三维、电子文件、建模算量"},
    "intelligent-construction": {"label": "智能建造", "desc": "智能建造、建筑机器人、装配式与模块化、智能装备"},
    "green-smart": {"label": "绿色智能", "desc": "绿色建造、双化协同、低碳与能耗管理"},
    "urban-renewal": {"label": "城市更新", "desc": "城市更新、老旧小区、城市生命线、韧性城市"},
    "ai-building": {"label": "AI+建筑", "desc": "人工智能在招投标、审图、造价、工地识别等环节落地"},
}


def run(cmd):
    print(f"\n▶ {' '.join(str(c) for c in cmd)}")
    r = subprocess.run([str(c) for c in cmd], cwd=str(ROOT))
    if r.returncode != 0:
        sys.exit(f"✗ 步骤失败：{cmd[1]}")


def promote(analyzed_path: pathlib.Path):
    """把分析结果转成站点消费的简报结构，写入 assets/data/brief-<期>.json"""
    raw = json.loads(analyzed_path.read_text(encoding="utf-8"))
    now = datetime.now(CST)

    # 期号取分析结果的文件名（analyzed-2026-W38.json），它由采集窗口决定；
    # 没有期号的旧文件才退回到「窗口末日所属 ISO 周」现算——
    # 周一跑时直接用 now.isocalendar() 会把上周数据标成本周期号（W39 而非 W38）。
    m = re.search(r"(\d{4})-W(\d{2})", analyzed_path.name)
    if m:
        year, week = int(m.group(1)), int(m.group(2))
    else:
        year, week, _ = (now - timedelta(days=1)).isocalendar()
    pid = f"{year}-W{week:02d}"

    # 窗口口径以分析结果里记录的为准，这样隔几天重新成稿（--skip-analyze）也不会漂移
    win = raw.get("window") or {}
    days = int(win.get("days") or raw.get("window_days", 7) or 7)
    if win.get("start") and win.get("end"):
        start = datetime.fromisoformat(win["start"])
        ref = datetime.fromisoformat(win["end"])
    else:
        ref = now - timedelta(days=1)
        start = (now - timedelta(days=days)).replace(
            hour=0, minute=0, second=0, microsecond=0)

    rows = sorted(raw["items"], key=lambda v: (v.get("date") or "", -int(v.get("relevance", 0))))
    items = []
    for i, x in enumerate(rows, 1):
        url = x.get("url", "")
        items.append({
            "id": f"{pid}-{i:03d}",
            "no": i,
            "title": x["title"],
            "org": x.get("source_name", ""),
            "date": x.get("date", ""),
            "date_raw": x.get("date", ""),
            "level": x.get("level", "other"),
            "level_label": LEVEL_LABEL.get(x.get("level", "other"), "其他"),
            "region": x.get("region", ""),
            "form": "自动采集",
            "summary": "；".join(x.get("summary", [])) or x["title"],
            "source": {"label": url.split("/")[2] if "//" in url else "", "url": url},
            "confidence": "自动采集，未逐条核验",
            "tracks": x.get("tracks", []),
            "tier": x.get("tier", "track"),
            "tier_label": TIER_LABEL.get(x.get("tier", "track"), "持续跟踪"),
            "relevance": int(x.get("relevance", 50)),
            "impact": x.get("impact", ""),
            "action": x.get("action", ""),
            "tier_reason": x.get("tier_reason", ""),
        })

    def count(key):
        c = {}
        for it in items:
            c[it[key]] = c.get(it[key], 0) + 1
        return c

    track_count = {}
    for it in items:
        for t in it["tracks"]:
            track_count[t] = track_count.get(t, 0) + 1

    # 叙述（核心结论 / 市场影响 / 趋势展望）：人工撰写优先，其次是模型草稿。
    # 没有这一步时首页「本期核心结论」永远是空的——weekly_narratives.json
    # 只手工维护过 W36/W37，自动跑出来的新一期没人往里加条目。
    narrative, narrative_mode = resolve_narrative(pid, raw)

    note = f"自动生成（分析器：{raw.get('analyzer', 'rule')}）。"
    if narrative["conclusions"]:
        note += ("核心结论与影响分析为模型草稿，建议人工复核后发布。"
                 if narrative_mode == "llm" else "核心结论为人工撰写。")
    else:
        note += "本期未生成核心结论（模型研判未产出），建议人工补充。"
    if any(i["impact"] for i in items):
        note += "条目级影响分析为草稿，建议复核。"

    brief = {
        "meta": {
            "id": pid,
            # 标题与人工补齐的 W36/W37 保持同一写法，归档页看起来才连贯
            "title": (f"{year}年第{week}周（{start.month}.{start.day}–"
                      f"{ref.month}.{ref.day}）建筑智能化市场洞察·政策情报周报"),
            "period": f"{start:%Y-%m-%d} 至 {ref:%Y-%m-%d}",
            "generated_at": now.strftime("%Y-%m-%d"),
            "total": len(items),
            "narrative_mode": narrative_mode,
            "note": note,
        },
        "stats": {"by_level": count("level"), "by_tier": count("tier"), "by_track": track_count},
        "tracks": TRACKS,
        "items": items,
        "narrative": narrative,
    }

    out = DATA / f"brief-{pid}.json"
    out.write_text(json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✅ 成稿：{out.name}（{len(items)} 条，含影响分析 {sum(1 for i in items if i['impact'])} 条）")
    print(f"   叙述：{narrative_mode}（结论 {len(narrative['conclusions'])} / "
          f"影响 {len(narrative['impacts'])} / 展望 {len(narrative['outlook'])}）")
    if not narrative["conclusions"]:
        print("   ⚠️ 本期无核心结论，首页该区块会显示空状态提示")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-collect", action="store_true")
    ap.add_argument("--skip-analyze", action="store_true",
                    help="复用已有的 analyzed-*.json 只重跑成稿（改完叙述/洞察后省一次模型分析）")
    ap.add_argument("--no-insight", action="store_true")
    ap.add_argument("--no-narrative", action="store_true",
                    help="跳过核心结论/影响/展望研判生成（首页该区块将显示空状态）")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)

    if not args.skip_collect:
        run([PY, AGENT / "collect.py", "--days", args.days])

    if args.skip_analyze:
        dones = sorted(OUT.glob("analyzed-*.json"))
        if not dones:
            sys.exit("--skip-analyze 需要 agent/out/ 下已有 analyzed-*.json")
        raw = dones[-1]
        print(f"\n▶ 跳过分析，复用 {raw.name}")
    else:
        raws = sorted(OUT.glob("raw-*.json"))
        if not raws:
            sys.exit("agent/out/ 下没有 raw-*.json，采集可能全部失败")

        raw = raws[-1]
        acmd = [PY, AGENT / "analyze.py", "--input", raw]
        if args.dry_run:
            acmd.append("--dry-run")
        if args.no_insight:
            acmd.append("--no-insight")
        if args.no_narrative:
            acmd.append("--no-narrative")
        run(acmd)

        analyzed = OUT / raw.name.replace("raw-", "analyzed-")
        if not analyzed.exists():
            sys.exit(f"未找到分析结果：{analyzed}")
        raw = analyzed

    promote(raw)

    # 来源链接健康检查（可选步骤：发现失效只提示，不中断流水线）
    print("\n▶ 来源链接健康检查")
    r = subprocess.run([str(PY), str(AGENT / "check_sources.py"), "--quiet"], cwd=str(ROOT))
    if r.returncode != 0:
        print("  ⚠ 存在失效链接（清单见上），已记入 source-health.json，站点会标出「链接失效」；不影响本期成稿。")

    run([PY, AGENT / "build_data.py"])

    # A4 竖版静态 PDF（可选步骤：浏览器缺失或渲染失败只提示，不中断流水线）
    # 顺序说明：build_data 先产出 site-data.js（导出视图要读），
    #           渲染完 PDF 后再跑一次 build_data 把 pdf 可用标记回填到 index.json。
    print("\n▶ 预渲染 A4 竖版 PDF")
    r = subprocess.run([str(PY), str(AGENT / "build_pdf.py")], cwd=str(ROOT))
    if r.returncode == 0:
        run([PY, AGENT / "build_data.py"])

    print("\n" + "=" * 60)
    print("流水线完成。")
    print("  本地预览：python3 -m http.server 8000")
    print("  发布更新：git add -A && git commit -m 'chore: 更新情报数据' && git push")
    print("  提示：自动生成的条目影响分析与本期研判均为草稿；")
    print("       条目级可在 agent/insights.json 覆盖，期级在 agent/weekly_narratives.json 覆盖，")
    print("       改完重跑 python3 agent/build_data.py 即可。")


if __name__ == "__main__":
    main()
