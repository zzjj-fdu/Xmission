# 游戏化任务栏（Xmission）· 开发架构文档（SDD）

| 项 | 内容 |
|---|---|
| 文档版本 | v1.1 |
| 日期 | 2026-08-26 |
| 状态 | 待用户审阅 |
| 工作代号 | **Xmission**（正式名称与图标待定） |
| 目标平台 | Windows 桌面端（一期），预留跨平台 |
| 技术栈 | Tauri 2.x + React 18 + TypeScript + SQLite |

**v1.1 变更**：代号定名 Xmission；课表 AI 截图识别提前到一期；UI 主题定为可换肤体系（像素 JRPG / 羊皮纸手账 / 动森 / 星露谷，弃用暗金酒馆）；里程碑不设固定周期（agent 协助开发，尽善尽美尽快）；新增外部 Agent 集成接口（OpenClaw/QClaw，后续版本）；数据导出定为 Markdown 日报；主线并行软上限确认。

---

## 1. 背景与产品定位

### 1.1 一句话定位

悬浮在桌面上的 RPG 任务指引栏——把"待办清单"变成"游戏任务日志"：长短期任务统一管理、游戏化激励闭环、AI 当任务参谋、课表让它懂你的时间。

### 1.2 目标用户

- 首要：大学生（有课表、有学期/学年级别的长期目标、有小时级的碎片任务）
- 次要：备考人群、自由职业者、任何需要同时管理长短周期任务的个人用户

### 1.3 解决的核心痛点

1. 现有待办工具对"长期目标"和"眼前杂事"是割裂的——学期目标躺在笔记软件里，今日待办躺在另一个 App 里，两者之间没有自动的时序关联。
2. 任务管理缺乏即时正反馈，长期坚持靠意志力。
3. "现在该做什么"的决策成本每天重复发生；现有工具只存任务，不给建议。
4. 学生的时间高度受课表约束，但没有任务工具把课表当作排程输入。

### 1.4 产品差异化（竞品交叉空白）

市面没有"桌面悬浮 RPG 任务栏 × 长短期任务统一 × Agent 调度 × 课表感知"四者结合的产品。详见第 3 节竞品调研。

---

## 2. 需求深化

### 2.1 核心概念模型：任务三形态

所有任务共用统一数据模型（`tasks` 表），按时间跨度与结构呈现三种形态。**形态是视图概念，不是数据孤岛**——这保证时序转换可行。

| 形态 | 代号 | 跨度 | 结构 | 展示与功能 |
|---|---|---|---|---|
| 遭遇任务 | `encounter` | 几小时 ~ 1 天 | 单条，无步骤 | 悬浮栏直接打勾；一键开启番茄钟；今日清单 |
| 支线任务 | `side_quest` | 几天 ~ 1 个月 | 可含里程碑节点 | 进度条；可挂载到主线下成为分支 |
| 主线任务 | `main_quest` | 学期 / 学年 | 树状步骤（`task_steps`） | 任务树可视化；阶段进度；步骤可生长分支 |

**设计约束**：

- 用户创建任务时只需选"大概什么时候完成"，形态由跨度自动推断（可手动改）。降低录入成本。
- **主线并行软上限**：进行中的主线默认最多 3 条（`settings` 可配 1~5）。超出时不硬阻止，而是弹出"精力摊薄"警告并要求确认；排序引擎与 AI 排程会把"并行主线总负载"纳入考量（负载超阈值时主动建议搁置某条主线）。既防摊大饼，又不牺牲灵活性。

### 2.2 时序交替与转换引擎（核心原创功能）

长短期任务不是静态分类，而是随时间流动的状态。引擎职责：**让长期任务的"当前该做的部分"在对的时间浮现为短期任务**。

#### 2.2.1 转换规则

| 规则 | 触发条件 | 行为 |
|---|---|---|
| R1 步骤浮现 | 主线/支线的某步骤：`today ≥ step.deadline - step.surface_days`（surface_days 默认 = 步骤预估天数，用户可调） | 该步骤生成一个"影子遭遇任务"进入今日栏，完成它即勾选原步骤 |
| R2 阶段推进 | 主线的当前阶段全部步骤完成 | 下一阶段第一个步骤置顶提示，播放阶段推进动效 |
| R3 短期升级 | 用户对遭遇任务点"关联到主线" | 该任务转为某主线/支线的步骤节点 |
| R4 逾期降格 | 遭遇任务逾期 | 保留在今日栏顶部标红（不自动消失），计入游戏化轻惩罚 |
| R5 节假日感知 | 法定节假日 / 课表无课日 | 引擎下调当日推荐任务量（用户可覆盖为"假期加班模式"） |
| R6 学期边界 | 主线到期日前 N 天且进度 < 阈值 | 触发"主线告急"提示，建议 AI 重新分解剩余步骤 |

#### 2.2.2 影子任务机制

影子任务（shadow task）不是数据复制，而是 `task_steps` 在今日视图上的**投影**（视图层 join 生成）。勾选影子 = 更新原步骤状态，保证单一数据源。

### 2.3 排序与推荐

#### 2.3.1 本地规则引擎（兜底，离线完整可用）

每个可见任务计算优先级分数：

```
score = 0.35 × importance          // 用户标注 1~5，归一化到 0~1
      + 0.30 × urgency             // 紧迫度：用户标注 与 时间衰减 取大者
      + 0.20 × schedule_fit        // 与今日课表空档的匹配度（见下）
      + 0.10 × streak_bonus        // 属于进行中 streak 主线的任务加分
      + 0.05 × freshness           // 创建时间越近略微加分，防老任务沉底
```

- `urgency_time = 1 - (deadline - now) / horizon`，horizon 按形态取 1 天 / 7 天 / 30 天
- `schedule_fit`：任务预估耗时 ≤ 当前最大空档时长 → 1.0；否则按 空档/耗时 线性折算；无课表数据时该项按 0.5 中性处理
- 四象限视图：importance × urgency 直接映射艾森豪威尔矩阵
- 并行主线总负载超过阈值时，对非聚焦主线的任务施加降权（配合 2.1 软上限）

#### 2.3.2 LLM 增强（云端，用户触发）

| 能力 | 输入 | 输出（JSON 结构化） |
|---|---|---|
| 自然语言录入 | "下周三前交高数作业，很重要" | 任务字段草稿（标题/截止/重要度/形态） |
| 主线智能分解 | 主线标题 + 目标描述 + 时间跨度 | 步骤树草稿（用户确认后落库） |
| 时段推荐 | 今日任务列表 + 课表空档 + 节假日 + 历史完成记录 | "现在最好做 X"的建议 + 理由 |
| 周计划建议 | 本周任务/步骤/课程/节假日 | 按天分配的建议计划 |
| 课表截图识别 | 课表截图 | 课程结构化数据（人工校对后落库） |

**原则**：所有 AI 输出都是"建议草稿"，必须经本地校验 + 用户确认才落库。AI 永远不能直接改数据。

### 2.4 游戏化系统（中度）

- **XP/等级**：完成任务/步骤得 XP（按重要度 × 预估耗时加权）；等级升级动效
- **金币**：与 XP 并行获得；用于奖励商店消费
- **Streak**：每日至少完成 1 个任务则连击 +1；悬浮栏常驻显示
- **奖励商店**：用户自定义奖励（标题 + 金币价格 + 可选库存/限购），例："看一集剧 50G""奶茶 120G"；兑换记录入流水
- **轻惩罚**：主线步骤逾期 → 当日 streak 不加（不清零，避免挫败感）；可花金币"解冻"
- **反馈动效**：打勾流光 + 音效（可关）；里程碑节点在任务树上点亮

### 2.5 课表系统

- **导入方式**：
  1. 手动录入（节次模板：每天几节、每节起止时间可配；支持单双周、周次范围）——一期
  2. Excel/CSV 模板导入（提供模板下载）——一期
  3. **AI 截图识别 + 校对界面——一期**（复用 LLM 多模态能力；识别结果必须进校对界面，用户确认后才落库）
  4. ICS 日历文件导入——二期
  5. 教务系统适配器接口预留——三期（按学校逐个适配：正方/青果/URP 等）
- **编辑**：课程增删改、调课临时覆盖（override 单周不改模板）
- **展示**：独立课表页（周视图）；日历页与任务叠加；"今日"页时间轴融合展示
- **作为排程输入**：`schedule_fit` 评分 + AI 推荐的约束条件

### 2.6 日历与节假日

- 月/周视图，任务（按截止日）与课程叠加
- 中国法定节假日：本地 JSON 数据文件（每年国务院发布后随版本更新），不依赖在线 API
- 节假日参与 R5 规则与 AI 考量

### 2.7 功能需求清单（FR）

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-01 | 任务 CRUD，三形态，重要度/紧迫度/截止/预估耗时标注 | P0 |
| FR-02 | 主线/支线步骤树（增删改、排序、分支）；主线并行软上限 | P0 |
| FR-03 | 悬浮任务栏：置顶、打勾、贴边隐藏、透明度、拖拽移动 | P0 |
| FR-04 | 规则引擎排序 + 手动拖拽排序（手动优先） | P0 |
| FR-05 | 番茄钟（25/5 默认可配，悬浮栏内直接开启，关联任务） | P0 |
| FR-06 | XP/金币/streak/奖励商店 | P0 |
| FR-07 | 课表手动录入 + Excel 导入 + **AI 截图识别（含校对界面）** + 编辑 | P0 |
| FR-08 | 日历页 + 节假日 + 任务课程叠加 | P0 |
| FR-09 | LLM 设置（key、厂商、模型）+ 自然语言录入 + 主线分解 | P0 |
| FR-10 | 时序转换引擎 R1~R4 | P1 |
| FR-11 | AI 时段推荐 + 周计划 | P1 |
| FR-12 | ICS 课表导入 | P1 |
| FR-13 | R5/R6、逾期轻惩罚、streak 解冻 | P1 |
| FR-14 | 主题换肤体系：V3 羊皮纸 / V4 动森 / V5 星露谷 补全（V2 为一期默认） | P1 |
| FR-15 | 数据导出：Markdown 日报（+ JSON 全量备份） | P1 |
| FR-16 | 教务系统适配器、统计复盘 | P2 |
| FR-17 | 外部 Agent 集成接口（OpenClaw/QClaw，见 5.5） | P2 |

### 2.8 非功能需求（NFR）

- **隐私**：全部数据本地 SQLite；AI 调用仅发送必要上下文；设置页展示数据使用说明
- **性能**：悬浮栏内存 < 150MB；启动 < 2s；打勾反馈 < 100ms
- **离线**：除 LLM 功能外全部离线可用
- **可移植**：Tauri 跨平台能力保留，一期只验证 Windows 10/11
- **可维护**：模块边界清晰（第 5 节），核心逻辑在 Rust 侧可单测

---

## 3. 竞品调研摘要

| 产品 | 可借鉴 | 短板（= 我们的机会） |
|---|---|---|
| Habitica | RPG 闭环最成熟：XP/金币/血量/装备/组队；每日结算 | 无桌面悬浮形态；任务无层级分支；无时间调度 |
| LifeRPG / Do It Now | 技能树、属性成长映射任务类别 | 仅移动端 |
| TickTick | 番茄钟 + 四象限 + 任务的组合范式 | 游戏化浅，无 RPG 叙事 |
| Todoist Karma | 轻量积分激励 | 仅积分 |
| 敬业签 | 桌面悬浮便签成熟交互：置顶/嵌入/贴边隐藏/透明度/打勾划线 | 无游戏化、无层级、无智能 |
| Super Productivity（开源） | 时间追踪 + 任务的桌面开源架构参考 | 无游戏化 |

**补充借鉴点**：Habitica 每日结算 → 演化为主线逾期轻惩罚；敬业签贴边隐藏/透明度 → 悬浮窗必备细节；TickTick 四象限 → 排序可视化视图之一。

---

## 4. 技术栈选型与论证

| 层 | 选型 | 论证 |
|---|---|---|
| 桌面框架 | **Tauri 2.x** | 安装包 ~10MB（Electron 150MB+）；内存占用低，适合常驻悬浮工具；窗口/托盘/全局快捷键/开机自启 API 齐全；跨平台保留 |
| 前端 | **React 18 + TypeScript + Vite** | 生态最大，RPG 动效组件实现成本低 |
| UI 组件 | **Tailwind CSS + Framer Motion** | 自绘 RPG 风格组件（不用现成组件库，风格化更彻底）；Framer Motion 负责打勾流光/升级动效 |
| 前端状态 | **Zustand** | 轻量，与 Tauri event 集成简单 |
| 本地数据库 | **SQLite（sqlx，Rust 侧）** | 零依赖嵌入式；单文件易备份；支持加密扩展（SQLCipher 预留） |
| LLM 客户端 | Rust `reqwest` | AI 调用走 Rust 侧，key 不暴露给前端 WebView |
| 关键 Rust crate | `sqlx`、`tokio`、`reqwest`、`serde`、`chrono`、`tauri-plugin-global-shortcut`、`tauri-plugin-autostart`、`csv`、`image`（截图预处理）、`calcard`（ICS 解析，二期） | — |

**前端/Rust 职责划分原则**：UI 与交互全在前端；数据持久化、排序引擎、时序转换引擎、LLM 调用、文件解析全在 Rust 侧。前端通过 Tauri Commands（请求-响应）与 Events（状态推送，如 XP 变动）通信。

## 5. 系统架构

### 5.1 进程与窗口模型

```
┌──────────────────────────── Xmission (Tauri App) ───────────────────────────┐
│                                                                             │
│  ┌─────────────────────┐   ┌─────────────────────────────────────────────┐  │
│  │ Widget Window        │   │ Main Window                                 │  │
│  │ (悬浮任务栏)          │   │ (主管理界面)                                 │  │
│  │ · 透明/半透明、置顶    │   │ · 今日 / 任务树 / 日历课表 / 商店 / 统计 / 设置 │  │
│  │ · 贴边自动隐藏        │   │ · 常规窗口，托盘/快捷键/点击悬浮栏唤出          │  │
│  │ · 不可聚焦模式可选     │   │                                             │  │
│  └─────────┬───────────┘   └──────────────────┬──────────────────────────┘  │
│            │        React + Zustand (共享状态) │                             │
│            ▼              Tauri Commands/Events ▼                             │
│  ┌───────────────────────── Rust Core ────────────────────────────────────┐ │
│  │  task_engine │ scheduler │ gamification │ course │ calendar │ llm       │ │
│  │  settings    │ agent_api（预留，后续版本）                                │ │
│  │  ─────────────────────────── SQLite (sqlx) ──────────────────────────  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│            │                                                                │
│            ▼ (仅用户触发 AI 功能时)                                            │
│     LLM API（用户自备 key：Kimi / DeepSeek / OpenAI 兼容）                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 模块划分（Rust 侧 crate 内 module）

| 模块 | 职责 | 关键接口（Tauri Commands） |
|---|---|---|
| `task_engine` | 任务/步骤 CRUD、状态机、影子任务投影、时序转换规则 R1~R6、主线软上限校验 | `create_task` `update_task` `complete_task` `add_step` `get_today_view` `get_quest_tree` |
| `scheduler` | 规则引擎评分、排序、空档计算、节假日权重、并行负载降权 | `get_ranked_today` `get_free_slots` |
| `gamification` | XP/金币/streak 结算、商店、兑换、轻惩罚 | `get_wallet` `redeem_reward` `get_streak` |
| `course` | 课程 CRUD、Excel/CSV/ICS 解析、调课覆盖、截图识别结果落库 | `import_courses_file` `save_courses` `get_week_schedule` |
| `calendar` | 节假日数据、日历聚合视图 | `get_month_view` |
| `llm` | Provider 抽象、prompt 模板、结构化输出解析与校验、多模态（识图）、用量记录 | `ai_parse_task` `ai_decompose_quest` `ai_suggest_now` `ai_plan_week` `ai_parse_schedule_image` |
| `settings` | 配置读写（含 LLM key 的安全存储，用 OS keychain：`keyring` crate） | `get_settings` `save_settings` |
| `export` | Markdown 日报生成、JSON 全量备份 | `export_daily_md` `export_backup_json` |
| `agent_api`（预留） | 外部 Agent 集成，见 5.5 | 后续版本 |

**模块边界规则**：模块间不直接读对方的表，通过本模块 command 层组合；`gamification` 只订阅 `task_engine` 发出的事件（`TaskCompleted` 等）做结算，单向依赖。

### 5.3 数据流示例：打勾完成任务

```
用户在悬浮栏打勾
 → 前端 invoke complete_task(step_id)
 → task_engine 更新步骤状态，计算是否触发 R2 阶段推进
 → 发出事件 TaskCompleted { xp, coins }
 → gamification 结算 XP/金币/streak，写流水
 → Rust emit "wallet-updated" / "today-view-updated"
 → 前端 Zustand 收到事件刷新 UI，播放打勾动效 + 音效
```

### 5.4 前端页面结构

```
src/
├─ widget/            # 悬浮任务栏窗口（独立入口）
│  ├─ QuestLog.tsx        # 任务列表（主线折叠子步骤 + 今日遭遇任务）
│  ├─ LevelBadge.tsx      # 等级 + XP 条
│  ├─ PomodoroChip.tsx    # 番茄钟
│  └─ WalletBar.tsx       # 金币 / streak
├─ main/              # 主窗口
│  ├─ pages/TodayPage.tsx     # 时间轴：课程 + 任务融合
│  ├─ pages/QuestTreePage.tsx # 主线任务树（可编辑、生长分支）
│  ├─ pages/CalendarPage.tsx  # 月/周视图 + 课表
│  ├─ pages/ShopPage.tsx      # 奖励商店
│  ├─ pages/StatsPage.tsx     # 统计（二期）
│  └─ pages/SettingsPage.tsx  # 设置（LLM key、番茄钟、外观换肤、数据导出）
├─ themes/            # 皮肤 tokens：pixel-jrpg / parchment / animal-crossing / stardew
├─ components/        # 共享 RPG 风格组件（消费主题 tokens）
└─ store/             # Zustand stores + Tauri event 订阅
```

### 5.5 外部 Agent 集成接口（OpenClaw/QClaw，后续版本）

为 OpenClaw/QClaw 等外部 AI Agent 预留本地集成接口，后续版本完善：

- **形态**：`agent_api` 模块在 localhost 起一个本地 HTTP/MCP 服务（默认关，设置页手动开）
- **能力分级**：
  - 只读：查询今日任务、任务树、课表空档、streak/钱包状态
  - 建议写入：外部 Agent 提交的任务建议进入 `ai_suggestions` 待确认队列（与内部 LLM 同一套"确认才落库"原则）
- **安全**：仅监听 127.0.0.1；启用时生成随机 token，外部 Agent 需携带；完整调用日志
- **一期落地范围**：仅在模块划分与数据表（`ai_suggestions.kind` 预留 `external_agent`）上预留接口，不实现服务本身

## 6. 数据模型（SQLite DDL 草案）

```sql
-- 统一任务表
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,            -- uuid
  title         TEXT NOT NULL,
  notes         TEXT,
  form          TEXT NOT NULL,               -- encounter | side_quest | main_quest
  importance    INTEGER NOT NULL DEFAULT 3,  -- 1~5
  urgency       INTEGER NOT NULL DEFAULT 3,  -- 1~5（用户标注）
  deadline      TEXT,                        -- ISO8601，可空
  estimated_min INTEGER,                     -- 预估耗时（分钟）
  status        TEXT NOT NULL DEFAULT 'open',-- open | doing | done | overdue | shelved
  parent_id     TEXT REFERENCES tasks(id),   -- 支线挂主线
  xp_value      INTEGER NOT NULL DEFAULT 10,
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);

-- 步骤树（主线/支线的步骤）
CREATE TABLE task_steps (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_step_id TEXT REFERENCES task_steps(id),  -- 分支
  title         TEXT NOT NULL,
  order_index   INTEGER NOT NULL,
  deadline      TEXT,
  estimated_min INTEGER,
  surface_days  INTEGER,                     -- 提前几天浮现到今日（默认=预估天数）
  status        TEXT NOT NULL DEFAULT 'open',
  completed_at  TEXT
);

-- 课表
CREATE TABLE courses (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  teacher    TEXT, location TEXT, color TEXT,
  weeks_mask TEXT NOT NULL,                  -- 周次范围，如 "1-16"
  week_parity TEXT NOT NULL DEFAULT 'all'    -- all | odd | even
);
CREATE TABLE course_slots (
  id         TEXT PRIMARY KEY,
  course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL,               -- 1~7
  start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  override_week INTEGER                      -- 调课覆盖：仅某周生效（可空）
);

-- 番茄钟
CREATE TABLE pomodoro_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  started_at TEXT NOT NULL, duration_min INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0
);

-- 游戏化
CREATE TABLE xp_ledger (
  id TEXT PRIMARY KEY, delta INTEGER NOT NULL,
  reason TEXT NOT NULL, ref_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE coin_ledger (  -- 与 XP 分离：金币可消费
  id TEXT PRIMARY KEY, delta INTEGER NOT NULL,
  reason TEXT NOT NULL, ref_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE rewards (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  price INTEGER NOT NULL, stock INTEGER,     -- 可空=不限
  created_at TEXT NOT NULL
);
CREATE TABLE reward_redemptions (
  id TEXT PRIMARY KEY, reward_id TEXT NOT NULL REFERENCES rewards(id),
  created_at TEXT NOT NULL
);
CREATE TABLE streaks (                        -- 单行表：当前 streak 状态
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT, frozen INTEGER NOT NULL DEFAULT 0
);

-- 节假日（随版本更新的本地数据）
CREATE TABLE holidays (
  date TEXT PRIMARY KEY, name TEXT NOT NULL, is_off INTEGER NOT NULL
);

-- AI 建议历史（可接受/拒绝，便于回溯；外部 Agent 建议也进此表）
CREATE TABLE ai_suggestions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL,   -- parse_task | decompose | suggest_now | plan_week | schedule_ocr | external_agent
  input_summary TEXT, payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | accepted | rejected
  created_at TEXT NOT NULL
);

-- 配置
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

## 7. AI 设计细节

### 7.1 Provider 抽象

```rust
trait LlmProvider {
    async fn chat_json(&self, prompt: &str, schema: &JsonSchema) -> Result<Value>;
    async fn vision_json(&self, image: &[u8], prompt: &str, schema: &JsonSchema) -> Result<Value>;
}
// 实现：OpenAiCompatProvider（base_url + key + model 可配）
// 预设配置：Kimi (api.moonshot.cn)、DeepSeek、OpenAI、自定义
// 注：课表截图识别依赖多模态模型，设置页需校验所选模型支持 vision
```

- Key 存储：OS keychain（`keyring` crate），不落 SQLite、不进日志
- 所有请求走 JSON mode / structured output；解析失败 → 重试 1 次 → 降级为"规则引擎结果 + 提示 AI 暂不可用"

### 7.2 输出契约（示例：主线分解）

```json
{
  "steps": [
    {"title": "整理第1-3章笔记", "estimated_min": 180, "offset_days": 0, "surface_days": 2,
     "children": [{"title": "第1章", "estimated_min": 60}]}
  ],
  "reasoning": "按章节均分，考前3天留整卷模拟"
}
```

### 7.3 隐私边界

- 仅发送：任务标题/时间字段、课表空档（不含课程名以外的信息）、必要统计；截图识别时发送用户主动选择的课表截图
- 不发送：笔记全文（除非该功能明确需要）、奖励商店内容、任何其他文件
- 设置页提供"AI 数据使用说明"与用量记录（`ai_suggestions` 可视化）

### 7.4 兜底策略

| 场景 | 兜底 |
|---|---|
| 无 key / 断网 | 规则引擎完整可用；AI 按钮置灰并提示 |
| API 报错/超时 | 重试 1 次 → 提示 + 规则引擎结果 |
| 输出不合法 | JSON 校验失败 → 重试 1 次 → 放弃并记录 |
| 课表截图识别 | 必须进校对界面，用户确认才落库；识别置信度低的字段高亮提示 |
| 所选模型不支持 vision | 截图识别入口置灰并提示更换模型 |

---

## 8. UI 设计

### 8.1 设计方向：可换肤体系（概念图见 `docs/ui-concepts/`）

**换肤是一等公民**：所有皮肤共享同一套组件结构与布局，差异收敛为 design tokens（配色 / 字体 / 边框质感 / 图标集 / 动效曲线），设置页一键切换、即时生效。

| 版本 | 风格 | 配色 | 气质 | 状态 |
|---|---|---|---|---|
| V2 像素 JRPG | 16-bit 复古游戏机菜单 | 深海军蓝面板 + 金色像素描边 + 绿 XP 条 | 怀旧、玩味最浓 | **一期默认皮肤** |
| V3 羊皮纸手账 | 中世纪手抄本/冒险者日志 | 羊皮纸 `#D7C6AD` / 墨蓝 `#22264B` / 琥珀 `#F7A026` | 明亮、手作感 | 一期备选，P1 补全 |
| V4 动森风 | 圆润生活模拟（奶油色 + 叶绿 + 贴纸图标） | 奶油白面板 + 叶绿/暖黄点缀 | 治愈、轻松 | P1 补全 |
| V5 星露谷风 | 农场像素（木纹面板 + 羊皮纸清单） | 木棕/琥珀 + 鼠尾草绿 | 手作、温暖 | P1 补全 |

（V1 暗金酒馆方向已弃用。）

### 8.2 设计系统要点

- **主题 tokens 结构**：`colors.{bg,panel,text,textMuted,accent,accentAlt}`、`font.{display,body,mono}`、`texture.{border,panel}`、`iconSet`、`motion.{curve,duration}`；每套皮肤一份 token 文件，组件只消费 tokens 不硬编码
- **字体**：中文禁用斜体；像素风皮肤用像素字体（中文落"缝合像素字体"/Zpix 类），其余皮肤正文用思源黑体、标题用各皮肤特色展示字体
- **组件规范**（结构跨皮肤不变）：
  - 任务行：左侧方形 checkbox，打勾时流光扫过 + 短音效；重要度用 1~3 枚徽记（不用彩色圆点）
  - 主线条目：徽记 + 标题 + 进度条 + 可折叠子步骤（缩进 + 左侧竖线连接，树感）
  - LevelBadge：等级徽标 + XP 条（填充百分比 + 亮度微动效）
  - 分隔用细线与留白，不用卡片套卡片
- **悬浮栏交互**：默认宽 320px 右侧停靠；拖拽移动；贴边 80% 自动隐藏（留 12px 把手）；透明度 40%~100% 可调；鼠标穿透模式可选；全局快捷键（默认 `Ctrl+Shift+Q`）呼出主窗口
- **动效预算**：只在"完成、升级、阶段推进"三个时刻放重动效，其余保持静态——避免悬浮工具喧宾夺主

### 8.3 主窗口页面线框描述

- **今日页**：顶部日期 + 节假日标签；左侧时间轴（课程块着色嵌入），右侧"建议现在做"卡（规则引擎/AI）+ 今日任务列表；番茄钟状态栏
- **任务树页**：主线为大节点横向时间轴，步骤为子节点树；点击节点编辑；里程碑节点完成后点亮
- **日历页**：月视图，日期格内显示课程色点 + 任务截止标记；切换周视图即课表
- **商店页**：奖励卡片网格 + 金币余额 + 兑换记录
- **设置页**：LLM（厂商/base_url/key/模型/测试按钮/vision 支持校验）、番茄钟时长、外观（**换肤**/透明度/贴边）、数据（Markdown 日报导出/JSON 备份）

## 9. 错误处理与边界情况

| 场景 | 处理 |
|---|---|
| SQLite 损坏/迁移失败 | 启动时备份 `xmission.db.bak`；迁移用 sqlx migrate，失败回滚并提示 |
| 番茄钟中途关 app | 会话持久化，重启后询问"继续/放弃" |
| 节假日数据过期（跨年份） | 超出数据范围时 R5 静默失效 + 设置页提示更新版本 |
| 课表与任务时间冲突 | 不强制阻止，仅在今日页标灰冲突时段 |
| 主线全部步骤完成 | 主线进入"待结算"状态，用户确认后播放完成动效并归档 |
| 超出主线软上限 | 警告确认后允许，但排序降权 + AI 建议搁置 |
| 时区/跨天 | 以本地时区 4:00 为"任务日"分界（可配），避免熬夜打卡被切断 streak |

## 10. 测试策略

- **Rust 侧单元测试**：排序评分公式、时序转换规则 R1~R6（时间注入 mock）、游戏化结算、课表解析（含截图识别结果的校验逻辑）——这些是纯逻辑，必须全覆盖
- **集成测试**：Tauri command 层用内存 SQLite 跑端到端数据流
- **前端**：组件测试（Vitest）覆盖 QuestLog/状态订阅/主题切换；动效不测
- **LLM 层**：契约测试用录制的 mock 响应；真实 API 手动验收
- **验收标准**：MVP 完成时 FR-01~FR-09 全部人工验收通过

## 11. 里程碑

> 开发由 agent 协助推进，**不设固定周期**，按里程碑顺序尽善尽美尽快完成；每个里程碑验收后进入下一个。

| 里程碑 | 内容 |
|---|---|
| M1 骨架 | Tauri 双窗口 + SQLite + 任务 CRUD + 悬浮栏打勾 + V2 像素 JRPG 默认皮肤 |
| M2 核心循环 | 步骤树 + 规则引擎排序 + 番茄钟 + XP/金币/商店 + 主线软上限 |
| M3 课表日历 | 手动录入 + Excel 导入 + **AI 截图识别（含校对界面）** + 日历页 + 节假日 |
| M4 AI 接入 | LLM 设置 + 自然语言录入 + 主线分解 |
| M5 打磨 | 动效、贴边隐藏、错误处理、Markdown 日报导出、MVP 验收 |
| 二期 | 时序转换全自动推荐、AI 时段推荐/周计划、ICS 导入、V3/V4/V5 皮肤补全 |
| 三期 | 教务系统适配器、统计复盘、OpenClaw/QClaw 集成接口 |

## 12. 开放问题

| 问题 | 状态 |
|---|---|
| 产品正式名称与图标 | 代号已定 **Xmission**；正式名与图标待定 |
| 番茄钟"严格模式"（屏蔽指定应用/网站） | 一期不做，待二期评估 |
| 数据导出格式 | ✅ 已定：**Markdown 日报**（面向无计算机基础用户可读）+ JSON 全量备份 |
| 音效素材（自制 8-bit vs 免版税库） | 待决定，接口预留静音开关 |
| 主线并行上限 | ✅ 已定：软上限默认 3 条（可配 1~5），警告不硬阻，排序/AI 配合降权 |
| OpenClaw/QClaw 集成细节 | 方向已定（5.5），具体协议后续版本细化 |

---

*本文档为 SDD 单一事实来源；后续实现计划（implementation plan）由 writing-plans 流程基于本文档生成。*
