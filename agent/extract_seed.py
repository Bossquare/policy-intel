#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 9 月试点报告 HTML 抽取结构化情报条目 —— 情报站首期种子数据。

数据源：seed/2026-09-report.html 的「附录：全部条目明细表」（45 条，结构规整）
其余字段（层级、地区、赛道、档级、相关性）由规则自动推导。

用法：
    python3 agent/extract_seed.py
输出：
    assets/data/brief-2026-09.json
"""

import json
import re
import html as htmllib
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "seed" / "2026-09-report.html"
OUT = ROOT / "assets" / "data" / "brief-2026-09.json"

# ---------------------------------------------------------------- 分层
# 报告自身的分组：1-10 国家层面 / 11-27 重点省市 / 28-39 其他省市 / 40-45 行业层面
LEVEL_RANGES = [
    (1, 10, "national", "国家层面"),
    (11, 27, "key-city", "重点省市"),
    (28, 39, "other", "其他省市"),
    (40, 45, "industry", "行业层面"),
]

# ---------------------------------------------------------------- 赛道
TRACKS = {
    "smart-building": ("智慧建筑", "楼宇智能化、智能家居、数字家庭、智慧建筑评价"),
    "bim-cim": ("BIM/CIM", "BIM、CIM、数字孪生、实景三维、电子文件、建模算量"),
    "intelligent-construction": ("智能建造", "智能建造、建筑机器人、装配式与模块化、智能装备"),
    "green-smart": ("绿色智能", "绿色建造、双化协同、低碳与能耗管理"),
    "urban-renewal": ("城市更新", "城市更新、老旧小区、城市生命线、韧性城市"),
    "ai-building": ("AI+建筑", "人工智能在招投标、审图、造价、工地识别等环节落地"),
}

# 核心赛道：与公司主营强相关
CORE_TRACKS = {"bim-cim", "intelligent-construction", "ai-building"}

TRACK_KEYWORDS = {
    "smart-building": ["智慧建筑", "智能家居", "数字家庭", "楼宇", "好房子", "智慧社区", "智慧运维"],
    "bim-cim": ["BIM", "CIM", "数字孪生", "实景三维", "电子文件", "信息模型", "建模", "算量", "赋码",
                "城市信息模型", "一模到底", "构件库", "数字底座", "时空底座"],
    "intelligent-construction": ["智能建造", "建筑机器人", "机器人", "装配式", "模块化", "智能塔吊",
                                 "造楼机", "3D打印", "智能装备", "新型建筑工业化", "工业化技术",
                                 "智慧工地", "数字勘察", "数据贯通", "数字化转型"],
    "green-smart": ["绿色建造", "绿色建筑", "绿色智能", "双化协同", "低碳", "能耗", "碳达峰", "绿色建材"],
    "urban-renewal": ["城市更新", "老旧小区", "城市生命线", "韧性城市", "新城建", "历史建筑"],
    "ai-building": ["人工智能", "AI", "大模型", "Agent", "辅助评标", "智能识别", "机器视觉", "智能审查",
                    "数智住建", "数智化"],
}

# 强制/量化信号：出现说明该条含硬约束或可考核指标，档级上抬
FORCE_SIGNALS = ["强制", "全面", "规模化", "不得", "应当", "须", "必须", "目标", "累计", "占比",
                 "不低于", "以上项目", "按季度", "全覆盖", "起，", "自2026", "到2030", "到2027",
                 "≥", "万㎡", "梯次", "足额"]

# 弱信息形式：纯宣传、活动、人事、展会，一律「一般了解」
WEAK_FORMS = ("企业新闻", "行业论坛", "现场观摩会", "名单公布", "人事文件", "行业大会", "展会")

# 地区识别
REGIONS = [
    ("上海", ["上海", "沪建"]),
    ("北京", ["北京", "京建", "DB11"]),
    ("广州", ["广州", "穗建"]),
    ("深圳", ["深圳", "SJG"]),
    ("广东", ["广东", "广东省"]),
    ("江苏", ["江苏", "苏建"]),
    ("南京", ["南京"]),
    ("浙江", ["浙江", "浙建"]),
    ("杭州", ["杭州"]),
    ("西安", ["西安"]),
    ("新疆", ["新疆", "自治区"]),
    ("成都", ["成都"]),
    ("重庆", ["重庆", "渝建"]),
    ("湖北", ["湖北"]),
    ("湖南", ["湖南"]),
    ("福建", ["福建", "闽建"]),
    ("安徽", ["安徽"]),
    ("河南", ["河南"]),
    ("郑州", ["郑州"]),
    ("泰安", ["泰安"]),
]

LEVEL_BASE_SCORE = {"national": 55, "key-city": 45, "other": 35, "industry": 30}


def strip_tags(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", htmllib.unescape(s)).strip()


def level_of(no: int):
    for lo, hi, key, label in LEVEL_RANGES:
        if lo <= no <= hi:
            return key, label
    return "other", "其他"


def region_of(text: str, level: str, org: str) -> str:
    """国家层面默认归「全国」，只在发布机构本身就是地方机关时才落到具体地区。"""
    if level == "national":
        head = org[:8]
        for name, kws in REGIONS:
            if any(kw in head for kw in kws):
                return name
        return "全国"
    for name, kws in REGIONS:
        for kw in kws:
            if kw in text:
                return name
    return "其他"


def tracks_of(text: str):
    hits = []
    for tid, kws in TRACK_KEYWORDS.items():
        if any(kw in text for kw in kws):
            hits.append(tid)
    return hits


def decide_tier(level, form, tracks, text):
    strong = bool(set(tracks) & CORE_TRACKS)
    forced = any(k in text for k in FORCE_SIGNALS)

    if any(k in form for k in WEAK_FORMS):
        return "watch"

    if level == "national":
        return "focus" if (strong or "smart-building" in tracks) else "track"

    if level == "key-city":
        if strong and forced:
            return "focus"
        if strong or "征求意见" in form or "标准" in form:
            return "track"
        return "watch"

    # 非重点省市：地级市/省份方案对公司是参考案例，最高「持续跟踪」
    if level == "other":
        return "track" if strong else "watch"

    # industry
    if "标准" in form:
        return "track"
    return "watch"


def relevance_of(level, tracks, text, form):
    """与公司主营赛道的相关性打分（0-98）。纯宣传/活动/人事类大幅降权。"""
    strong = bool(set(tracks) & CORE_TRACKS)
    forced = any(k in text for k in FORCE_SIGNALS)
    if any(k in form for k in WEAK_FORMS):
        return min(45, LEVEL_BASE_SCORE.get(level, 30) + 5 * len(tracks))
    score = LEVEL_BASE_SCORE.get(level, 30) + 10 * len(tracks) \
        + (18 if strong else 0) + (10 if forced else 0)
    return min(98, score)


TIER_LABEL = {"focus": "重点关注", "track": "持续跟踪", "watch": "一般了解"}

# 人工复核修正：规则判不准的少数条目在此覆盖，保留可追溯性
TIER_OVERRIDE = {
    31: "track",   # 重庆第六批试点企业/第七批试点项目：属持续跟踪，非纯宣传
}


def parse_rows(raw: str):
    pattern = re.compile(
        r"<tr><td>(\d+)</td><td>(.*?)</td><td>(.*?)</td><td>(.*?)</td>"
        r"<td>(.*?)</td><td>(.*?)</td><td>(.*?)</td></tr>",
        re.S,
    )
    return pattern.findall(raw)


def norm_date(raw_date: str) -> str:
    """把 09-18 / 09-03/10 / 09-09至13 等归一为 2026-MM-DD，取首个日期。"""
    m = re.search(r"(\d{2})-(\d{2})", raw_date)
    if m:
        return f"2026-{m.group(1)}-{m.group(2)}"
    return ""


def main():
    if not SRC.exists():
        sys.exit(f"源文件不存在：{SRC}")
    raw = SRC.read_text(encoding="utf-8")
    rows = parse_rows(raw)
    if len(rows) != 45:
        print(f"⚠️ 解析到 {len(rows)} 行，预期 45 行，请检查源文件结构", file=sys.stderr)

    items = []
    for no_s, org, date_raw, title, form, body, conf in rows:
        no = int(no_s)
        level, level_label = level_of(no)
        url_m = re.search(r'href="([^"]+)"', body)
        url = url_m.group(1) if url_m else ""
        summary = strip_tags(body)
        summary = re.sub(r"\s*[a-z0-9.\-]+\.(?:com|cn|gov|org)[^\s]*\s*$", "", summary).strip()

        title_c = strip_tags(title)
        org_c = strip_tags(org)
        form_c = strip_tags(form)
        text = f"{title_c} {summary} {org_c} {form_c}"

        tracks = tracks_of(text)
        tier = TIER_OVERRIDE.get(no) or decide_tier(level, form_c, tracks, text)

        items.append({
            "id": f"2026-09-{no:03d}",
            "no": no,
            "title": title_c,
            "org": org_c,
            "date": norm_date(strip_tags(date_raw)),
            "date_raw": strip_tags(date_raw),
            "level": level,
            "level_label": level_label,
            "region": region_of(text, level, org_c),
            "form": form_c,
            "summary": summary,
            "source": {"label": (url.split("/")[2] if "//" in url else ""), "url": url},
            "confidence": strip_tags(conf),
            "tracks": tracks,
            "tier": tier,
            "tier_label": TIER_LABEL[tier],
            "relevance": relevance_of(level, tracks, text, form_c),
            "impact": "",
            "action": "",
        })

    def count_by(key):
        c = {}
        for it in items:
            c[it[key]] = c.get(it[key], 0) + 1
        return c

    track_count = {}
    for it in items:
        for t in it["tracks"]:
            track_count[t] = track_count.get(t, 0) + 1

    data = {
        "meta": {
            "id": "2026-09",
            "title": "2026年9月 建筑智能化政策与技术情报简报",
            "period": "2026-09-01 至 2026-09-18",
            "generated_at": "2026-09-18",
            "total": len(items),
            "note": "首期种子数据，取自 9 月试点报告（去重后 45 条）。",
            "narrative_source": "seed/2026-09-report.html",
        },
        "stats": {
            "by_level": count_by("level"),
            "by_tier": count_by("tier"),
            "by_track": track_count,
        },
        "tracks": {k: {"label": v[0], "desc": v[1]} for k, v in TRACKS.items()},
        "items": items,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ 写出 {OUT}")
    print(f"   条目 {len(items)} 条")
    print(f"   分层 {data['stats']['by_level']}")
    print(f"   分档 {data['stats']['by_tier']}")
    print(f"   赛道 {data['stats']['by_track']}")


if __name__ == "__main__":
    main()
