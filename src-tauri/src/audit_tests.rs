//! Regression tests use isolated SQLite files, never the user's database.
use crate::{export, gamification, models::UpdateTaskPatch, pomodoro, steps, task_engine};
use sqlx::{sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions}, SqlitePool};

struct Database {
    pool: SqlitePool,
    path: std::path::PathBuf,
}
impl Database {
    async fn new() -> Self {
        let path = std::env::temp_dir().join(format!("xmission-audit-{}.db", uuid::Uuid::new_v4()));
        let options = SqliteConnectOptions::new().filename(&path).create_if_missing(true)
            .foreign_keys(true).journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(std::time::Duration::from_secs(10));
        let pool = SqlitePoolOptions::new().max_connections(4).connect_with(options).await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        sqlx::query("INSERT INTO tasks (id, title, form, importance, urgency, created_at) VALUES ('task', 'Test', 'main_quest', 3, 3, '2026-10-02')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO task_steps (id, task_id, title, order_index) VALUES ('step', 'task', 'Step', 0)")
            .execute(&pool).await.unwrap();
        Self { pool, path }
    }
    async fn dispose(self) {
        self.pool.close().await;
        // SQLx's SQLite worker may release its Windows file handle just after pool.close().
        for attempt in 0..20 {
            match std::fs::remove_file(&self.path) {
                Ok(()) => return,
                Err(_) if attempt < 19 => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
                Err(error) => panic!("Cannot remove isolated test database: {error}"),
            }
        }
    }
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}
async fn fail_coin_writes(pool: &SqlitePool) {
    sqlx::query("CREATE TRIGGER fail_coin BEFORE INSERT ON coin_ledger BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
        .execute(pool).await.unwrap();
}

#[tokio::test]
async fn parallel_task_completion_and_reopen_award_and_revoke_once() {
    let db = Database::new().await;
    let (a, b, c) = tokio::join!(task_engine::complete_task_db(&db.pool, "task"), task_engine::complete_task_db(&db.pool, "task"), task_engine::complete_task_db(&db.pool, "task"));
    assert!(a.is_ok() && b.is_ok() && c.is_ok());
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM xp_ledger").await, 1);
    assert_eq!(gamification::build_wallet(&db.pool).await.unwrap().xp_total, 14);
    let (a, b) = tokio::join!(task_engine::reopen_task_db(&db.pool, "task"), task_engine::reopen_task_db(&db.pool, "task"));
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM xp_ledger WHERE reason = 'task-revoke'").await, 1);
    let wallet = gamification::build_wallet(&db.pool).await.unwrap();
    assert_eq!((wallet.xp_total, wallet.coins), (0, 0));
    // Undo followed by a deliberate new completion still earns exactly one reward.
    task_engine::complete_task_db(&db.pool, "task").await.unwrap();
    assert_eq!(gamification::build_wallet(&db.pool).await.unwrap().xp_total, 14);
    db.dispose().await;
}

#[tokio::test]
async fn recurring_completion_is_serialized_per_day() {
    let db = Database::new().await;
    sqlx::query("UPDATE tasks SET recurrence = 'daily' WHERE id = 'task'").execute(&db.pool).await.unwrap();
    let (a, b) = tokio::join!(task_engine::complete_task_db(&db.pool, "task"), task_engine::complete_task_db(&db.pool, "task"));
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM xp_ledger").await, 1);
    assert_eq!(count(&db.pool, "SELECT streak FROM tasks WHERE id = 'task'").await, 1);
    let (a, b) = tokio::join!(task_engine::reopen_task_db(&db.pool, "task"), task_engine::reopen_task_db(&db.pool, "task"));
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(gamification::build_wallet(&db.pool).await.unwrap().xp_total, 0);
    db.dispose().await;
}

#[tokio::test]
async fn failed_task_completion_and_revoke_roll_back_state_and_both_ledgers() {
    let db = Database::new().await;
    fail_coin_writes(&db.pool).await;
    assert!(task_engine::complete_task_db(&db.pool, "task").await.is_err());
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM tasks WHERE status = 'open' AND completed_at IS NULL").await, 1);
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM xp_ledger").await, 0);
    assert_eq!(count(&db.pool, "SELECT current FROM streaks").await, 0);
    sqlx::query("DROP TRIGGER fail_coin").execute(&db.pool).await.unwrap();
    task_engine::complete_task_db(&db.pool, "task").await.unwrap();
    fail_coin_writes(&db.pool).await;
    assert!(task_engine::reopen_task_db(&db.pool, "task").await.is_err());
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM tasks WHERE status = 'done'").await, 1);
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM xp_ledger WHERE reason = 'task-revoke'").await, 0);
    assert_eq!(gamification::build_wallet(&db.pool).await.unwrap().coins, 7);
    db.dispose().await;
}

#[tokio::test]
async fn parallel_steps_are_idempotent_and_failed_settlement_rolls_back() {
    let db = Database::new().await;
    fail_coin_writes(&db.pool).await;
    assert!(steps::set_step_completed(&db.pool, "step", true).await.is_err());
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM task_steps WHERE status = 'open'").await, 1);
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM xp_ledger").await, 0);
    sqlx::query("DROP TRIGGER fail_coin").execute(&db.pool).await.unwrap();
    let (a, b) = tokio::join!(steps::set_step_completed(&db.pool, "step", true), steps::set_step_completed(&db.pool, "step", true));
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(gamification::build_wallet(&db.pool).await.unwrap().xp_total, 6);
    let (a, b) = tokio::join!(steps::set_step_completed(&db.pool, "step", false), steps::set_step_completed(&db.pool, "step", false));
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(gamification::build_wallet(&db.pool).await.unwrap().xp_total, 0);
    db.dispose().await;
}

async fn seed_shop(pool: &SqlitePool) {
    sqlx::query("INSERT INTO rewards (id, title, price, stock, created_at) VALUES ('reward', 'Test prize', 7, 2, '2026-10-02')").execute(pool).await.unwrap();
    sqlx::query("INSERT INTO coin_ledger (id, delta, reason, created_at) VALUES ('seed', 10, 'test', '2026-10-02')").execute(pool).await.unwrap();
}

#[tokio::test]
async fn parallel_shop_redemptions_cannot_overspend() {
    let db = Database::new().await;
    seed_shop(&db.pool).await;
    let (a, b) = tokio::join!(gamification::redeem_reward_db(&db.pool, "reward"), gamification::redeem_reward_db(&db.pool, "reward"));
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    assert_eq!(gamification::build_wallet(&db.pool).await.unwrap().coins, 3);
    assert_eq!(count(&db.pool, "SELECT stock FROM rewards WHERE id = 'reward'").await, 1);
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM reward_redemptions").await, 1);
    db.dispose().await;
}

#[tokio::test]
async fn failed_redemption_restores_stock_records_and_balance() {
    let db = Database::new().await;
    seed_shop(&db.pool).await;
    fail_coin_writes(&db.pool).await;
    assert!(gamification::redeem_reward_db(&db.pool, "reward").await.is_err());
    assert_eq!(count(&db.pool, "SELECT stock FROM rewards WHERE id = 'reward'").await, 2);
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM reward_redemptions").await, 0);
    assert_eq!(gamification::build_wallet(&db.pool).await.unwrap().coins, 10);
    db.dispose().await;
}

#[tokio::test]
async fn nullable_patches_distinguish_missing_clear_and_value() {
    let db = Database::new().await;
    let patch: UpdateTaskPatch = serde_json::from_value(serde_json::json!({"notes":"hello", "deadline":"2026-10-02", "estimatedMin":20, "plannedDate":"2026-10-03"})).unwrap();
    task_engine::update_task_db(&db.pool, "task", patch).await.unwrap();
    let unchanged = task_engine::update_task_db(&db.pool, "task", serde_json::from_str("{\"title\":\"Renamed\"}").unwrap()).await.unwrap();
    assert_eq!(unchanged.notes.as_deref(), Some("hello"));
    assert_eq!(unchanged.estimated_min, Some(20));
    let patch = serde_json::from_value(serde_json::json!({"notes":null,"deadline":null,"estimatedMin":null,"plannedDate":null})).unwrap();
    let cleared = task_engine::update_task_db(&db.pool, "task", patch).await.unwrap();
    assert!(cleared.notes.is_none() && cleared.deadline.is_none() && cleared.estimated_min.is_none() && cleared.planned_date.is_none());
    assert!(task_engine::update_task_db(&db.pool, "task", serde_json::from_str("{\"status\":\"done\"}").unwrap()).await.is_err());
    db.dispose().await;
}

#[tokio::test]
async fn pomodoro_start_preserves_old_session_on_invalid_task_or_insert_failure() {
    let db = Database::new().await;
    let first = pomodoro::start_session_db(&db.pool, Some("task".into())).await.unwrap();
    assert!(pomodoro::start_session_db(&db.pool, Some("missing".into())).await.is_err());
    sqlx::query("CREATE TRIGGER fail_session BEFORE INSERT ON pomodoro_sessions BEGIN SELECT RAISE(ABORT, 'injected failure'); END").execute(&db.pool).await.unwrap();
    assert!(pomodoro::start_session_db(&db.pool, None).await.is_err());
    let active: String = sqlx::query_scalar("SELECT id FROM pomodoro_sessions WHERE state IN ('running','paused')").fetch_one(&db.pool).await.unwrap();
    assert_eq!(active, first.id);
    db.dispose().await;
}

#[tokio::test]
async fn parallel_pomodoro_start_and_finish_keep_one_active_and_award_once() {
    let db = Database::new().await;
    let (a, b) = tokio::join!(pomodoro::start_session_db(&db.pool, None), pomodoro::start_session_db(&db.pool, None));
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM pomodoro_sessions WHERE state IN ('running','paused')").await, 1);
    fail_coin_writes(&db.pool).await;
    assert!(pomodoro::finish_session_db(&db.pool, true).await.is_err());
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM pomodoro_sessions WHERE state = 'running'").await, 1);
    assert_eq!(count(&db.pool, "SELECT COUNT(*) FROM xp_ledger").await, 0);
    sqlx::query("DROP TRIGGER fail_coin").execute(&db.pool).await.unwrap();
    let (a, b) = tokio::join!(pomodoro::finish_session_db(&db.pool, true), pomodoro::finish_session_db(&db.pool, true));
    assert!(a.is_ok() && b.is_ok());
    let wallet = gamification::build_wallet(&db.pool).await.unwrap();
    assert_eq!((wallet.xp_total, wallet.coins), (5, 2));
    db.dispose().await;
}

#[tokio::test]
async fn backup_contains_lottery_history_and_never_overwrites() {
    let db = Database::new().await;
    sqlx::query("INSERT INTO lottery_draws (id, prize_title, prize_kind, prize_amount, prize_index, cost_paid, created_at) VALUES ('draw','Prize','coins',10,0,30,'2026-10-02')").execute(&db.pool).await.unwrap();
    let doc = export::backup_document(&db.pool).await.unwrap();
    assert_eq!(doc["tables"]["lottery_draws"][0]["id"], "draw");
    let dir = db.path.parent().unwrap();
    let first = export::write_backup(dir, &doc).unwrap();
    let second = export::write_backup(dir, &doc).unwrap();
    assert_ne!(first, second);
    assert_eq!(std::fs::read(&first).unwrap(), std::fs::read(&second).unwrap());
    std::fs::remove_file(first).unwrap();
    std::fs::remove_file(second).unwrap();
    db.dispose().await;
}
