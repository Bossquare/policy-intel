#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每周情报流水线：采集 → 分析 → 成稿 → 构建站点数据。

用法：
    python3 agent/run_weekly.py                 # 完整跑一遍（需已配置模型端点，见 analyze.py）
    python3 agent/run_weekly.py --dry-run       # 离线演练，仅用规则打分，不调模型
    python3 agent/run_weekly.py --skip-collect  # 跳过采集，直接分析已有 raw 文件
    python3 agent/run_weekly.py --days 14       # 采集窗口改为 14 天

产出：
    agent/out/raw-<期>.json / analyzed-<期>.json
    assets/data/brief-<期>.json + index.json + site-data.js
"""

import argparse
import json
import pathlib
import subprocess
import sys
from datetime import datetime, timezone, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
AGENT = ROOT / "agent"
OUT = AGENT / "out"
DATA = ROOT / "assets" / "data"
PY = sys.executable
CST = timezone(timedelta(hours=8))

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
    year, week, _ = now.isocalendar()
    pid = f"{year}-W{week:02d}"

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

    brief = {
        "meta": {
            "id": pid,
            "title": f"{now:%Y年%m月} 第 {week} 周 建筑智能化政策与技术情报简报",
            "period": f"{now - timedelta(days=raw.get('window_days', 7)):%Y-%m-%d} 至 {now:%Y-%m-%d}",
            "generated_at": now.strftime("%Y-%m-%d"),
            "total": len(items),
            "note": f"自动生成（分析器：{raw.get('analyzer', 'rule')}）。影响分析为草稿，建议人工复核后发布。",
        },
        "stats": {"by_level": count("level"), "by_tier": count("tier"), "by_track": track_count},
        "tracks": TRACKS,
        "items": items,
    }

    out = DATA / f"brief-{pid}.json"
    out.write_text(json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✅ 成稿：{out.name}（{len(items)} 条，含影响分析 {sum(1 for i in items if i['impact'])} 条）")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-collect", action="store_true")
    ap.add_argument("--no-insight", action="store_true")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)

    if not args.skip_collect:
        run([PY, AGENT / "collect.py", "--days", args.days])

    raws = sorted(OUT.glob("raw-*.json"))
    if not raws:
        sys.exit("agent/out/ 下没有 raw-*.json，采集可能全部失败")

    raw = raws[-1]
    acmd = [PY, AGENT / "analyze.py", "--input", raw]
    if args.dry_run:
        acmd.append("--dry-run")
    if args.no_insight:
        acmd.append("--no-insight")
    run(acmd)

    analyzed = OUT / raw.name.replace("raw-", "analyzed-")
    if not analyzed.exists():
        sys.exit(f"未找到分析结果：{analyzed}")
    promote(analyzed)

    run([PY, AGENT / "build_data.py"])

    print("\n" + "=" * 60)
    print("流水线完成。")
    print("  本地预览：python3 -m http.server 8000")
    print("  发布更新：git add -A && git commit -m 'chore: 更新情报数据' && git push")
    print("  提示：自动生成的影响分析是草稿，建议在 agent/insights.json 中复核/覆盖后重跑 build_data.py")


if __name__ == "__main__":
    main()
