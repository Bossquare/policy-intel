#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
来源链接健康检查。

遍历各期简报里的来源链接与 agent/sources.json 的采集源，逐个探测可访问性，
产出 assets/data/source-health.json，供站点显示「链接失效」标注。

判定：
    ok       2xx / 3xx                 可正常打开
    blocked  401 / 403 / 405           站点存活但拒绝脚本访问（浏览器通常可打开）
    dead     000 / 4xx / 5xx           失效（连接失败、超时、页面不存在、源站拒绝）

用法：
    python3 agent/check_sources.py                  # 检查全部
    python3 agent/check_sources.py --jobs 8 --timeout 15
    python3 agent/check_sources.py --only-brief     # 只查简报条目，不查采集源
"""

import argparse
import concurrent.futures as cf
import json
import pathlib
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "assets" / "data"
SOURCES = ROOT / "agent" / "sources.json"
FIXES = ROOT / "agent" / "source_fixes.json"
OUT = DATA / "source-health.json"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

OK_CODES = {"200", "201", "202", "203", "204", "206", "301", "302", "303", "307", "308"}
BLOCKED_CODES = {"401", "403", "405", "406", "429"}


def classify(code: str) -> str:
    if code in OK_CODES:
        return "ok"
    if code in BLOCKED_CODES:
        return "blocked"
    return "dead"


def probe(url: str, timeout: int) -> dict:
    """用 curl 探测单个 URL。直连不走代理（本机代理会拦国内政府站点）。"""
    if not url.startswith(("http://", "https://")):
        return {"status": "dead", "code": "bad-url"}
    try:
        r = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code} %{url_effective}",
             "--noproxy", "*", "--max-time", str(timeout), "-L",
             "-A", UA, "-r", "0-2048", url],
            capture_output=True, text=True, timeout=timeout + 10)
        out = r.stdout.strip()
        code = out.split(" ", 1)[0] if out else "000"
        eff = out.split(" ", 1)[1] if " " in out else ""
    except subprocess.TimeoutExpired:
        return {"status": "dead", "code": "timeout"}
    except Exception as e:  # noqa: BLE001
        return {"status": "dead", "code": type(e).__name__}

    rec = {"status": classify(code), "code": code}
    # 跟随跳转后落到别的地址（尤其落到栏目首页）时记录下来
    if eff and eff.rstrip("/") != url.rstrip("/"):
        rec["final"] = eff
    return rec


def probe_with_retry(url: str, timeout: int, retries: int) -> dict:
    """复核：非 ok 的链接间隔重试。

    部分政府站点有间歇性防护（同一地址时而 200 时而 000/403），
    单次探测会误判为失效，因此连续失败才定论。
    """
    last = None
    for attempt in range(retries + 1):
        if attempt:
            time.sleep(2 * attempt)
        last = probe(url, timeout)
        if last["status"] == "ok":
            if attempt:
                last["retries"] = attempt
            return last
    return last


def collect_urls(only_brief: bool):
    """返回 {url: [用途标签...]}

    条目链接先套用 source_fixes.json 的修正（与 build_data.py 一致），
    这样健康状态里的 key 与站点最终渲染的 url 对得上。
    """
    urls = {}
    fixes = json.loads(FIXES.read_text(encoding="utf-8")) if FIXES.exists() else {}

    def add(u, tag):
        if u and u.startswith(("http://", "https://")):
            urls.setdefault(u, [])
            if tag not in urls[u]:
                urls[u].append(tag)

    for path in sorted(DATA.glob("brief-*.json")):
        b = json.loads(path.read_text(encoding="utf-8"))
        bid = b["meta"]["id"]
        for it in b["items"]:
            sp = it.get("source") or {}
            fix = fixes.get(it["id"]) or {}
            main = fix.get("url") or sp.get("url")
            alts = fix.get("alt") or sp.get("alt") or []
            add(main, f"{bid}:{it['id']}")
            for alt in alts:
                add(alt.get("url"), f"{bid}:{it['id']}(备用)")

    if not only_brief and SOURCES.exists():
        cfg = json.loads(SOURCES.read_text(encoding="utf-8"))
        for s in cfg.get("sources", []):
            if isinstance(s, dict):
                add(s.get("url") or s.get("list_url"), f"采集源:{s.get('name', '?')}")
    return urls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=8, help="并发数（默认 8）")
    ap.add_argument("--timeout", type=int, default=20, help="单个请求超时秒数（默认 20）")
    ap.add_argument("--retries", type=int, default=2, help="失败后的复核次数（默认 2，共 3 次机会）")
    ap.add_argument("--only-brief", action="store_true", help="只检查简报条目链接")
    ap.add_argument("--quiet", action="store_true", help="只打印汇总")
    args = ap.parse_args()

    urls = collect_urls(args.only_brief)
    if not urls:
        sys.exit("没有可检查的链接")

    print(f"开始检查 {len(urls)} 个链接（并发 {args.jobs}，超时 {args.timeout}s，失败复核 {args.retries} 次）…")
    results = {}
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        futs = {ex.submit(probe_with_retry, u, args.timeout, args.retries): u for u in urls}
        done = 0
        for f in cf.as_completed(futs):
            u = futs[f]
            results[u] = f.result()
            done += 1
            if not args.quiet:
                r = results[u]
                mark = {"ok": "✓", "blocked": "▲", "dead": "✗"}[r["status"]]
                extra = f"  (复核{r['retries']}次后恢复)" if r.get("retries") else ""
                print(f"  [{done}/{len(urls)}] {mark} {r['code']:>4}  {u[:96]}{extra}")

    checked_at = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    items = {}
    for u, r in results.items():
        rec = dict(r)
        rec["used_by"] = urls[u]
        items[u] = rec

    OUT.write_text(json.dumps(
        {"_checked_at": checked_at, "_items": items},
        ensure_ascii=False, indent=2), encoding="utf-8")

    ok = sum(1 for r in results.values() if r["status"] == "ok")
    blocked = [u for u, r in results.items() if r["status"] == "blocked"]
    dead = [u for u, r in results.items() if r["status"] == "dead"]

    print(f"\n汇总：正常 {ok}　受限 {len(blocked)}　失效 {len(dead)}　（共 {len(results)}）")
    if blocked:
        print("\n受限链接（站点存活但拒绝脚本访问，浏览器通常可打开）：")
        for u in sorted(blocked):
            print(f"  ▲ {u}  [{results[u]['code']}]")
    if dead:
        print("\n失效链接：")
        for u in sorted(dead):
            print(f"  ✗ {u}  [{results[u].get('code')}]")
            print(f"     用于：{', '.join(urls[u][:4])}")
    print(f"\n✅ 已写入 {OUT.relative_to(ROOT)}（{checked_at}）")
    return 1 if dead else 0


if __name__ == "__main__":
    sys.exit(main())
