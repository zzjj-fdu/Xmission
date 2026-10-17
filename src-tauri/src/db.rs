use std::{borrow::Cow, collections::HashMap, path::Path};

use sqlx::{migrate::{Migration, Migrator}, SqlitePool};

/// Older Windows and Mac packages embedded identical SQL with different newlines.
/// Match only those exact LF/CRLF variants in memory; never rewrite stored history
/// or bypass SQLx's validation for edited, missing, or incomplete migrations.
async fn compatible_migrator(pool: &SqlitePool) -> Result<Migrator, sqlx::Error> {
    let has_history: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations')"
    ).fetch_one(pool).await?;
    let applied: HashMap<i64, Vec<u8>> = if has_history {
        sqlx::query_as::<_, (i64, Vec<u8>)>(
            "SELECT version,checksum FROM _sqlx_migrations WHERE success=1"
        ).fetch_all(pool).await?.into_iter().collect()
    } else {
        HashMap::new()
    };
    let mut migrator = sqlx::migrate!();
    for migration in migrator.migrations.to_mut() {
        let lf_sql = migration.sql.replace("\r\n", "\n");
        let lf = Migration::new(migration.version, migration.description.clone(),
            migration.migration_type, Cow::Owned(lf_sql.clone()), migration.no_tx);
        if let Some(checksum) = applied.get(&migration.version) {
            if checksum.as_slice() != lf.checksum.as_ref() {
                let crlf = Migration::new(migration.version, migration.description.clone(),
                    migration.migration_type, Cow::Owned(lf_sql.replace('\n', "\r\n")), migration.no_tx);
                if checksum.as_slice() == crlf.checksum.as_ref() {
                    *migration = crlf;
                    continue;
                }
            }
        }
        // New migrations always use LF; unknown checksums still fail normally.
        *migration = lf;
    }
    Ok(migrator)
}

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
    compatible_migrator(&pool).await?.run(&pool).await?;
    if is_new_database {
        sqlx::query("INSERT OR IGNORE INTO settings(key,value) VALUES('first_experience_eligible','true')")
            .execute(&pool).await?;
    }
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;
    use sqlx::migrate::Migration;

    async fn legacy_database(crlf: bool) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("xmission-upgrade-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}?mode=rwc", dir.join("xmission.db").display())).await.unwrap();
        let mut old = sqlx::migrate!();
        old.migrations = Cow::Owned(old.iter().filter(|m| m.version <= 13).map(|m| {
            let lf = m.sql.replace("\r\n", "\n");
            Migration::new(m.version, m.description.clone(), m.migration_type,
                Cow::Owned(if crlf { lf.replace('\n', "\r\n") } else { lf }), m.no_tx)
        }).collect());
        old.run(&pool).await.unwrap();
        sqlx::query("INSERT INTO tasks(id,title,form,created_at) VALUES('upgrade-sentinel','我的旧任务','side_quest','2026-10-01')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES('upgrade-sentinel','旧设置')")
            .execute(&pool).await.unwrap();
        pool.close().await;
        dir
    }

    async fn assert_legacy_upgrade(crlf: bool) {
        let dir = legacy_database(crlf).await;
        let before = sqlx::SqlitePool::connect(&format!("sqlite:{}", dir.join("xmission.db").display())).await.unwrap();
        let checksums: Vec<(i64, Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&before).await.unwrap();
        before.close().await;
        let pool = super::init_pool(&dir).await.expect("upgrading a newline-equivalent historical database must succeed");
        let title: String = sqlx::query_scalar("SELECT title FROM tasks WHERE id='upgrade-sentinel'").fetch_one(&pool).await.unwrap();
        assert_eq!(title, "我的旧任务");
        let value: String = sqlx::query_scalar("SELECT value FROM settings WHERE key='upgrade-sentinel'").fetch_one(&pool).await.unwrap();
        assert_eq!(value, "旧设置");
        let after: Vec<(i64, Vec<u8>)> = sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations WHERE version<=13 ORDER BY version")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(after, checksums, "historical migration metadata must remain unchanged");
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations WHERE success=1").fetch_one(&pool).await.unwrap();
        assert_eq!(count as usize, sqlx::migrate!().iter().count());
        pool.close().await;
        let reopened = super::init_pool(&dir).await.expect("repaired upgrades must also reopen");
        reopened.close().await;
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn upgrades_lf_database_without_changing_user_data_or_checksums() {
        assert_legacy_upgrade(false).await;
    }

    #[tokio::test]
    async fn upgrades_crlf_database_without_changing_user_data_or_checksums() {
        assert_legacy_upgrade(true).await;
    }

    #[tokio::test]
    async fn still_rejects_modified_migration_checksums() {
        let dir = legacy_database(false).await;
        let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", dir.join("xmission.db").display())).await.unwrap();
        sqlx::query("UPDATE _sqlx_migrations SET checksum=zeroblob(48) WHERE version=8").execute(&pool).await.unwrap();
        pool.close().await;
        let result = super::init_pool(&dir).await;
        assert!(matches!(result, Err(sqlx::Error::Migrate(ref error)) if matches!(**error, sqlx::migrate::MigrateError::VersionMismatch(8))));
        let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}", dir.join("xmission.db").display())).await.unwrap();
        let title: String = sqlx::query_scalar("SELECT title FROM tasks WHERE id='upgrade-sentinel'").fetch_one(&pool).await.unwrap();
        assert_eq!(title, "我的旧任务");
        pool.close().await;
        std::fs::remove_dir_all(dir).unwrap();
    }

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
