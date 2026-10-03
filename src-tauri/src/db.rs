use std::path::Path;

use sqlx::SqlitePool;

/// 初始化 SQLite 连接池：创建数据目录、打开（必要时创建）数据库文件并执行迁移。
pub async fn init_pool(app_data_dir: &Path) -> Result<SqlitePool, sqlx::Error> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("xmission.db");
    // Keep the previous on-disk database before a migration changes its schema.
    if db_path.exists() {
        std::fs::copy(&db_path, app_data_dir.join("xmission.db.bak"))?;
    }
    let url = format!("sqlite:{}?mode=rwc", db_path.to_string_lossy());
    let pool = SqlitePool::connect(&url).await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}
