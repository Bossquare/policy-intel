#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
情报采集：按 agent/sources.json 抓取各单位信息发布栏目，抽取候选条目。

设计取向是「稳」而不是「全」：政府网站改版频繁，各站 DOM 结构差异大，
这里用通用启发式（链接文本 + URL 日期模式 + 行业关键词）抽取，
宁可漏几条，也不要引入大量噪音给后续分析增加负担。

用法：
    python3 agent/collect.py                 # 采集最近 7 天
    python3 agent/collect.py --days 14       # 采集最近 14 天
    python3 agent/collect.py --out out/raw.json
输出：
    agent/out/raw-<YYYY>-W<周数>.json
"""

import argparse
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
AGENT = ROOT / "agent"
OUTDIR = AGENT / "out"
SOURCES = AGENT / "sources.json"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
CST = timezone(timedelta(hours=8))

# 行业关键词：标题命中任一才进入候选
KEYWORDS = [
    "智能建造", "BIM", "CIM", "数字孪生", "人工智能", "AI", "机器人", "装配式", "模块化",
    "智慧工地", "城市更新", "绿色建筑", "绿色建造", "双化协同", "数字化", "信息化", "数智",
    "智能", "标准", "导则", "试点", "示范", "评价", "智慧", "城市生命线", "数字家庭",
]

# 明显无关的标题（导航、栏目名等）
NOISE = [
    "更多", "下一页", "上一页", "首页", "网站地图", "联系我们", "无障碍", "登录", "注册",
    "政策解读", "政策法规", "通知公告", "工作动态", "信息公开", "政务服务", "办事指南",
    "返回", "打印", "关闭", "分享",
]

LINK_RE = re.compile(r'<a\s[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.S | re.I)
TAG_RE = re.compile(r"<[^>]+>")
DATE8_RE = re.compile(r"(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])")
DATE_CN_RE = re.compile(r"(20\d{2})[-/年]?(0[1-9]|1[0-2])[-/月]?(0[1-9]|[12]\d|3[01])")


def fetch(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    for enc in ("utf-8", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", TAG_RE.sub("", s)).strip()


def date_from(url: str):
    m = DATE8_RE.search(url)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = DATE_CN_RE.search(url)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return ""


def looks_relevant(title: str) -> bool:
    if len(title) < 8 or len(title) > 90:
        return False
    if any(n == title for n in NOISE):
        return False
    return any(k in title for k in KEYWORDS)


def collect_source(src: dict, since: datetime):
    base = src["url"]
    try:
        html = fetch(base)
    except Exception as e:                                    # noqa: BLE001
        print(f"    ✗ 抓取失败：{e}")
        return []

    found, seen = [], set()
    for href, inner in LINK_RE.findall(html):
        title = clean_text(inner)
        if not looks_relevant(title):
            continue
        url = urllib.parse.urljoin(base, href)
        if url in seen:
            continue
        seen.add(url)

        d = date_from(url)
        if d:
            try:
                if datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=CST) < since:
                    continue
            except ValueError:
                pass

        found.append({
            "title": title,
            "url": url,
            "date": d,
            "source_name": src["name"],
            "level": src["level"],
            "region": src["region"],
        })
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7, help="回看天数，默认 7")
    ap.add_argument("--out", default="", help="输出文件路径（默认自动按周命名）")
    args = ap.parse_args()

    if not SOURCES.exists():
        sys.exit(f"缺少源清单：{SOURCES}")

    sources = json.loads(SOURCES.read_text(encoding="utf-8"))["sources"]
    now = datetime.now(CST)
    since = now - timedelta(days=args.days)

    print(f"采集窗口：{since:%Y-%m-%d} 至今，共 {len(sources)} 个源")
    all_items, empty = [], []
    for i, src in enumerate(sources, 1):
        print(f"  [{i}/{len(sources)}] {src['name']}")
        got = collect_source(src, since)
        print(f"    → {len(got)} 条")
        if not got:
            empty.append(src["name"])
        all_items.extend(got)

    # 去重：同 URL 或同标题只留一条
    dedup, seen_url, seen_title = [], set(), set()
    for it in all_items:
        key_t = re.sub(r"\s+", "", it["title"])
        if it["url"] in seen_url or key_t in seen_title:
            continue
        seen_url.add(it["url"])
        seen_title.add(key_t)
        dedup.append(it)

    year, week, _ = now.isocalendar()
    out = pathlib.Path(args.out) if args.out else OUTDIR / f"raw-{year}-W{week:02d}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "generated_at": now.strftime("%Y-%m-%d %H:%M"),
        "window_days": args.days,
        "count": len(dedup),
        "items": dedup,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n✅ 写出 {out}")
    print(f"   去重后 {len(dedup)} 条（原始 {len(all_items)} 条）")
    if empty:
        print(f"   ⚠️ 以下 {len(empty)} 个源本次 0 条，请核对栏目地址是否变更：")
        for n in empty:
            print(f"      - {n}")


if __name__ == "__main__":
    main()
