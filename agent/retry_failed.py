#!/usr/bin/env python3
"""补跑分析：只重跑 analyzed-*.json 里「走规则兜底」的条目，并重建期级研判。

为什么需要它
------------
模型端点会偶发 429（限流）。analyze.py 遇到失败条目会降级为规则打分、期级研判
直接标 failed —— 结果就是首页「本期核心结论」空白、少数条目分档凭关键词粗判。
整条流水线重跑要十几分钟，且大概率再次 429；本脚本只补那几条 + 一次研判，
通常两三分钟，且不动已经分析成功的条目。

用法
----
    python3 agent/retry_failed.py                    # 自动取 out/ 下最新 analyzed-*
    python3 agent/retry_failed.py --input agent/out/analyzed-2026-W40.json
    python3 agent/retry_failed.py --dry-run          # 只列出待补条目，不调模型

补完还要重跑成稿（analyze 的结果不会自动进站点）：

    python3 agent/build_data.py
"""
import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import analyze as A  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="", help="analyzed-*.json 路径，默认取 out/ 下最新一份")
    ap.add_argument("--no-narrative", action="store_true", help="不重建期级研判")
    ap.add_argument("--dry-run", action="store_true", help="只列出待补条目，不调模型")
    args = ap.parse_args()

    if args.input:
        ana_path = pathlib.Path(args.input)
    else:
        cands = sorted(A.OUTDIR.glob("analyzed-*.json"))
        if not cands:
            sys.exit("out/ 下没有 analyzed-*.json，请先运行 analyze.py")
        ana_path = cands[-1]

    ana = json.loads(ana_path.read_text(encoding="utf-8"))
    raw_name = ana.get("source_file") or ana_path.name.replace("analyzed-", "raw-")
    raw_path = A.OUTDIR / raw_name
    if not raw_path.exists():
        sys.exit(f"找不到对应的 raw：{raw_path}")
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    raw_by_url = {it["url"]: it for it in raw["items"]}

    items = ana["items"]
    failed_idx = [i for i, it in enumerate(items)
                  if "规则兜底" in (it.get("tier_reason") or "")]
    need_insight = [i for i, it in enumerate(items)
                    if it.get("tier") == "focus" and not (it.get("impact") or "").strip()]

    print(f"输入：{ana_path.name}（对应 {raw_name}，共 {len(items)} 条）")
    print(f"待重跑条目（走规则兜底）：{len(failed_idx)} 条")
    for i in failed_idx:
        r = (items[i].get("tier_reason") or "").split("（模型失败已兜底：")[-1].rstrip("）")
        print(f"  - [{items[i].get('tier','?')}] {items[i]['title'][:44]}")
        print(f"      原因：{r[:70]}")
    print(f"缺影响分析的 focus 条目：{len(need_insight)} 条")

    if args.dry_run:
        print("\n（--dry-run：未调用模型）")
        return

    if not A.LLM_READY:
        sys.exit("未检测到模型端点配置，无法补跑")

    # ── 1. 重跑失败条目 ────────────────────────────────────────────────
    fixed = 0
    if failed_idx:
        print(f"\n重跑 {len(failed_idx)} 条（模型 {A.LLM_MODEL}）")
    for n, i in enumerate(failed_idx, 1):
        it = items[i]
        src = raw_by_url.get(it["url"])
        if not src:
            print(f"  [{n}/{len(failed_idx)}] ! raw 中找不到对应条目，跳过：{it['title'][:30]}")
            continue
        print(f"  [{n}/{len(failed_idx)}] {it['title'][:42]}")
        try:
            r = A.analyze_one(src)
        except Exception as e:  # noqa: BLE001
            print(f"      ! 仍然失败：{e}")
            continue
        it.update({
            "summary": r["summary"],
            "tracks": r["tracks"],
            "relevance": r["relevance"],
            "tier": r["tier"],
            "tier_reason": r["reason"],
        })
        fixed += 1
        print(f"      → {r['tier']} / 相关性 {r['relevance']} / {','.join(r['tracks']) or '无赛道'}")
        time.sleep(1.2)

    # ── 2. 补 focus 的影响分析（含重跑后新升档的条目）────────────────────
    need_insight = [i for i, it in enumerate(items)
                    if it.get("tier") == "focus" and not (it.get("impact") or "").strip()]
    if need_insight:
        print(f"\n为 {len(need_insight)} 条「重点关注」补生成影响分析与应对建议")
        for n, i in enumerate(need_insight, 1):
            it = items[i]
            print(f"  [{n}/{len(need_insight)}] {it['title'][:36]}")
            try:
                impact, action = A.make_insight(items[i], items[i])
                it["impact"], it["action"] = impact, action
            except Exception as e:  # noqa: BLE001
                print(f"      ! 失败：{e}")
            time.sleep(1.2)

    # ── 3. 重建期级研判 ────────────────────────────────────────────────
    if not args.no_narrative:
        w = ana.get("window") or {}
        period = f"{w.get('start','')} 至 {w.get('end','')}" if w else ""
        print(f"\n重建期级研判（核心结论 / 市场影响 / 趋势展望），窗口 {period}")
        try:
            ana["narrative"] = A.make_narrative(items, period)
            ana["narrative_mode"] = "llm"
            nv = ana["narrative"]
            print(f"  ✓ 结论 {len(nv['conclusions'])} / "
                  f"影响 {len(nv['impacts'])} / 展望 {len(nv['outlook'])}")
        except Exception as e:  # noqa: BLE001
            ana["narrative_mode"] = "failed"
            print(f"  ! 研判生成失败：{e}")

    ana["failed"] = sum(1 for it in items if "规则兜底" in (it.get("tier_reason") or ""))
    ana["retry_at"] = time.strftime("%Y-%m-%d %H:%M")
    ana_path.write_text(json.dumps(ana, ensure_ascii=False, indent=2), encoding="utf-8")

    focus_n = sum(1 for x in items if x["tier"] == "focus")
    print(f"\n✅ 已写回 {ana_path}")
    print(f"   补跑成功 {fixed} / {len(failed_idx)} 条；剩余兜底 {ana['failed']} 条")
    print(f"   分档：重点关注 {focus_n} / 其余 {len(items) - focus_n}")
    print(f"   研判：{ana['narrative_mode']}")
    print("\n下一步：python3 agent/build_data.py  （把分析结果重新成稿到站点）")


if __name__ == "__main__":
    main()
