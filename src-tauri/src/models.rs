use serde::{Deserialize, Serialize};

/// 任务实体，与 `tasks` 表一一对应。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    pub form: String,
    pub importance: i64,
    pub urgency: i64,
    pub deadline: Option<String>,
    pub estimated_min: Option<i64>,
    pub status: String,
    pub parent_id: Option<String>,
    pub xp_value: i64,
    pub created_at: String,
    pub completed_at: Option<String>,
    /// none | daily | weekly（M4 循环任务）
    pub recurrence: String,
    /// weekly 用：逗号分隔星期 1-7（如 "1,3,5"）；其余情况为 NULL
    pub recur_days: Option<String>,
    /// 最近完成日 YYYY-MM-DD（任务日，4:00 分界）
    pub last_done_date: Option<String>,
    /// 连续应做日完成数（循环任务连击）
    pub streak: i64,
    /// 语义分类图标 key（'' = 默认卷轴）
    pub icon: String,
    /// AI 周计划/时段推荐采纳后回写的计划日（YYYY-MM-DD）
    pub planned_date: Option<String>,
    /// 计算字段：今天（任务日）是否已完成；非表列，由查询后填充
    #[sqlx(default)]
    pub done_today: bool,
}

/// 新建任务入参。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub title: String,
    pub notes: Option<String>,
    pub form: String,
    pub importance: Option<i64>,
    pub urgency: Option<i64>,
    pub deadline: Option<String>,
    pub estimated_min: Option<i64>,
    pub parent_id: Option<String>,
    pub recurrence: Option<String>,
    pub recur_days: Option<String>,
    pub icon: Option<String>,
}

/// 更新任务补丁，全字段可选，仅更新出现的字段。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskPatch {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub notes: Option<Option<String>>,
    pub importance: Option<i64>,
    pub urgency: Option<i64>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub deadline: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub estimated_min: Option<Option<i64>>,
    pub status: Option<String>,
    pub recurrence: Option<String>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub recur_days: Option<Option<String>>,
    pub icon: Option<String>,
    #[serde(default, deserialize_with = "nullable_patch")]
    pub planned_date: Option<Option<String>>,
}

// Absent field = None; JSON null = Some(None); supplied value = Some(Some(value)).
fn nullable_patch<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where D: serde::Deserializer<'de>, T: Deserialize<'de> {
    Option::<T>::deserialize(deserializer).map(Some)
}

/// 列表过滤条件，全 None 表示查询全部。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilter {
    pub status: Option<String>,
    pub form: Option<String>,
}

/// 步骤树节点，与 `task_steps` 表一一对应（M2 契约 §2.1）。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: String,
    pub task_id: String,
    pub parent_step_id: Option<String>,
    pub title: String,
    pub order_index: i64,
    pub deadline: Option<String>,
    pub estimated_min: Option<i64>,
    pub surface_days: Option<i64>,
    pub status: String,
    pub completed_at: Option<String>,
}

/// 番茄钟会话（M2 契约 §2.2）。task_title 联表 tasks 带出，非常驻列。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSession {
    pub id: String,
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    pub started_at: String,
    pub duration_min: i64,
    pub state: String,
    pub remaining_secs: i64,
    pub updated_at: String,
}

/// 钱包快照（M2 契约 §2.3），wallet-updated 事件 payload。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wallet {
    pub xp_total: i64,
    pub coins: i64,
    pub level: i64,
    pub xp_into_level: i64,
    pub xp_to_next: i64,
    pub streak: i64,
}

/// 商店奖励，与 `rewards` 表一一对应（M2 契约 §2.4）。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Reward {
    pub id: String,
    pub title: String,
    pub price: i64,
    pub stock: Option<i64>,
    pub created_at: String,
}

/// 兑换记录，与 `reward_redemptions` 表一一对应（M2 契约 §2.4）。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Redemption {
    pub id: String,
    pub reward_id: String,
    pub reward_title: String,
    pub price_paid: i64,
    pub created_at: String,
}

/// 规则引擎排序结果（M2 契约 §2.5）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedTask {
    pub task: Task,
    pub score: f64,
    pub reasons: Vec<String>,
}

// ---------- M3：课表 / 日历 / LLM ----------

/// 课程时段槽，与 `course_slots` 表一一对应（M3 契约）。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CourseSlot {
    pub id: String,
    pub course_id: String,
    pub weekday: i64,           // 1~7（周一~周日）
    pub start_time: String,     // "HH:MM"
    pub end_time: String,
    /// 调课覆盖：仅该周生效；NULL = 常规模板槽
    pub override_week: Option<i64>,
}

/// 课程实体。slots 不是 courses 表列，由单独查询组装，故不 derive FromRow。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: String,
    pub name: String,
    pub teacher: Option<String>,
    pub location: Option<String>,
    pub color: Option<String>,
    /// 周次范围，如 "1-16"、"1-8,10-16"
    pub weeks_mask: String,
    /// all | odd | even
    pub week_parity: String,
    pub slots: Vec<CourseSlot>,
}

/// 新增/编辑/导入共用草稿槽（无 id）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseDraftSlot {
    pub weekday: i64,
    pub start_time: String,
    pub end_time: String,
    /// OCR preview only: retain the source grid position until the user confirms its time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_period: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_period: Option<usize>,
}

/// 新增/编辑/导入共用草稿；除 name/slots 外均可缺省（后端填默认值）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseDraft {
    pub name: String,
    pub teacher: Option<String>,
    pub location: Option<String>,
    pub color: Option<String>,
    pub weeks_mask: Option<String>,
    pub week_parity: Option<String>,
    pub slots: Vec<CourseDraftSlot>,
}

/// save_course 入参：id 为 None = 新建，否则编辑（常规槽全量替换）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCourseInput {
    pub id: Option<String>,
    pub name: String,
    pub teacher: Option<String>,
    pub location: Option<String>,
    pub color: Option<String>,
    pub weeks_mask: Option<String>,
    pub week_parity: Option<String>,
    pub slots: Vec<CourseDraftSlot>,
}

/// 调课覆盖入参：为某课程在某周新增覆盖槽。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverrideSlotInput {
    pub course_id: String,
    pub week: i64,
    pub weekday: i64,
    pub start_time: String,
    pub end_time: String,
}

/// 日历单元格内的课程条目（M3 契约）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarCourseItem {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub location: Option<String>,
}

/// 日历单元格内的任务条目（M3 契约）。
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CalendarTaskItem {
    pub id: String,
    pub title: String,
    pub form: String,
    pub status: String,
}

/// 日历日聚合（M3 契约）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayCell {
    /// YYYY-MM-DD
    pub date: String,
    /// 1~7（周一~周日）
    pub weekday: i64,
    /// 节假日/调休名称；非节假日为 null
    pub holiday_name: Option<String>,
    /// 1=放假 0=调休上班；非节假日为 null
    pub is_off: Option<bool>,
    pub tasks_due: Vec<CalendarTaskItem>,
    pub courses: Vec<CalendarCourseItem>,
}

/// LLM 配置视图（M3 契约）：永远不回传 key 本体。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
}

/// 远端可用模型条目（M4）：GET {base_url}/models 的 data[] 摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelInfo {
    pub id: String,
    /// 是否支持图片输入（课表截图识别需要）
    pub supports_image_in: bool,
}

// ---------- M4：AI 参谋 ----------

/// 自然语言录入解析出的任务草稿（ai_parse_task）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDraft {
    pub title: String,
    pub details: Option<String>,
    pub importance: i64,
    pub urgency: i64,
    pub deadline: Option<String>,
    pub estimated_min: Option<i64>,
    /// 13 分类 key 之一或 ''（默认卷轴）
    pub icon: String,
    /// none | daily | weekly
    pub recurrence: String,
    /// weekly 用，逗号分隔 1-7
    pub recur_days: Option<String>,
}

/// 主线 AI 分解出的支线步骤草稿（ai_decompose_task）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepDraft {
    pub title: String,
    pub estimated_min: Option<i64>,
    pub order_hint: i64,
}

/// 周计划单个排程项（ai_plan_week）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekPlanItem {
    pub task_id: String,
    pub start_time: String,
    pub end_time: String,
    pub note: Option<String>,
}

/// 周计划的一天。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekPlanDay {
    pub date: String,
    pub items: Vec<WeekPlanItem>,
    /// 节假日/休息日建议（非节假日为 None）
    pub rest_advice: Option<String>,
}

/// 周计划整体。suggestion_id 用于采纳/忽略回写 ai_suggestions 状态。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekPlan {
    pub suggestion_id: String,
    pub days: Vec<WeekPlanDay>,
}

/// 单任务时段推荐（ai_suggest_slot）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotSuggestion {
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub reason: String,
}
