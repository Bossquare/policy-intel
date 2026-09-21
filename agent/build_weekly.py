#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
周报回溯拆分：从月度试点简报按日期窗口拆出周报。

输入：
    assets/data/brief-2026-09.json     月度试点简报（条目池）
    agent/weekly_narratives.json       各周的核心结论 / 影响分析 / 趋势展望（人工撰写）
输出：
    assets/data/brief-2026-W36.json    2026-08-31 至 2026-09-06
    assets/data/brief-2026-W37.json    2026-09-07 至 2026-09-13

条目处理原则：
    - 周报条目与月报共享同一 id 与内容（前端按 id 去重，月报版本优先展示），
      保证从周报点进详情能看到同一份影响分析；
    - 仅在周报内部重新编号 no（附录表序号）；
    - 日期为空（如「9月质量月」）的条目不进入任何周报，仅保留在月报中。

用法：
    python3 agent/build_weekly.py
"""

import copy
import json
import pathlib
import sys
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "assets" / "data"
MONTHLY = DATA / "brief-2026-09.json"
NARRATIVES = ROOT / "agent" / "weekly_narratives.json"

WEEKS = [
    {
        "id": "2026-W36",
        "title": "2026年第36周（8.31–9.6）建筑智能化市场洞察·政策情报周报",
        "period": "2026-08-31 至 2026-09-06",
        "lo": "2026-08-31",
        "hi": "2026-09-06",
    },
    {
        "id": "2026-W37",
        "title": "2026年第37周（9.7–9.13）建筑智能化市场洞察·政策情报周报",
        "period": "2026-09-07 至 2026-09-13",
        "lo": "2026-09-07",
        "hi": "2026-09-13",
    },
]


def stats_of(items):
    by_level, by_tier, by_track = {}, {}, {}
    for it in items:
        by_level[it["level"]] = by_level.get(it["level"], 0) + 1
        by_tier[it["tier"]] = by_tier.get(it["tier"], 0) + 1
        for t in it.get("tracks", []):
            by_track[t] = by_track.get(t, 0) + 1
    return {"by_level": by_level, "by_tier": by_tier, "by_track": by_track}


def main():
    if not MONTHLY.exists():
        sys.exit(f"缺少月度简报：{MONTHLY}")
    monthly = json.loads(MONTHLY.read_text(encoding="utf-8"))
    narratives = json.loads(NARRATIVES.read_text(encoding="utf-8")) if NARRATIVES.exists() else {}

    for wk in WEEKS:
        items = [it for it in monthly["items"] if wk["lo"] <= (it.get("date") or "") <= wk["hi"]]
        if not items:
            print(f"⚠️ {wk['id']}：窗口 {wk['lo']}~{wk['hi']} 内没有条目，跳过")
            continue
        items = [copy.deepcopy(it) for it in sorted(items, key=lambda x: (x["date"], -x["relevance"]))]
        for i, it in enumerate(items, 1):
            it["no"] = i

        # 校验 ISO 周编号
        y, wno, _ = date.fromisoformat(wk["lo"]).isocalendar()
        expected = f"{y}-W{wno:02d}"
        iso_note = "" if expected == wk["id"] else f"（注意：ISO 周为 {expected}）"

        brief = {
            "meta": {
                "id": wk["id"],
                "title": wk["title"],
                "period": wk["period"],
                "generated_at": "2026-09-20",
                "total": len(items),
                "note": "回溯补齐：由 9 月试点报告按周拆分，条目与 9 月简报共享同一编号与内容。",
            },
            "stats": stats_of(items),
            "tracks": monthly["tracks"],
            "items": items,
            "narrative": narratives.get(wk["id"], {"conclusions": [], "impacts": [], "outlook": []}),
        }
        out = DATA / f"brief-{wk['id']}.json"
        out.write_text(json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8")
        bt = brief["stats"]["by_tier"]
        print(f"✅ {wk['id']}{iso_note}：{len(items)} 条"
              f"（重点 {bt.get('focus', 0)} / 跟踪 {bt.get('track', 0)} / 了解 {bt.get('watch', 0)}）"
              f" → {out.name}")

    print("\n继续运行 python3 agent/build_data.py 重建站点索引。")


if __name__ == "__main__":
    main()
