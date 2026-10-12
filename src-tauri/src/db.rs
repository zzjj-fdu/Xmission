use std::path::Path;

use sqlx::SqlitePool;

/// 初始化 SQLite 连接池：创建数据目录、打开（必要时创建）数据库文件并执行迁移。
pub async fn init_pool(app_data_dir: &Path) -> Result<SqlitePool, sqlx::Error> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("xmission.db");
    let is_new_database = !db_path.exists();
    // Keep the previous on-disk database before a migration changes its schema.
    if db_path.exists() {
        std::fs::copy(&db_path, app_data_dir.join("xmission.db.bak"))?;
    }
    let url = format!("sqlite:{}?mode=rwc", db_path.to_string_lossy());
    let pool = SqlitePool::connect(&url).await?;
    sqlx::migrate!().run(&pool).await?;
    if is_new_database {
        sqlx::query("INSERT OR IGNORE INTO settings(key,value) VALUES('first_experience_eligible','true')")
            .execute(&pool).await?;
    }
    Ok(pool)
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn only_new_databases_get_first_experience_marker() {
        let dir = std::env::temp_dir().join(format!("xmission-onboarding-{}", uuid::Uuid::new_v4()));
        let pool = super::init_pool(&dir).await.unwrap();
        let value: String = sqlx::query_scalar("SELECT value FROM settings WHERE key='first_experience_eligible'").fetch_one(&pool).await.unwrap();
        assert_eq!(value, "true");
        sqlx::query("DELETE FROM settings WHERE key='first_experience_eligible'").execute(&pool).await.unwrap();
        pool.close().await;
        let pool = super::init_pool(&dir).await.unwrap();
        let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key='first_experience_eligible'").fetch_optional(&pool).await.unwrap();
        assert!(value.is_none(), "existing users never get an automatic opening on upgrade");
        pool.close().await;
        assert!(std::fs::canonicalize(&dir).unwrap().starts_with(std::fs::canonicalize(std::env::temp_dir()).unwrap()));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
