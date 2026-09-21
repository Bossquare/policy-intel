#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
情报分析：调用大模型完成摘要提取、赛道相关性判定与三档分类；
对判定为「重点关注」的条目，追加产出影响分析与应对建议草稿（供人工复核）。

模型端点不做任何硬编码，按以下优先级读取（三级都读不到时自动降级为规则打分）：
    1. 环境变量 INTEL_LLM_URL / INTEL_LLM_MODEL / INTEL_LLM_KEY
    2. 本地配置文件 agent/llm.local.json（已在 .gitignore 中，不会进版本库）
       格式：{"url": "<OpenAI 兼容的 chat/completions 地址>", "model": "<模型名>", "api_key": "<可选>"}
    3. 未配置 → 同 --dry-run，仅用关键词规则打分
接口需为 OpenAI 兼容格式（POST /chat/completions）。

用法：
    python3 agent/analyze.py                      # 分析最新一份 raw 文件
    python3 agent/analyze.py --input out/raw-2026-W38.json
    python3 agent/analyze.py --dry-run            # 不调模型，仅用规则打分（离线演练）
输出：
    agent/out/analyzed-<同上后缀>.json
"""

import argparse
import json
import os
import pathlib
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
AGENT = ROOT / "agent"
OUTDIR = AGENT / "out"

LLM_LOCAL = AGENT / "llm.local.json"


def _load_llm_conf():
    """读取模型端点配置。环境变量优先，其次本地配置文件 agent/llm.local.json。

    端点信息一律不写进代码，避免随公开仓库外泄。
    """
    url = model = key = ""
    if LLM_LOCAL.exists():
        try:
            conf = json.loads(LLM_LOCAL.read_text(encoding="utf-8"))
            url = conf.get("url", "")
            model = conf.get("model", "")
            key = conf.get("api_key", "")
        except Exception as e:                                # noqa: BLE001
            print(f"⚠️ 本地模型配置 {LLM_LOCAL.name} 解析失败，已忽略：{e}")
    return (
        os.environ.get("INTEL_LLM_URL", url).strip(),
        os.environ.get("INTEL_LLM_MODEL", model).strip(),
        os.environ.get("INTEL_LLM_KEY", key).strip(),
    )


LLM_URL, LLM_MODEL, LLM_KEY = _load_llm_conf()
LLM_READY = bool(LLM_URL and LLM_MODEL)

CST = timezone(timedelta(hours=8))

TRACKS = {
    "smart-building": "智慧建筑／楼宇智能化、智能家居、数字家庭、好房子",
    "bim-cim": "BIM／CIM／数字孪生、实景三维、电子文件、建模算量、赋码",
    "intelligent-construction": "智能建造／建筑机器人、装配式与模块化、智能装备、智慧工地",
    "green-smart": "绿色建造、双化协同、低碳与能耗管理",
    "urban-renewal": "城市更新、老旧小区、城市生命线、韧性城市",
    "ai-building": "AI＋建筑：招投标、审图、造价、工地识别等环节落地",
}
CORE = ["bim-cim", "intelligent-construction", "ai-building"]

# 规则兜底：模型不可用时使用
TRACK_KEYWORDS = {
    "smart-building": ["智慧建筑", "智能家居", "数字家庭", "楼宇", "好房子"],
    "bim-cim": ["BIM", "CIM", "数字孪生", "实景三维", "电子文件", "信息模型", "建模", "算量", "赋码"],
    "intelligent-construction": ["智能建造", "机器人", "装配式", "模块化", "智能装备", "智慧工地", "数字勘察"],
    "green-smart": ["绿色建造", "绿色建筑", "双化协同", "低碳", "能耗", "碳达峰"],
    "urban-renewal": ["城市更新", "老旧小区", "城市生命线", "韧性城市", "新城建"],
    "ai-building": ["人工智能", "AI", "大模型", "辅助评标", "智能审查", "数智"],
}
FORCE_SIGNALS = ["强制", "全面", "规模化", "须", "必须", "目标", "累计", "占比", "不低于", "全覆盖", "以上项目"]
WEAK_FORMS = ("企业新闻", "行业论坛", "现场观摩会", "名单公布", "人事文件", "行业大会", "展会", "活动")

SYSTEM_PROMPT = """你是建筑智能化行业的政策情报分析师，为一家主营「建筑智能化 / 智能建造 / BIM 与工程数字化」的公司做政策跟踪。

对给定的每一条信息，你需要输出：

1. summary：3-4 条核心要点。每条不超过 45 字，只依据给定材料，不得编造文中没有的数据、文号或结论。若材料不足以判断，直接写明「材料不足」。
2. tracks：命中以下赛道的 id（可多选，也可为空数组）：
   - smart-building 智慧建筑（楼宇智能化、智能家居、数字家庭、好房子）
   - bim-cim BIM/CIM/数字孪生（实景三维、电子文件、建模算量、赋码）
   - intelligent-construction 智能建造（建筑机器人、装配式与模块化、智能装备、智慧工地）
   - green-smart 绿色智能（绿色建造、双化协同、低碳能耗）
   - urban-renewal 城市更新（老旧小区、城市生命线、韧性城市）
   - ai-building AI+建筑（招投标、审图、造价、工地识别等环节的 AI 落地）
3. relevance：0-100 的整数，表示与上述主营赛道的相关性。
4. tier：三档之一
   - focus 重点关注：国家层面发布且命中核心赛道，或地方层面命中核心赛道且含强制要求/量化指标/可考核目标
   - track 持续跟踪：标准征求意见、地方规划与试点名单、非重点省市方案等，相关但暂不紧急
   - watch 一般了解：展会论坛、企业动态、人事调整、协会名单等
5. reason：一句话说明分档依据（不超过 50 字）。

材料里若给了「正文片段」，那是详情页正文（可能被截断、可能夹带页脚文字）。
**分档判定要优先采信正文**：正文里出现强制表述（“应当/必须/不得/自…起施行”）、
量化指标（面积、比例、金额、期限、项目数量）或资金/考核安排时，地方条目也可判 focus；
只有标题、没有正文（材料显示未抓取正文）时，不得臆测存在强制要求，按标题保守分档并在 reason 里注明「正文缺失」。
正文里的会议签到、联系方式、页脚版权等无关内容一律忽略。

严格输出 JSON，不要任何多余文字。格式：
{"summary":["...","..."],"tracks":["bim-cim"],"relevance":85,"tier":"focus","reason":"..."}"""


def chat(messages, temperature=0.2, max_tokens=3000, timeout=200, retries=3):
    """调用模型，返回 assistant 正文。

    这个端点上的模型是「先思考后作答」，**推理 token 也计入 max_tokens**：
    给小了会直接返回 finish_reason=length 且 content 为空字符串——看起来像
    「模型没响应」，其实是额度被推理链吃光（实测一条分析要 ~1700 token 才吐正文）。
    所以默认值给到 3000，遇到 length 截断再自动加倍重试。
    """
    last = None
    tokens = max_tokens
    for attempt in range(retries + 1):
        body = json.dumps({
            "model": LLM_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": tokens,
        }).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if LLM_KEY:
            headers["Authorization"] = f"Bearer {LLM_KEY}"
        try:
            req = urllib.request.Request(LLM_URL, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read().decode("utf-8"))
            choice = data["choices"][0]
            text = ((choice.get("message") or {}).get("content") or "").strip()
            if text:
                return text
            fin = choice.get("finish_reason")
            last = RuntimeError(
                f"模型返回空正文（finish_reason={fin}，max_tokens={tokens}）")
            if fin == "length":
                tokens = min(tokens * 2, 12000)
        except Exception as e:                                # noqa: BLE001
            last = e
        if attempt < retries:
            # 端点偶发 403 / 429（限流或并发过载），退避久一点再试
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"模型调用失败：{last}")


def parse_json(text: str):
    """模型有时会用 ``` 包裹，做一次容错提取。"""
    text = re.sub(r"^\s*```(?:json)?|```\s*$", "", text.strip(), flags=re.M)
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("返回中未找到 JSON")
    return json.loads(m.group(0))


def rule_fallback(it):
    text = it["title"] + " " + it.get("source_name", "")
    tracks = [k for k, kws in TRACK_KEYWORDS.items() if any(w in text for w in kws)]
    strong = bool(set(tracks) & set(CORE))
    forced = any(s in text for s in FORCE_SIGNALS)
    if it.get("level") == "national":
        tier = "focus" if strong else "track"
    elif it.get("level") == "key-city":
        tier = "focus" if (strong and forced) else ("track" if strong else "watch")
    elif it.get("level") == "other":
        tier = "track" if strong else "watch"
    else:
        tier = "watch"
    base = {"national": 55, "key-city": 45, "other": 35, "industry": 30}.get(it.get("level"), 30)
    rel = min(98, base + 10 * len(tracks) + (18 if strong else 0) + (10 if forced else 0))
    return {
        "summary": [it["title"]],
        "tracks": tracks,
        "relevance": rel,
        "tier": tier,
        "reason": "规则兜底（未调用模型）",
    }


def analyze_one(it):
    user = (
        f"标题：{it['title']}\n"
        f"发布单位：{it.get('source_name','')}\n"
        f"栏目层级：{it.get('level','')}（{it.get('region','')}）\n"
        f"日期：{it.get('date') or '未知'}\n"
        f"链接：{it['url']}\n"
        f"正文片段：{it.get('excerpt','（未抓取正文，仅凭标题判断）')}\n"
    )
    content = chat([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ])
    r = parse_json(content)
    r.setdefault("tracks", [])
    r.setdefault("summary", [])
    r["tracks"] = [t for t in r["tracks"] if t in TRACKS]
    if r.get("tier") not in ("focus", "track", "watch"):
        r["tier"] = "track"
    r["relevance"] = int(r.get("relevance", 50))
    return r


INSIGHT_PROMPT = """你是建筑智能化行业的政策情报分析师。基于给定的政策条目，
为公司（主营：建筑智能化、智能建造、BIM 与工程数字化）撰写两段内容：

impact：影响分析。说明这条政策/标准/动态会怎样传导到行业与公司业务，120-180 字。
action：应对建议。给出 2-3 条可执行动作，用「① ② ③」编号，120-180 字。

要求：只依据给定材料推断，不编造未提及的数据与文号；判断要具体，避免「需持续关注」这类空话。
严格输出 JSON：{"impact":"...","action":"..."}"""


def make_insight(it, analysis):
    body = (it.get("excerpt") or "").strip()
    user = (
        f"标题：{it['title']}\n发布单位：{it.get('source_name','')}\n日期：{it.get('date') or '未知'}\n"
        f"要点：{'；'.join(analysis.get('summary', []))}\n"
        f"命中赛道：{', '.join(analysis.get('tracks', []))}\n"
        f"链接：{it['url']}"
    )
    if body:
        # 正文里才有具体的强制表述与量化指标，影响分析要做到具体就必须给正文
        user += f"\n正文（可能截断）：\n{body[:900]}"
    content = chat([
        {"role": "system", "content": INSIGHT_PROMPT},
        {"role": "user", "content": user},
    ], temperature=0.4, max_tokens=3000)
    r = parse_json(content)
    return r.get("impact", ""), r.get("action", "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="", help="raw JSON 路径，默认取 out/ 下最新一份")
    ap.add_argument("--dry-run", action="store_true", help="不调模型，仅用规则打分")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 条（调试用）")
    ap.add_argument("--no-insight", action="store_true", help="跳过影响分析生成")
    args = ap.parse_args()

    use_rule = args.dry_run or not LLM_READY
    if not args.dry_run and not LLM_READY:
        print("⚠️ 未检测到模型端点配置（环境变量或 agent/llm.local.json），本次仅用规则打分。")

    if args.input:
        src_path = pathlib.Path(args.input)
    else:
        cands = sorted(OUTDIR.glob("raw-*.json"))
        if not cands:
            sys.exit("out/ 下没有 raw-*.json，请先运行 collect.py")
        src_path = cands[-1]
    raw = json.loads(src_path.read_text(encoding="utf-8"))
    items = raw["items"]
    if args.limit:
        items = items[:args.limit]

    print(f"输入：{src_path.name}（{len(items)} 条）")
    mode = "规则打分（未调用模型）" if use_rule else f"模型 {LLM_MODEL}"
    print(f"分析模式：{mode}")

    results, failed = [], 0
    for i, it in enumerate(items, 1):
        print(f"  [{i}/{len(items)}] {it['title'][:42]}")
        try:
            r = rule_fallback(it) if use_rule else analyze_one(it)
            print(f"      → {r['tier']} / 相关性 {r['relevance']} / {','.join(r['tracks']) or '无赛道'}")
        except Exception as e:                                # noqa: BLE001
            r = rule_fallback(it)
            r["reason"] += f"（模型失败已兜底：{e}）"
            failed += 1
            print(f"      ! 失败，已兜底：{e}")

        it.update({
            "summary": r["summary"],
            "tracks": r["tracks"],
            "relevance": r["relevance"],
            "tier": r["tier"],
            "tier_reason": r["reason"],
            "impact": "",
            "action": "",
        })
        results.append(it)
        if not use_rule:
            time.sleep(0.8)          # 别把端点打太快：连续请求会被 403 限流

    if not use_rule and not args.no_insight:
        focus = [x for x in results if x["tier"] == "focus"]
        print(f"\n为 {len(focus)} 条「重点关注」生成影响分析与应对建议草稿")
        for i, it in enumerate(focus, 1):
            try:
                impact, action = make_insight(it, it)
                it["impact"], it["action"] = impact, action
                print(f"  [{i}/{len(focus)}] ✓ {it['title'][:36]}")
            except Exception as e:                            # noqa: BLE001
                print(f"  [{i}/{len(focus)}] ! 生成失败：{e}")
            time.sleep(0.8)

    out = OUTDIR / src_path.name.replace("raw-", "analyzed-")
    now = datetime.now(CST)
    out.write_text(json.dumps({
        "generated_at": now.strftime("%Y-%m-%d %H:%M"),
        "source_file": src_path.name,
        "analyzer": "rule" if use_rule else "llm",
        "count": len(results),
        "failed": failed,
        "items": results,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    focus_n = sum(1 for x in results if x["tier"] == "focus")
    print(f"\n✅ 写出 {out}")
    print(f"   共 {len(results)} 条：重点关注 {focus_n} / 其余 {len(results) - focus_n}")
    if failed:
        print(f"   ⚠️ {failed} 条因模型调用失败走了规则兜底，建议复核")


if __name__ == "__main__":
    main()
