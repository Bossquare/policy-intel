#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
情报采集：按 agent/sources.json 抓取各单位信息发布栏目，抽取候选条目，
并对候选条目抓取详情页正文（写入 excerpt，供 analyze.py 判定分档）。

设计取向是「稳」而不是「全」：政府网站改版频繁，各站 DOM 结构差异大，
这里用通用启发式（链接文本 + URL 日期模式 + 行业关键词）抽取，
宁可漏几条，也不要引入大量噪音给后续分析增加负担。

两条抓取路径：
  1. curl 直接抓（覆盖大多数源）；
  2. 对第一轮 0 候选的源，用 `agent/render.js` 起无头浏览器渲染后再抓
     （住建部等站点是 JS 渲染，静态 HTML 只有几百字节空壳）。
     `--no-render` 可关掉，`--render-all` 可对全部源都走渲染。

用法：
    python3 agent/collect.py                 # 采集最近 7 天
    python3 agent/collect.py --days 14       # 采集最近 14 天
    python3 agent/collect.py --out out/raw.json
    python3 agent/collect.py --no-render --no-body   # 纯静态、不抓正文（快，调试用）
输出：
    agent/out/raw-<YYYY>-W<周数>.json
"""

import argparse
import concurrent.futures
import json
import pathlib
import re
import subprocess
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

# 预筛关键词：命中任一才进入候选。
# 这里刻意放宽「公文词」这一类——本项目的相关性判定由 analyze.py 的大模型完成，
# 采集端只负责把明显无关的（放假安排、人事名单、纯导航）挡在外面。
# 收窄过一次的教训：只留技术词会把《…"十五五"规划》《…新技术推广目录》这类
# 真正的政策文件挡掉，表现为「源明明有内容却 0 条」。
KEYWORDS = [
    # 技术/赛道词
    "智能建造", "BIM", "CIM", "数字孪生", "人工智能", "AI", "机器人", "装配式", "模块化",
    "智慧工地", "城市更新", "绿色建筑", "绿色建造", "双化协同", "数字化", "信息化", "数智",
    "智能", "标准", "导则", "试点", "示范", "评价", "智慧", "城市生命线", "数字家庭",
    "新技术", "新工艺", "智能审查", "施工图", "建筑节能", "碳排放",
    "科技", "研发", "技术创新",
    # 通用公文/规划词（靠模型分档，不在采集端判相关性）
    "规划", "条例", "办法", "实施细则", "工作方案", "实施方案", "管理办法", "管理制度",
    "征求意见", "目录", "推广", "鼓励", "清单", "指南", "规范", "技术政策", "十五五",
    "建设工程", "房屋建筑", "市政基础设施", "建筑业", "工程建设", "工程质量",
]

# 明显无关的标题（导航、栏目名等）
NOISE = [
    "更多", "下一页", "上一页", "首页", "网站地图", "联系我们", "无障碍", "登录", "注册",
    "政策解读", "政策法规", "通知公告", "工作动态", "信息公开", "政务服务", "办事指南",
    "返回", "打印", "关闭", "分享",
]

# 标题含这些片段的直接丢弃（命中关键词但与本赛道无关的日常公文）
NOISE_SUBSTR = [
    "放假", "节假日", "值班", "人事任免", "干部任免", "任免", "职称", "招聘", "选调",
    "公务员", "信访", "年度报表", "工作报告", "提案", "人大建议", "政协", "变更公告",
    "注销公告", "遗失", "迁址", "搬迁",
]

# 单源候选上限：放宽关键词后，用上限兜住「档案型」栏目的历史存量
MAX_PER_SOURCE = 15

# ---------- 正文抓取 ----------
RENDER_JS = AGENT / "render.js"
BODY_MAX_CHARS = 1600        # 正文截断长度：够模型判断强制要求/量化指标，又控住 token
BODY_WORKERS = 6             # 正文抓取并发
BODY_MIN_CHARS = 120         # 少于这个长度视为没抓到正文（可能是反爬页/空壳）

# 详情页正文最常见的容器（命中就只在这个容器里取文本）
BODY_SELECTORS = [
    r'<div[^>]+id=["\'](?:zoom|content|Content|article|articleContent|mainText)["\']',
    r'<div[^>]+class=["\'][^"\']*(?:article[-_]?content|content[-_]?box|TRS_Editor|view[-_]?content|'
    r'news[-_]?content|detail[-_]?content|zwxl[-_]?content|main[-_]?content|article)["\']',
    r'<article[^>]*>',
    r'<div[^>]+class=["\'][^"\']*(?:conTxt|txt[-_]?con|zhengwen|zwcon)["\']',
]
BODY_SELECTOR_RE = re.compile("|".join(BODY_SELECTORS), re.I)
STRIP_RE = re.compile(
    r"<(script|style|noscript|iframe|svg|form|button)\b.*?</\1\s*>", re.S | re.I)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
# 页脚/工具栏里的常见噪声句，抓正文时清掉
BODY_NOISE = [
    "打印本页", "关闭窗口", "分享到", "扫一扫", "返回顶部", "字体：", "大 中 小",
    "浏览次数", "文章来源", "责任编辑", "上一篇", "下一篇", "相关阅读", "网站地图",
    "版权所有", "ICP备", "网站标识码", "公安机关备案号", "主办单位", "技术支持",
    "公网安备", "附件之附件", "附件下载", "政策解读", "关联稿件", "分享：",
]

# 发布日期是否落在采集窗口内：窗口按「上一个完整自然周」理解，见 main()
LINK_RE = re.compile(r'<a\s[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.S | re.I)
TAG_RE = re.compile(r"<[^>]+>")
DATE8_RE = re.compile(r"(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])")
DATE_CN_RE = re.compile(r"(20\d{2})[-/年]?(0[1-9]|1[0-2])[-/月]?(0[1-9]|[12]\d|3[01])")
# 部分栏目把日期拼在链接文字里（「…的通知2026-09-18」或「2026-09-16 某地召开…」），
# URL 里没有日期，仅靠 URL 会漏掉、或让过期条目漏筛。
TITLE_DATE_RE = re.compile(r"(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?")
# 链接后同级节点里的日期：<a>标题</a><span>2026-09-16</span>
CTX_DATE_RE = re.compile(r"(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})")

# 「公文/活动」标记：无日期的候选必须命中其一才收录，
# 用来滤掉栏目名、导航链接、单位名这类纯名词锚文本（如「绿色建造与智能建筑」）。
DOC_MARKERS = [
    "关于", "通知", "公告", "公示", "印发", "发布", "征求", "办法", "方案", "规划",
    "意见", "决定", "批复", "通报", "会议", "举办", "开展", "征集", "试点", "示范",
    "申报", "评审", "培训", "大赛", "竞赛", "观摩", "政策", "措施", "条例", "细则",
    "指南", "部令", "评估",
]


def _decode(raw: bytes) -> str:
    for enc in ("utf-8", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def fetch(url: str, timeout: int = 20) -> str:
    """抓取页面 HTML。

    优先走 curl：国内政务站点普遍对 Python/OpenSSL 的 TLS 握手直接断连
    （报 SSL: UNEXPECTED_EOF_WHILE_READING），curl 握手正常、覆盖率显著更高。
    `--noproxy '*'` 是必须的——直连不走本机代理，否则国内站点会被代理拦成 502。
    curl 拿不到内容时回退 urllib，保证在没装 curl 的环境里仍能跑。
    """
    try:
        r = subprocess.run(
            ["curl", "-s", "--noproxy", "*", "-L", "--max-time", str(timeout),
             "-A", UA,
             "-H", "Accept: text/html,application/xhtml+xml",
             "-H", "Accept-Language: zh-CN,zh;q=0.9",
             url],
            capture_output=True, timeout=timeout + 10)
        if r.stdout and r.stdout.strip():
            return _decode(r.stdout)
    except Exception:                                          # noqa: BLE001
        pass

    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return _decode(raw)


def _mk_date(y, mo, dd) -> str:
    try:
        return datetime(int(y), int(mo), int(dd)).strftime("%Y-%m-%d")
    except ValueError:
        return ""


def split_title_date(title: str):
    """把链接文字里的日期切出来。返回 (去掉日期的标题, 日期 or "")。

    只在日期位于首或尾时才认——夹在标题中间的通常是正文语义
    （如「…2026年1月1日起施行」），当成发布时间会误筛。
    """
    m = TITLE_DATE_RE.search(title)
    if not m:
        return title, ""
    if m.start() > 1 and m.end() < len(title) - 1:
        return title, ""
    d = _mk_date(m.group(1), m.group(2), m.group(3))
    if not d:
        return title, ""
    return (title[:m.start()] + title[m.end():]).strip(" 　-—、"), d


def date_from_context(html_chunk: str) -> str:
    """从链接之后的同级节点文本里找日期（列表页常见 `<a>标题</a><span>日期</span>`）。

    只看到「下一个 <a>」为止：列表页里日期常挂在整条记录上，
    不设这条护栏会把下一条的日期错配到本条，导致条目被误当过期筛掉。
    """
    cut = html_chunk.lower().find("<a ")
    if cut != -1:
        html_chunk = html_chunk[:cut]
    m = CTX_DATE_RE.search(clean_text(html_chunk))
    if not m:
        return ""
    return _mk_date(m.group(1), m.group(2), m.group(3))


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
    if any(n in title for n in NOISE_SUBSTR):
        return False
    return any(k in title for k in KEYWORDS)


def collect_source(src: dict, since: datetime):
    """静态抓取一个源。返回候选条目（渲染兜底走 extract_items，不经过这里）。"""
    base = src["url"]
    try:
        html = fetch(base)
    except Exception as e:                                    # noqa: BLE001
        print(f"    ✗ 抓取失败：{e}")
        return []
    return extract_items(html, src, since)


def extract_items(html: str, src: dict, since: datetime):
    """从栏目页 HTML 抽候选条目。curl 直抓与无头渲染两条路径共用此函数。"""
    base = src["url"]
    found, seen = [], set()
    for m in LINK_RE.finditer(html):
        raw_title = clean_text(m.group(2))
        if not looks_relevant(raw_title):
            continue
        url = urllib.parse.urljoin(base, m.group(1))
        if url in seen:
            continue
        seen.add(url)

        title, d = split_title_date(raw_title)
        if not d:
            d = date_from(url)
        if not d:
            d = date_from_context(html[m.end():m.end() + 180])

        # 无日期的候选：要求命中公文/活动标记，滤掉栏目名、导航锚文本
        if not d:
            if len(title) < 12 or not any(k in title for k in DOC_MARKERS):
                continue

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

    # 有日期的按新→旧排前面，无日期的殿后；超上限的来源只留最新的若干条
    found.sort(key=lambda x: x["date"], reverse=True)
    if len(found) > MAX_PER_SOURCE:
        print(f"    （候选 {len(found)} 条，按发布时间截取最新 {MAX_PER_SOURCE} 条）")
        found = found[:MAX_PER_SOURCE]
    return found


# ---------- 正文抓取 ----------

def extract_main_text(html: str) -> str:
    """从详情页 HTML 提取正文纯文本。

    政府站详情页结构千差万别，这里走「先找常见正文容器、找不到就退回全文」
    的两段式：命中容器时噪声最少；退回全文时靠 BODY_NOISE 清页脚。
    """
    h = COMMENT_RE.sub(" ", html)
    h = STRIP_RE.sub(" ", h)

    m = BODY_SELECTOR_RE.search(h)
    if m:
        # 正则只匹配到开标签的属性部分，必须再跳到该标签的 '>' 之后，
        # 否则会从属性中间切开，把 <div ...> 的碎片混进正文。
        gt = h.find(">", m.end())
        start = (gt + 1) if gt != -1 else m.end()
        # 从容器开头往后取一段足够长的原文再剥离标签，避免整页导航混进来
        chunk = h[start:start + BODY_MAX_CHARS * 6]
    else:
        chunk = h

    text = TAG_RE.sub("\n", chunk)
    text = (text.replace("&nbsp;", " ").replace("&emsp;", " ")
                .replace("&ldquo;", "“").replace("&rdquo;", "”")
                .replace("&mdash;", "—").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"'))

    lines = []
    for ln in text.split("\n"):
        ln = re.sub(r"[ \t\u3000]+", " ", ln).strip()
        if len(ln) < 6:                       # 丢掉按钮、单字导航
            continue
        if any(n in ln for n in BODY_NOISE):
            continue
        if ln in lines:                       # 同页重复的板块标题
            continue
        lines.append(ln)

    body = "\n".join(lines)
    return body[:BODY_MAX_CHARS]


def fetch_body(item: dict) -> str:
    """抓一条候选的详情页正文。失败返回空串（不抛错，正文只是增强项）。"""
    try:
        html = fetch(item["url"], timeout=25)
    except Exception:                                          # noqa: BLE001
        return ""
    text = extract_main_text(html)
    return text if len(text) >= BODY_MIN_CHARS else ""


def attach_bodies(items: list):
    """并发给候选条目补 excerpt 字段（analyze.py 已预留该字段）。"""
    if not items:
        return
    print(f"\n▶ 抓取正文（{len(items)} 条，并发 {BODY_WORKERS}）")
    with concurrent.futures.ThreadPoolExecutor(max_workers=BODY_WORKERS) as ex:
        texts = list(ex.map(fetch_body, items))
    hit = 0
    for it, t in zip(items, texts):
        it["excerpt"] = t
        if t:
            hit += 1
    print(f"   正文命中 {hit}/{len(items)} 条"
          f"（{len(items) - hit} 条未取到，将仅凭标题判断）")


# ---------- 无头渲染兜底 ----------

def find_browser() -> str:
    for c in ("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"):
        if pathlib.Path(c).exists():
            return c
    return ""


def find_node() -> str:
    for c in ("/Users/tommy_fang/.workbuddy/binaries/node/versions/22.22.2-3/bin/node",
              "/usr/local/bin/node", "/opt/homebrew/bin/node", "node"):
        if c == "node":
            return c
        if pathlib.Path(c).exists():
            return c
    return ""


def render_sources(srcs: list, since: datetime, settle: int = 6000):
    """对静态抓不到候选的源，用无头浏览器渲染后再解析。

    站点是 JS 渲染时，curl 拿到的 HTML 只有几百字节空壳（列表在渲染后才出现），
    所以这条路不是优化、是唯一能拿到内容的办法。

    settle 默认 6s：浙江/江苏/杭州这类站的列表是异步补进来的，等太短会拿到空列表
    （实测 2.5s 拿不到、8s 能拿到）。
    """
    if not srcs:
        return {}
    if not RENDER_JS.exists():
        print("  ⚠ 未找到 agent/render.js，跳过渲染兜底")
        return {}
    browser, node = find_browser(), find_node()
    if not browser:
        print("  ⚠ 未找到 Edge / Chrome，跳过渲染兜底")
        return {}

    print(f"\n▶ 无头渲染兜底（{len(srcs)} 个源，浏览器 {pathlib.Path(browser).name}）")
    tmp = pathlib.Path("/tmp/policy-intel-render")
    tmp.mkdir(parents=True, exist_ok=True)
    jobs = [{"key": f"s{i:02d}", "url": s["url"]} for i, s in enumerate(srcs)]
    urls_file = tmp / "urls.json"
    urls_file.write_text(json.dumps(jobs, ensure_ascii=False), encoding="utf-8")

    cmd = [node, str(RENDER_JS), "--urls", str(urls_file),
           "--out", str(tmp / "dom"), "--browser", browser, "--settle", str(settle)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        print("  ⚠ 渲染超时，跳过兜底")
        return {}

    for line in r.stdout.splitlines():
        if line.startswith("RENDER_RESULT "):
            try:
                summary = json.loads(line[len("RENDER_RESULT "):])
                settled = {x["key"]: x["file"] for x in summary.get("ok", [])}
                break
            except ValueError:
                pass
    else:
        print(f"  ⚠ 渲染未返回结果：{(r.stderr or r.stdout)[-200:]}")
        return {}

    out = {}
    for i, s in enumerate(srcs):
        f = settled.get(f"s{i:02d}")
        if not f or not pathlib.Path(f).exists():
            continue
        try:
            html = pathlib.Path(f).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        found = extract_items(html, s, since)
        if found:
            out[s["name"]] = found
            print(f"  ✓ {s['name'][:30]:32} +{len(found)} 条")
        else:
            print(f"  · {s['name'][:30]:32} 渲染后仍无窗口内条目")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7, help="回看天数，默认 7")
    ap.add_argument("--out", default="", help="输出文件路径（默认自动按周命名）")
    ap.add_argument("--no-render", action="store_true", help="不做无头渲染兜底")
    ap.add_argument("--render-all", action="store_true", help="所有源都走渲染（调试用）")
    ap.add_argument("--no-body", action="store_true", help="不抓详情页正文（调试用）")
    args = ap.parse_args()

    if not SOURCES.exists():
        sys.exit(f"缺少源清单：{SOURCES}")

    sources = json.loads(SOURCES.read_text(encoding="utf-8"))["sources"]
    now = datetime.now(CST)
    # 窗口口径：覆盖「上一个完整自然周」，即 [上周一 00:00, 上周日 24:00)。
    # 周一早上跑、--days 7 时，since 正好落在上周一 00:00。
    # 期号取窗口最后一天所属的 ISO 周——若直接用 now.isocalendar()，
    # 周一早上会把上周的数据标成本周的期号（W39 而非 W38）。
    ref = now - timedelta(days=1)
    since = (now - timedelta(days=args.days)).replace(
        hour=0, minute=0, second=0, microsecond=0)

    print(f"采集窗口：{since:%Y-%m-%d} 至 {ref:%Y-%m-%d}，共 {len(sources)} 个源")
    all_items, empty_srcs = [], []
    for i, src in enumerate(sources, 1):
        print(f"  [{i}/{len(sources)}] {src['name']}")
        if args.render_all:
            got = []
        else:
            got = collect_source(src, since)
            print(f"    → {len(got)} 条")
        if not got:
            empty_srcs.append(src)
        all_items.extend(got)

    # 第一轮 0 候选的源：可能是 JS 渲染，用无头浏览器再试一次
    if not args.no_render and empty_srcs:
        rendered = render_sources(empty_srcs, since)
        for src in empty_srcs:
            got = rendered.get(src["name"], [])
            all_items.extend(got)
        empty_srcs = [s for s in empty_srcs if s["name"] not in rendered]

    # 去重：同 URL 或同标题只留一条
    dedup, seen_url, seen_title = [], set(), set()
    for it in all_items:
        key_t = re.sub(r"\s+", "", it["title"])
        if it["url"] in seen_url or key_t in seen_title:
            continue
        seen_url.add(it["url"])
        seen_title.add(key_t)
        dedup.append(it)

    if not args.no_body:
        attach_bodies(dedup)

    year, week, _ = ref.isocalendar()
    out = pathlib.Path(args.out) if args.out else OUTDIR / f"raw-{year}-W{week:02d}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "generated_at": now.strftime("%Y-%m-%d %H:%M"),
        "window_days": args.days,
        "count": len(dedup),
        "items": dedup,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    bodies = sum(1 for i in dedup if i.get("excerpt"))
    print(f"\n✅ 写出 {out}")
    print(f"   去重后 {len(dedup)} 条（含正文 {bodies} 条）")
    if empty_srcs:
        print(f"   ⚠️ 以下 {len(empty_srcs)} 个源本次 0 条，请核对栏目地址是否变更：")
        for s in empty_srcs:
            print(f"      - {s['name']}")


if __name__ == "__main__":
    main()
