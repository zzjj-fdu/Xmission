use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::gamification::{build_wallet, level_progress};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LotteryPrize {
    pub title: String,
    pub kind: String,
    pub amount: i64,
    pub weight: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LotteryConfig {
    pub min_level: i64,
    pub cost_coins: i64,
    pub prizes: Vec<LotteryPrize>,
}

impl Default for LotteryConfig {
    fn default() -> Self {
        Self {
            min_level: 3,
            cost_coins: 30,
            prizes: vec![
                LotteryPrize { title: "金币小袋".into(), kind: "coins".into(), amount: 10, weight: 28 },
                LotteryPrize { title: "经验萤火".into(), kind: "xp".into(), amount: 12, weight: 25 },
                LotteryPrize { title: "金币宝箱".into(), kind: "coins".into(), amount: 40, weight: 15 },
                LotteryPrize { title: "经验星芒".into(), kind: "xp".into(), amount: 40, weight: 15 },
                LotteryPrize { title: "休息券".into(), kind: "custom".into(), amount: 0, weight: 12 },
                LotteryPrize { title: "心愿奖励".into(), kind: "custom".into(), amount: 0, weight: 5 },
            ],
        }
    }
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LotteryDraw {
    pub id: String,
    pub prize_title: String,
    pub prize_kind: String,
    pub prize_amount: i64,
    pub prize_index: i64,
    pub cost_paid: i64,
    pub created_at: String,
}

fn validate(config: &LotteryConfig) -> Result<(), String> {
    if !(1..=100).contains(&config.min_level) { return Err("解锁等级需在 1 至 100 之间".into()); }
    if !(1..=100_000).contains(&config.cost_coins) { return Err("每次消耗需在 1 至 100000 金币之间".into()); }
    if !(2..=12).contains(&config.prizes.len()) { return Err("请设置 2 至 12 个奖品".into()); }
    for prize in &config.prizes {
        if prize.title.trim().is_empty() || prize.title.chars().count() > 30 { return Err("奖品名称需为 1 至 30 字".into()); }
        if !matches!(prize.kind.as_str(), "coins" | "xp" | "custom") { return Err("奖品类型无效".into()); }
        if prize.weight == 0 || prize.weight > 1000 { return Err("奖品权重需在 1 至 1000 之间".into()); }
        if prize.kind != "custom" && !(1..=100_000).contains(&prize.amount) { return Err("金币和经验奖品数量需在 1 至 100000 之间".into()); }
    }
    Ok(())
}

async fn load(pool: &SqlitePool) -> Result<LotteryConfig, String> {
    let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'lottery_config'")
        .fetch_optional(pool).await.map_err(|e| e.to_string())?;
    match raw {
        Some(raw) => serde_json::from_str(&raw).map_err(|e| format!("奖品设置读取失败：{e}")),
        None => Ok(LotteryConfig::default()),
    }
}

#[tauri::command]
pub async fn get_lottery_config(state: State<'_, SqlitePool>) -> Result<LotteryConfig, String> {
    load(state.inner()).await
}

#[tauri::command]
pub async fn save_lottery_config(state: State<'_, SqlitePool>, config: LotteryConfig) -> Result<(), String> {
    validate(&config)?;
    let raw = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO settings (key, value) VALUES ('lottery_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(raw).execute(state.inner()).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_lottery_draws(state: State<'_, SqlitePool>) -> Result<Vec<LotteryDraw>, String> {
    sqlx::query_as::<_, LotteryDraw>("SELECT * FROM lottery_draws ORDER BY created_at DESC LIMIT 30")
        .fetch_all(state.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn draw_lottery(state: State<'_, SqlitePool>, app: AppHandle) -> Result<LotteryDraw, String> {
    let pool = state.inner();
    let config = load(pool).await?;
    validate(&config)?;
    let mut tx = crate::gamification::begin_write(pool).await?;
    let xp: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(delta), 0) FROM xp_ledger")
        .fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
    let coins: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(delta), 0) FROM coin_ledger")
        .fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
    if level_progress(xp).0 < config.min_level { return Err(format!("达到 {} 级后可抽奖", config.min_level)); }
    if coins < config.cost_coins { return Err(format!("金币不足：本次需要 {}，当前有 {}", config.cost_coins, coins)); }
    let total: u64 = config.prizes.iter().map(|p| p.weight as u64).sum();
    let mut roll = (Uuid::new_v4().as_u128() % total as u128) as u64;
    let mut index = 0;
    for (i, prize) in config.prizes.iter().enumerate() {
        if roll < prize.weight as u64 { index = i; break; }
        roll -= prize.weight as u64;
    }
    let prize = &config.prizes[index];
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO coin_ledger (id, delta, reason, ref_id, created_at) VALUES (?, ?, 'lottery-cost', ?, ?)")
        .bind(Uuid::new_v4().to_string()).bind(-config.cost_coins).bind(&id).bind(&now)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    if prize.kind == "coins" || prize.kind == "xp" {
        let table = if prize.kind == "coins" { "coin_ledger" } else { "xp_ledger" };
        let query = format!("INSERT INTO {table} (id, delta, reason, ref_id, created_at) VALUES (?, ?, 'lottery-prize', ?, ?)");
        sqlx::query(&query).bind(Uuid::new_v4().to_string()).bind(prize.amount).bind(&id).bind(&now)
            .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    sqlx::query("INSERT INTO lottery_draws (id, prize_title, prize_kind, prize_amount, prize_index, cost_paid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(&id).bind(&prize.title).bind(&prize.kind).bind(prize.amount).bind(index as i64).bind(config.cost_coins).bind(&now)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    let wallet = build_wallet(&mut *tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    let _ = app.emit("wallet-updated", wallet);
    Ok(LotteryDraw { id, prize_title: prize.title.clone(), prize_kind: prize.kind.clone(), prize_amount: prize.amount, prize_index: index as i64, cost_paid: config.cost_coins, created_at: now })
}
