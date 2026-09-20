# 建筑智能化政策与技术情报站

按周自动跟踪住建领域**政策文件、标准发布与技术动态**，完成摘要提取、赛道相关性判定与三档分类，
对强相关条目输出影响分析与应对建议，形成可归档的情报简报，并以静态站点形式对外发布。

站点地址：https://bossquare.github.io/policy-intel/

---

## 这个项目解决什么

行业政策信息散落在住建部、国新办、二十多个省市住建部门和若干行业协会的网站上，
人工盯不过来，漏掉一条标准征求意见就可能错过整个项目的技术响应窗口。

本项目把这件事变成一条自动流水线：

```
定向采集  →  摘要提取  →  相关性判定  →  三档分类  →  影响分析与成稿归档
```

- **三档分类**：重点关注 / 持续跟踪 / 一般了解
- **相关性口径**：六条主营赛道（智慧建筑、BIM/CIM、智能建造、绿色智能、城市更新、AI+建筑）
- **强相关条目**：同步输出影响分析与应对建议
- **归档**：每期简报独立冻结，历史可追溯

## 站点结构

| 页面 | 作用 |
|---|---|
| `index.html` | 情报看板：本期概览、核心结论、三档条目、赛道热度、影响分析、趋势展望 |
| `items.html` | 条目库：按档级 / 层级 / 赛道 / 关键词交叉筛选 |
| `item.html?id=` | 条目详情：完整信息、核心内容、影响分析、应对建议、来源与可信度 |
| `briefs.html` | 简报归档列表 |
| `brief.html?id=` | 单期简报全文，支持打印 / 导出 PDF |
| `agent.html` | 智能体说明：运行周期、处理流程、分档口径、采集源清单 |

纯静态页面，无框架依赖，可直接托管在 GitHub Pages，也可本地双击打开。

## 目录结构

```
policy-intel/
├── index.html / items.html / item.html / briefs.html / brief.html / agent.html
├── assets/
│   ├── img/                     主题 Logo 与 favicon（SVG）
│   ├── css/style.css            样式系统
│   ├── js/app.js                前端逻辑（按页面分派渲染）
│   └── data/                    站点数据（构建产物）
│       ├── brief-<期>.json      各期简报数据（月报 2026-09 / 周报 2026-W36、W37…）
│       ├── index.json           站点索引
│       └── site-data.js         前端唯一数据入口
├── agent/                       情报智能体
│   ├── sources.json             采集源清单
│   ├── collect.py               采集
│   ├── analyze.py               摘要 / 相关性 / 分档 / 影响分析（调用大模型）
│   ├── llm.local.json           模型端点配置（本地文件，不入库）
│   ├── insights.json            人工撰写的影响分析（优先级高于模型草稿）
│   ├── weekly_narratives.json   周报的结论 / 影响 / 展望（人工撰写）
│   ├── extract_seed.py          从原始报告抽取种子数据
│   ├── build_weekly.py          按周拆分简报（回溯补齐历史周报）
│   ├── build_data.py            合并数据、生成站点数据
│   └── run_weekly.py            每周流水线入口（每周一 08:30 定时运行，生成前一周周报）
└── seed/                        原始资料（首期报告）
```

## 运行

需要 Python 3.10+，无第三方依赖。

```bash
# 每周完整流水线（需已配置模型端点）
python3 agent/run_weekly.py

# 离线演练：不调模型，仅用关键词规则打分
python3 agent/run_weekly.py --dry-run

# 只重建站点数据（改了 insights.json 或样式后）
python3 agent/build_data.py

# 回溯补齐历史周报（按周拆分月报数据，叙述写在 weekly_narratives.json）
python3 agent/build_weekly.py

# 本地预览
python3 -m http.server 8000
```

### 配置模型端点

`analyze.py` 需要一个 **OpenAI 兼容**的对话补全接口。端点信息**不写进代码**，
按以下优先级读取：

1. 环境变量

   ```bash
   export INTEL_LLM_URL=<chat/completions 地址>
   export INTEL_LLM_MODEL=<模型名>
   export INTEL_LLM_KEY=<可选，无鉴权可留空>
   ```

2. 本地配置文件 `agent/llm.local.json`（已在 `.gitignore` 中，不会进版本库）

   ```json
   { "url": "<chat/completions 地址>", "model": "<模型名>", "api_key": "<可选>" }
   ```

两处都未配置时，`analyze.py` 会退化为关键词规则打分并在日志中提示，
不会中断流水线。模型调用失败时同理：该条自动走规则兜底，并在 `tier_reason` 中标注「模型失败已兜底」。

## 维护要点

1. **采集源需要定期校准。** 政府网站改版频繁，`agent/sources.json` 里失效的源在
   `collect.py` 运行日志中会显示为「0 条」并单独列出，按提示更新栏目地址即可。
2. **自动生成的影响分析是草稿。** `analyze.py` 产出的 `impact` / `action` 需要人工复核。
   复核后的结论请写进 `agent/insights.json`，它会按条目 id 覆盖模型草稿；重跑 `build_data.py` 生效。
3. **业务口径可调。** 六条赛道的定义与关键词表分别在 `agent/analyze.py`（TRACKS / TRACK_KEYWORDS）
   和 `agent/extract_seed.py` 中，业务方向调整时同步修改这两处。
4. **分档规则透明可复核。** 规则位于 `analyze.py` 的 SYSTEM_PROMPT 与 `rule_fallback()`，
   条目的分档理由记录在 `tier_reason` 字段中。

## 数据与可信度

所有条目均来自公开渠道（政府官网、协会官网、权威媒体），每条保留原始来源链接。
可信度标注沿用检索状态：已查证 / 一方报道 / 待核实。
对未核实内容不做推测性补充。

情报内容用于内部研判与选题参考，不构成对外承诺；涉及具体项目的决策请以官方正式文件为准。

## 部署

站点托管在 GitHub Pages（`main` 分支根目录）。更新数据后：

```bash
git add -A
git commit -m "chore: 更新 2026-W39 情报数据"
git push
```

Pages 会自动重新构建，通常 1 分钟内生效。
