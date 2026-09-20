#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
预渲染 A4 竖版静态 PDF。

原理：用本机 Edge / Chrome 的 headless 模式打开导出视图 export.html，
      由浏览器按 @page A4 竖版规则分页并打印成 PDF，落到 assets/briefs/<期号>.pdf。
      归档页据此把「下载 PDF」变成一键直下；没有静态 PDF 时前端会退化为
      「打开导出视图 → 打印 → 另存为 PDF」。

为什么不用 CDP：Edge 153 起 --print-to-pdf 完成打印后进程不会自行退出，
      所以这里采用「启动 → 轮询产物落定 → 主动收进程」的方式，不依赖浏览器退出。

用法：
    python3 agent/build_pdf.py                  # 补齐缺失的期次
    python3 agent/build_pdf.py --force          # 全部重渲染
    python3 agent/build_pdf.py --ids 2026-W37   # 只渲染指定期次
    python3 agent/build_pdf.py --list           # 只列出各期 PDF 状态

产出：
    assets/briefs/<期号>.pdf
    （随后重跑 agent/build_data.py，index.json 里的 pdf 标记会同步更新）
"""

import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "assets" / "data"
PDF_DIR = ROOT / "assets" / "briefs"
EXPORT = ROOT / "export.html"

# 候选浏览器（按优先级）
BROWSERS = [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]

# 顺序写入 HTML 时会依赖这些文件，缺任何一项都渲染不出完整版式
REQUIRED = [
    ROOT / "assets" / "css" / "a4.css",
    ROOT / "assets" / "js" / "export.js",
    DATA / "site-data.js",
    DATA / "a4-assets.js",
]


def find_browser(explicit=None):
    if explicit:
        p = pathlib.Path(explicit)
        return str(p) if p.exists() else None
    for c in BROWSERS:
        if pathlib.Path(c).exists():
            return c
    return None


def preflight():
    missing = [str(p.relative_to(ROOT)) for p in REQUIRED if not p.exists()]
    if missing:
        sys.exit("✗ 缺少渲染所需文件：" + "、".join(missing) + "\n  请先运行 python3 agent/build_data.py")


def list_briefs(only_ids=None):
    ids = []
    for p in sorted(DATA.glob("brief-*.json")):
        try:
            b = json.loads(p.read_text(encoding="utf-8"))
            bid = b["meta"]["id"]
        except Exception as e:
            print(f"  ⚠ 跳过 {p.name}：{e}")
            continue
        ids.append(bid)
    if only_ids:
        want = [i.strip() for i in only_ids.split(",") if i.strip()]
        unknown = [i for i in want if i not in ids]
        if unknown:
            sys.exit(f"✗ 未知期号：{', '.join(unknown)}（可用：{', '.join(ids)}）")
        return want
    return ids


def render(browser, bid, out_path, timeout=90, verbose=False):
    """启动无头浏览器打印一页，轮询等待 PDF 落定后收掉进程。"""
    url = EXPORT.as_uri() + "?id=" + bid
    udd = f"/tmp/edge-a4pdf-{os.getpid()}"
    if out_path.exists():
        out_path.unlink()

    cmd = [
        browser,
        "--headless=new",
        "--no-sandbox",                     # 沙箱在本机无法初始化，必需
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-crash-reporter",
        "--disable-breakpad",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-pdf-header-footer",           # 不要浏览器自带的页眉页脚
        "--virtual-time-budget=15000",      # 等 JS 渲染完版式
        f"--user-data-dir={udd}",
        f"--print-to-pdf={out_path}",
        url,
    ]
    if verbose:
        print("    " + " ".join(cmd))

    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t0 = time.time()
    last_size = -1
    stable = 0
    ok = False
    try:
        while time.time() - t0 < timeout:
            time.sleep(0.4)
            if out_path.exists():
                size = out_path.stat().st_size
                if size == last_size and size > 1500:
                    stable += 1
                else:
                    stable = 0
                last_size = size
                # 连续几次大小不变且收尾为 %%EOF，说明写完了
                if stable >= 3:
                    with open(out_path, "rb") as fh:
                        fh.seek(max(0, size - 128))
                        if b"%%EOF" in fh.read():
                            ok = True
                            break
            elif proc.poll() is not None:
                break
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    return ok, round(time.time() - t0, 1)


def pdf_pages(path):
    """粗略读页数（用于日志），不引入额外依赖。"""
    try:
        d = path.read_bytes()
        m = re.findall(rb"/Type\s*/Page[^s]", d)
        return len(m) or None
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", help="只渲染这些期号（逗号分隔）")
    ap.add_argument("--force", action="store_true", help="已存在的也重渲染")
    ap.add_argument("--list", action="store_true", help="只列出状态")
    ap.add_argument("--browser", help="指定浏览器可执行文件")
    ap.add_argument("--timeout", type=int, default=90, help="单期渲染超时秒数")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    preflight()
    ids = list_briefs(args.ids)
    PDF_DIR.mkdir(parents=True, exist_ok=True)

    if args.list:
        for bid in ids:
            f = PDF_DIR / f"{bid}.pdf"
            state = f"{f.stat().st_size/1024:.0f} KB" if f.exists() else "未生成"
            print(f"  {bid:12s} {state}")
        return

    browser = find_browser(args.browser)
    if not browser:
        print("⚠ 未找到 Edge / Chrome，跳过 A4 静态 PDF 预渲染。")
        print("  站点仍可用：归档页的「下载 PDF」会自动退化为「打印 → 另存为 PDF」。")
        return

    todo = [i for i in ids if args.force or not (PDF_DIR / f"{i}.pdf").exists()]
    if not todo:
        print("✅ 所有期次的静态 PDF 均已就绪，无需渲染（--force 可强制重渲染）")
        return

    print(f"▶ 使用 {pathlib.Path(browser).name} 渲染 {len(todo)} 期 A4 竖版 PDF")
    fail = []
    for bid in todo:
        out = PDF_DIR / f"{bid}.pdf"
        ok, secs = render(browser, bid, out, timeout=args.timeout, verbose=args.verbose)
        if ok:
            pages = pdf_pages(out)
            print(f"  ✓ {bid}　{out.stat().st_size/1024:.0f} KB"
                  + (f"　{pages} 页" if pages else "") + f"　（{secs}s）")
        else:
            fail.append(bid)
            print(f"  ✗ {bid}　渲染失败或超时（{secs}s）")

    # 清理临时用户目录
    for d in pathlib.Path("/tmp").glob("edge-a4pdf-*"):
        shutil.rmtree(d, ignore_errors=True)

    if fail:
        print(f"⚠ {len(fail)} 期未渲染成功：{', '.join(fail)}")
        print("  这些期次在归档页仍可导出，只是走「打印 → 另存为 PDF」路径。")
    else:
        print("✅ 静态 PDF 就绪。重跑 agent/build_data.py 以更新归档页的下载标记。")


if __name__ == "__main__":
    main()
