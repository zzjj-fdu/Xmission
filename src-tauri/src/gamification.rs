use chrono::{DateTime, Duration, Local, NaiveDate, Utc};
use sqlx::{Executor, Sqlite, SqliteConnection, SqlitePool};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::models::{Redemption, Reward, Wallet};

// ---------- 纯函数（XP/金币/等级/streak 公式，契约 §2.3，勿自创） ----------

/// 完成任务 XP：5 + 3×importance + min(estimated_min÷10, 20)（无估时按 0）。
pub fn task_xp(importance: i64, estimated_min: Option<i64>) -> i64 {
    let est_bonus = estimated_min.map(|m| (m / 10).min(20)).unwrap_or(0);
    5 + 3 * importance + est_bonus
}

/// 金币 = max(1, xp÷2)。
pub fn coins_from_xp(xp: i64) -> i64 {
    (xp / 2).max(1)
}

/// 完成步骤 XP：3 + 父任务 importance。
pub fn step_xp(parent_importance: i64) -> i64 {
    3 + parent_importance
}

/// 等级曲线：升到 n+1 级需 100×n XP。返回 (level, xp_into_level, xp_to_next)。
pub fn level_progress(xp_total: i64) -> (i64, i64, i64) {
    let mut level: i64 = 1;
    let mut rest: i64 = xp_total.max(0);
    loop {
        let need = 100 * level;
        if rest >= need {
            rest -= need;
            level += 1;
        } else {
            return (level, rest, need);
        }
    }
}

/// 任务日：本地时间减 4 小时后的日期（spec §9，4:00 分界）。
pub fn task_day(now: DateTime<Local>) -> NaiveDate {
    (now - Duration::hours(4)).date_naive()
}

/// streak 结算：同日不变；last+1 连击 +1；否则归 1。
pub fn next_streak(current: i64, last_active: Option<NaiveDate>, today: NaiveDate) -> i64 {
    match last_active {
        Some(d) if d == today => current,
        Some(d) if d + Duration::days(1) == today => current + 1,
        _ => 1,
    }
}

/// 撤回净值计算（纯函数）：entries 为该 ref_id 在 base_reason 及 base_reason||"-revoke"
/// 下的全部 delta。净值 > 0 时返回应插入的反向 delta（-净值）；净值 ≤ 0（未结算过
/// 或已撤回）返回 None，保证重复 reopen 幂等不重复扣。
pub fn compute_revoke_delta(entries: &[i64]) -> Option<i64> {
    let net: i64 = entries.iter().sum();
    if net > 0 {
        Some(-net)
    } else {
        None
    }
}

/// 兑换校验：库存 > 0（NULL 不限量）、金币 ≥ price。
pub fn check_redeem(coins: i64, price: i64, stock: Option<i64>) -> Result<(), String> {
    if let Some(s) = stock {
        if s <= 0 {
            return Err("库存不足，该奖励已兑完".to_string());
        }
    }
    if coins < price {
        return Err(format!("金币不足：需要 {price}，当前只有 {coins}"));
    }
    Ok(())
}

// ---------- 结算内部 ----------

fn now_utc_iso() -> String {
    Utc::now().to_rfc3339()
}


async fn bump_streak(conn: &mut SqliteConnection) -> Result<(), String> {
    let today = task_day(Local::now());
    let row: Option<(i64, Option<String>)> =
        sqlx::query_as("SELECT current, last_active_date FROM streaks WHERE id = 1")
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    let (current, last_str) = row.unwrap_or((0, None));
    let last_date = last_str.and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok());
    let next = next_streak(current, last_date, today);
    sqlx::query(
        "INSERT INTO streaks (id, current, last_active_date) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET current = excluded.current, last_active_date = excluded.last_active_date",
    )
    .bind(next)
    .bind(today.format("%Y-%m-%d").to_string())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn begin_write(pool: &SqlitePool) -> Result<sqlx::Transaction<'static, Sqlite>, String> {
    pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())
}

/// 由流水账聚合出钱包快照。
pub async fn build_wallet<'a>(executor: impl Executor<'a, Database = Sqlite>) -> Result<Wallet, String> {
    // One database round trip, and all balances come from the same SQLite snapshot.
    let (xp_total, coins, streak): (i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT COALESCE(SUM(delta), 0) FROM xp_ledger),
                (SELECT COALESCE(SUM(delta), 0) FROM coin_ledger),
                COALESCE((SELECT current FROM streaks WHERE id = 1), 0)")
        .fetch_one(executor)
        .await
        .map_err(|e| e.to_string())?;
    let (level, xp_into_level, xp_to_next) = level_progress(xp_total);
    Ok(Wallet {
        xp_total,
        coins,
        level,
        xp_into_level,
        xp_to_next,
        streak,
    })
}

/// Write both ledgers and streak inside the caller's transaction; emit only after commit.
pub async fn settle_earn(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    xp: i64,
    coins: i64,
    reason: &str,
    ref_id: Option<&str>,
) -> Result<(), String> {
    let now = now_utc_iso();
    sqlx::query("INSERT INTO xp_ledger (id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(Uuid::new_v4().to_string())
        .bind(xp)
        .bind(reason)
        .bind(ref_id)
        .bind(&now)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO coin_ledger (id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(Uuid::new_v4().to_string())
        .bind(coins)
        .bind(reason)
        .bind(ref_id)
        .bind(&now)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    bump_streak(tx).await?;
    Ok(())
}

/// 撤回结算（reopen_task / reopen_step 调用）：对 xp_ledger / coin_ledger 中
/// ref_id 在 base_reason 及 base_reason||"-revoke" 下的流水求净值，净值 > 0 时
/// 插入一条 -净值 的反向记录（reason = base_reason||"-revoke"），幂等；不动 streak。
pub async fn revoke(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    ref_id: &str,
    base_reason: &str,
) -> Result<(), String> {
    let revoke_reason = format!("{base_reason}-revoke");
    let now = now_utc_iso();
    // table 仅为本模块内部常量，非用户输入
    for table in ["xp_ledger", "coin_ledger"] {
        let select_sql = format!("SELECT delta FROM {table} WHERE ref_id = ? AND reason IN (?, ?)");
        let entries: Vec<i64> = sqlx::query_scalar::<_, i64>(&select_sql)
            .bind(ref_id)
            .bind(base_reason)
            .bind(&revoke_reason)
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
        if let Some(delta) = compute_revoke_delta(&entries) {
            let insert_sql = format!(
                "INSERT INTO {table} (id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?)"
            );
            sqlx::query(&insert_sql)
                .bind(Uuid::new_v4().to_string())
                .bind(delta)
                .bind(&revoke_reason)
                .bind(ref_id)
                .bind(&now)
                .execute(&mut **tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    // Undo preserves the streak. The caller commits and publishes the wallet snapshot.
    Ok(())
}

// ---------- Tauri Commands ----------

#[tauri::command]
pub async fn get_wallet(state: State<'_, SqlitePool>) -> Result<Wallet, String> {
    build_wallet(state.inner()).await
}

// ---------- 商店（契约 §2.4） ----------

async fn fetch_reward(pool: &SqlitePool, id: &str) -> Result<Reward, String> {
    sqlx::query_as::<_, Reward>("SELECT * FROM rewards WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("奖励不存在：{id}"))
}

#[tauri::command]
pub async fn add_reward(
    state: State<'_, SqlitePool>,
    title: String,
    price: i64,
    stock: Option<i64>,
) -> Result<Reward, String> {
    if title.trim().is_empty() {
        return Err("奖励标题不能为空".to_string());
    }
    if price < 1 {
        return Err(format!("价格必须 ≥ 1，当前值：{price}"));
    }
    if let Some(s) = stock {
        if s < 0 {
            return Err(format!("库存不能为负数，当前值：{s}"));
        }
    }
    let pool = state.inner();
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO rewards (id, title, price, stock, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(title.trim())
        .bind(price)
        .bind(stock)
        .bind(now_utc_iso())
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    fetch_reward(pool, &id).await
}

#[tauri::command]
pub async fn update_reward(
    state: State<'_, SqlitePool>,
    id: String,
    title: Option<String>,
    price: Option<i64>,
    stock: Option<Option<i64>>,
) -> Result<Reward, String> {
    if let Some(t) = &title {
        if t.trim().is_empty() {
            return Err("奖励标题不能为空".to_string());
        }
    }
    if let Some(p) = price {
        if p < 1 {
            return Err(format!("价格必须 ≥ 1，当前值：{p}"));
        }
    }
    if let Some(Some(s)) = &stock {
        if *s < 0 {
            return Err(format!("库存不能为负数，当前值：{s}"));
        }
    }
    let pool = state.inner();
    if title.is_none() && price.is_none() && stock.is_none() {
        return fetch_reward(pool, &id).await;
    }
    let mut qb = sqlx::QueryBuilder::new("UPDATE rewards SET ");
    let mut sep = qb.separated(", ");
    if let Some(t) = &title {
        sep.push("title = ").push_bind(t.trim().to_string());
    }
    if let Some(p) = price {
        sep.push("price = ").push_bind(p);
    }
    if let Some(s) = &stock {
        // Some(None) = 置为不限量；None = 不改动
        sep.push("stock = ").push_bind(*s);
    }
    qb.push(" WHERE id = ").push_bind(&id);
    let result = qb.build().execute(pool).await.map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err(format!("奖励不存在：{id}"));
    }
    fetch_reward(pool, &id).await
}

#[tauri::command]
pub async fn delete_reward(state: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    let result = sqlx::query("DELETE FROM rewards WHERE id = ?")
        .bind(&id)
        .execute(state.inner())
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err(format!("奖励不存在：{id}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_rewards(state: State<'_, SqlitePool>) -> Result<Vec<Reward>, String> {
    sqlx::query_as::<_, Reward>("SELECT * FROM rewards ORDER BY created_at ASC")
        .fetch_all(state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_redemptions(
    state: State<'_, SqlitePool>,
    limit: Option<i64>,
) -> Result<Vec<Redemption>, String> {
    sqlx::query_as::<_, Redemption>(
        "SELECT * FROM reward_redemptions ORDER BY created_at DESC LIMIT ?",
    )
    .bind(limit.unwrap_or(50))
    .fetch_all(state.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redeem_reward(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    reward_id: String,
) -> Result<Wallet, String> {
    let wallet = redeem_reward_db(state.inner(), &reward_id).await?;
    let _ = app.emit("wallet-updated", &wallet);
    Ok(wallet)
}

pub(crate) async fn redeem_reward_db(pool: &SqlitePool, reward_id: &str) -> Result<Wallet, String> {
    let mut tx = begin_write(pool).await?;
    let reward = sqlx::query_as::<_, Reward>("SELECT * FROM rewards WHERE id = ?")
        .bind(reward_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?
        .ok_or_else(|| format!("奖励不存在：{reward_id}"))?;
    let wallet = build_wallet(&mut *tx).await?;
    check_redeem(wallet.coins, reward.price, reward.stock)?;

    // 限量奖励原子扣库存，防并发超卖
    if reward.stock.is_some() {
        let res = sqlx::query("UPDATE rewards SET stock = stock - 1 WHERE id = ? AND stock > 0")
            .bind(&reward_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        if res.rows_affected() == 0 {
            return Err("库存不足，该奖励已兑完".to_string());
        }
    }

    let redemption_id = Uuid::new_v4().to_string();
    let now = now_utc_iso();
    sqlx::query(
        "INSERT INTO reward_redemptions (id, reward_id, reward_title, price_paid, created_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&redemption_id)
    .bind(&reward.id)
    .bind(&reward.title)
    .bind(reward.price)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO coin_ledger (id, delta, reason, ref_id, created_at) VALUES (?, ?, 'redeem', ?, ?)")
        .bind(Uuid::new_v4().to_string())
        .bind(-reward.price)
        .bind(&redemption_id)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let wallet = build_wallet(&mut *tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(wallet)
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[tokio::test]
    async fn wallet_reads_empty_balances_and_signed_ledger_entries() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let empty = build_wallet(&pool).await.unwrap();
        assert_eq!((empty.xp_total, empty.coins, empty.level, empty.streak), (0, 0, 1, 0));
        for (id, delta) in [("earned", 350_i64), ("revoked", -50)] {
            sqlx::query("INSERT INTO xp_ledger (id, delta, reason, created_at) VALUES (?, ?, 'test', '2026-10-01')")
                .bind(id).bind(delta).execute(&pool).await.unwrap();
        }
        for (id, delta) in [("earned", 100_i64), ("spent", -30)] {
            sqlx::query("INSERT INTO coin_ledger (id, delta, reason, created_at) VALUES (?, ?, 'test', '2026-10-01')")
                .bind(id).bind(delta).execute(&pool).await.unwrap();
        }
        sqlx::query("UPDATE streaks SET current = 4 WHERE id = 1")
            .execute(&pool).await.unwrap();
        let wallet = build_wallet(&pool).await.unwrap();
        assert_eq!((wallet.xp_total, wallet.coins, wallet.level, wallet.xp_into_level, wallet.streak), (300, 70, 3, 0, 4));
    }

    #[test]
    fn task_xp_base_formula() {
        // 5 + 3×3 = 14
        assert_eq!(task_xp(3, None), 14);
        assert_eq!(task_xp(1, None), 8);
        assert_eq!(task_xp(5, None), 20);
    }

    #[test]
    fn task_xp_estimate_bonus_capped_at_20() {
        // 估时 300min → 300/10=30 → 封顶 +20
        assert_eq!(task_xp(3, Some(300)), 14 + 20);
        assert_eq!(task_xp(3, Some(60)), 14 + 6);
        assert_eq!(task_xp(3, Some(15)), 14 + 1);
    }

    #[test]
    fn coins_half_of_xp_floor_1() {
        assert_eq!(coins_from_xp(14), 7);
        assert_eq!(coins_from_xp(1), 1);
        assert_eq!(coins_from_xp(0), 1);
        assert_eq!(coins_from_xp(21), 10);
    }

    #[test]
    fn step_xp_uses_parent_importance() {
        assert_eq!(step_xp(1), 4);
        assert_eq!(step_xp(3), 6);
        assert_eq!(step_xp(5), 8);
    }

    #[test]
    fn level_curve_100n_per_level() {
        assert_eq!(level_progress(0), (1, 0, 100));
        assert_eq!(level_progress(99), (1, 99, 100));
        assert_eq!(level_progress(100), (2, 0, 200));
        assert_eq!(level_progress(250), (2, 150, 200));
        assert_eq!(level_progress(300), (3, 0, 300));
        assert_eq!(level_progress(600), (4, 0, 400));
    }

    #[test]
    fn task_day_4am_boundary() {
        // 3:59 算昨天
        let before = Local.with_ymd_and_hms(2026, 8, 27, 3, 59, 59).unwrap();
        assert_eq!(task_day(before), NaiveDate::from_ymd_opt(2026, 8, 26).unwrap());
        // 4:00 算今天
        let at = Local.with_ymd_and_hms(2026, 8, 27, 4, 0, 0).unwrap();
        assert_eq!(task_day(at), NaiveDate::from_ymd_opt(2026, 8, 27).unwrap());
    }

    #[test]
    fn streak_same_day_unchanged() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 27).unwrap();
        assert_eq!(next_streak(5, Some(today), today), 5);
    }

    #[test]
    fn streak_consecutive_day_increments() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 27).unwrap();
        let yesterday = NaiveDate::from_ymd_opt(2026, 8, 26).unwrap();
        assert_eq!(next_streak(5, Some(yesterday), today), 6);
    }

    #[test]
    fn streak_gap_resets_to_1() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 27).unwrap();
        let long_ago = NaiveDate::from_ymd_opt(2026, 8, 20).unwrap();
        assert_eq!(next_streak(5, Some(long_ago), today), 1);
        assert_eq!(next_streak(5, None, today), 1);
    }

    #[test]
    fn redeem_rejects_insufficient_coins() {
        assert!(check_redeem(3, 10, None).is_err());
        assert!(check_redeem(3, 10, Some(5)).is_err());
    }

    #[test]
    fn redeem_rejects_zero_stock() {
        assert!(check_redeem(100, 10, Some(0)).is_err());
    }

    #[test]
    fn redeem_accepts_valid() {
        assert!(check_redeem(10, 10, None).is_ok());
        assert!(check_redeem(10, 10, Some(1)).is_ok());
    }

    #[test]
    fn revoke_positive_net_generates_negative_delta() {
        // 结算过 +14，撤回应插入 -14
        assert_eq!(compute_revoke_delta(&[14]), Some(-14));
        assert_eq!(compute_revoke_delta(&[10, 4]), Some(-14));
    }

    #[test]
    fn revoke_zero_or_negative_net_is_noop() {
        assert_eq!(compute_revoke_delta(&[]), None);
        assert_eq!(compute_revoke_delta(&[14, -14]), None);
        assert_eq!(compute_revoke_delta(&[-5]), None);
    }

    #[test]
    fn revoke_is_idempotent_after_revoke_entry() {
        // 第一次撤回后 entries = [14, -14]，再撤回不再扣
        let first = compute_revoke_delta(&[14]).unwrap();
        assert_eq!(first, -14);
        assert_eq!(compute_revoke_delta(&[14, first]), None);
    }
}
