//! A short-lived local command, not a persistent MCP subprocess or GUI instance.
//! OpenClaw invokes this through its local execution tool for each operation.
use std::{io::{Read, Write}, path::{Path, PathBuf}};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use base64::Engine;

const MAX_REQUEST_BYTES: usize = 256 * 1024;

fn read_request(reader: impl Read) -> Result<Value, String> {
    let mut bytes=Vec::new();
    reader.take((MAX_REQUEST_BYTES+1) as u64).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()>MAX_REQUEST_BYTES {return Err("操作请求不能超过 256 KB".into());}
    // Windows editors commonly save UTF-8 with a BOM.
    let bytes=bytes.strip_prefix(&[0xef,0xbb,0xbf]).unwrap_or(&bytes);
    let request:Value=serde_json::from_slice(bytes).map_err(|_|"请提供 UTF-8 JSON 操作请求".to_string())?;
    validate_request(&request)?;
    Ok(request)
}

fn validate_request(request:&Value) -> Result<(&str,Value),String> {
    let obj=request.as_object().ok_or("操作请求须为 JSON 对象")?;
    if obj.keys().any(|k| !matches!(k.as_str(),"name"|"arguments")) {
        return Err("操作请求仅包含 name 和 arguments".into());
    }
    let name=request["name"].as_str().ok_or("请提供工具 name")?;
    if !crate::agent_tools::catalog().iter().any(|t| t["name"]==name) {return Err("未知的 Xmission 工具".into());}
    let args=request.get("arguments").cloned().unwrap_or_else(||json!({}));
    if !args.is_object() {return Err("arguments 须为 JSON 对象".into());}
    Ok((name,args))
}

fn data_directory() -> Result<PathBuf,String> {
    if let Some(path)=std::env::var_os("XMISSION_DATA_DIR") {return Ok(PathBuf::from(path));}
    // Matches Tauri PathResolver::app_data_dir on Windows/macOS/Linux.
    let config:Value=serde_json::from_str(include_str!("../tauri.conf.json")).map_err(|e|e.to_string())?;
    let identifier=config["identifier"].as_str().ok_or("应用数据目录配置无效")?;
    Ok(dirs::data_dir().ok_or("无法找到本机应用数据目录")?.join(identifier))
}

async fn open_existing(directory:&Path) -> Result<SqlitePool,String> {
    let path=directory.join("xmission.db");
    if !path.is_file() {return Err("请先打开新版 Xmission，并在设置中开启任务接管".into());}
    // Do not create/migrate a DB, copy backups, or freeze focus sessions here.
    let options=sqlx::sqlite::SqliteConnectOptions::new().filename(path).create_if_missing(false)
        .busy_timeout(std::time::Duration::from_secs(10));
    sqlx::sqlite::SqlitePoolOptions::new().max_connections(2).connect_with(options).await.map_err(|e|e.to_string())
}

/// Return None only for an absent listener. A timeout, denied request or invalid
/// response must never silently fall back to a second database mutation.
pub(crate) async fn database_scope(pool:&SqlitePool) -> Result<String,String> {
    let file:String=sqlx::query_scalar("SELECT file FROM pragma_database_list WHERE name = 'main'")
        .fetch_one(pool).await.map_err(|e|e.to_string())?;
    if file.is_empty() {return Ok("memory".into());}
    let path=std::fs::canonicalize(file).map_err(|e|e.to_string())?;
    let path=path.to_string_lossy().into_owned();
    #[cfg(windows)]
    let path=path.to_lowercase();
    Ok(base64::engine::general_purpose::STANDARD.encode(path.as_bytes()))
}

pub(crate) async fn forward(endpoint:&str,credential:&str,scope:&str,request:&Value) -> Result<Option<Value>,String> {
    let client=reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(30))
        .build().map_err(|e|e.to_string())?;
    let post=|message:Value| client.post(endpoint).bearer_auth(credential)
        .header("Accept","application/json, text/event-stream")
        .header("MCP-Protocol-Version","2025-11-25").header("Xmission-Data-Scope",scope).json(&message);
    // Prove the running UI knows the data-scoping protocol BEFORE sending any
    // mutation. An older version may simply ignore an unknown request header.
    let initialized=post(json!({"jsonrpc":"2.0","id":"xmission-once-init","method":"initialize","params":{
        "protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"xmission-once","version":env!("CARGO_PKG_VERSION")}
    }})).send().await;
    let initialized=match initialized {
        Ok(r)=>r,
        Err(e) if e.is_connect()=>return Ok(None),
        Err(_)=>return Err("界面连接初始化失败，请重试；尚未执行操作".into()),
    };
    if !initialized.status().is_success() {return Err(format!("界面接管拒绝请求：HTTP {}",initialized.status()));}
    if initialized.headers().get("xmission-data-scope").and_then(|v|v.to_str().ok())!=Some(scope) {
        return Err("界面版本不支持按需接管的数据校验，请更新界面或先从托盘退出再调用".into());
    }
    let initialized:Value=initialized.json().await.map_err(|_|"界面连接初始化响应无效".to_string())?;
    if initialized["id"]!="xmission-once-init" || initialized["result"]["protocolVersion"]!="2025-11-25" {
        return Err("界面连接初始化不匹配".into());
    }
    let notified=post(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
        .send().await.map_err(|_|"界面连接初始化确认失败".to_string())?;
    if notified.status()!=reqwest::StatusCode::ACCEPTED {return Err("界面连接初始化确认被拒绝".into());}
    let response=post(json!({"jsonrpc":"2.0","id":"xmission-once","method":"tools/call","params":request}))
        .send().await.map_err(|_|"界面连接未确认结果，请使用相同 requestId 重试；未重复执行操作".to_string())?;
    if !response.status().is_success() {return Err(format!("界面接管拒绝请求：HTTP {}",response.status()));}
    let body:Value=response.json().await.map_err(|_|"界面接管未返回有效结果".to_string())?;
    if body["jsonrpc"]!="2.0" || body["id"]!="xmission-once" {return Err("界面接管响应不匹配".into());}
    if body.get("error").is_some() {return Err(body["error"]["message"].as_str().unwrap_or("界面接管请求失败").into());}
    let result=&body["result"];
    if result["isError"]==true {return Err(result["content"][0]["text"].as_str().unwrap_or("操作失败").into());}
    Ok(Some(result.get("structuredContent").cloned().ok_or("界面接管返回结果不完整")?))
}

#[cfg(not(test))]
async fn execute(directory:&Path,request:&Value) -> Result<Value,String> {
    let (name,args)=validate_request(request)?;
    let pool=open_existing(directory).await?;
    let result=async {
        crate::agent_tools::require_enabled(&pool).await?;
        let credential=crate::agent_api::token().await?.ok_or("接管密钥缺失，请重新开启接管")?;
        let port=crate::agent_api::saved_port(&pool).await?;
        let endpoint=format!("http://127.0.0.1:{port}/mcp");
        let scope=database_scope(&pool).await?;
        if let Some(result)=forward(&endpoint,&credential,&scope,request).await? {return Ok(result);}
        crate::agent_tools::call_enabled(&pool,name,args).await
    }.await;
    // Explicitly close all connections before returning and exiting the process.
    pool.close().await;
    result
}

/// Main must call this before constructing Tauri or claiming its UI instance.
/// One invocation reads one request, emits one JSON result, and exits.
#[cfg(not(test))]
pub fn run_cli() -> Option<i32> {
    if std::env::args().any(|arg|arg=="--qa-cleanup-credentials") {return Some(match crate::credentials::cleanup_qa(){Ok(())=>0,Err(_)=>1});}
    let mut args=std::env::args_os().skip(1);
    let mode=args.next()?;
    if mode!="--agent-call" && mode!="--agent-catalog" {
        if mode.to_string_lossy().starts_with("--agent-") {
            println!("{}",json!({"isError":true,"error":"未知的接管命令，请使用 --agent-call 或 --agent-catalog"}));
            return Some(1);
        }
        return None;
    }
    let result=(|| -> Result<Value,String> {
        if mode=="--agent-catalog" {
            if args.next().is_some() {return Err("工具目录不接受额外参数".into());}
            return Ok(json!({"tools":crate::agent_tools::catalog()}));
        }
        let input=args.next();
        if args.next().is_some() {return Err("每次只接受一个请求文件；也可从标准输入传入 JSON".into());}
        let request=match input {
            Some(path)=>read_request(std::fs::File::open(path).map_err(|e|format!("无法读取请求文件：{e}"))?)?,
            None=>read_request(std::io::stdin().lock())?,
        };
        let directory=data_directory()?;
        let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e|e.to_string())?;
        let result=runtime.block_on(execute(&directory,&request));
        runtime.shutdown_timeout(std::time::Duration::from_secs(2));
        result
    })();
    let (code,response)=match result {
        Ok(value)=>(0,json!({"isError":false,"result":value})),
        Err(error)=>(1,json!({"isError":true,"error":error})),
    };
    let mut stdout=std::io::stdout().lock();
    if writeln!(stdout,"{response}").and_then(|_|stdout.flush()).is_err() {return Some(1);}
    Some(code)
}

#[cfg(test)]
pub fn run_cli() -> Option<i32> {None}

pub(crate) fn instructions(executable:&Path,directory:&Path) -> String {
    let executable=json!(executable.to_string_lossy()).to_string();
    let directory=json!(directory.to_string_lossy()).to_string();
    format!(r#"请使用按需调用管理我的 Xmission：
程序路径（JSON 字符串）：{executable}
数据目录（JSON 字符串）：{directory}

每项操作启动一个本地子进程，等待它返回一行 UTF-8 JSON 后正常退出。
不需要启动界面、常驻 MCP 服务或悬浮球，不要为此执行普通双击启动命令。
使用本机执行工具直接运行程序，并设置此子进程的 XMISSION_DATA_DIR 为上面的目录。
首次通过参数 --agent-catalog 获取当前全部工具说明和参数规范。
实际操作：将 {{"name":"xmission_工具名","arguments":{{...}}}} 写入临时 UTF-8 JSON 文件，
运行该程序，传入参数数组 ["--agent-call", "临时请求文件的绝对路径"]；
也可传入参数 ["--agent-call"] 并将同一 JSON 写入 stdin，写完关闭 stdin。
请捕获 stdout/stderr 并等待进程结束；Windows 下隐藏子进程控制台窗口。
完成后删除你自己创建的临时请求文件。

先调用 xmission_get_context 解析本地相对日期；用 list/get 获取真实 ID。
每个新写操作生成唯一 requestId，同一操作的重试复用原 ID 与完全相同参数。
返回 isError:false 才代表成功；isError:true 或非零退出码表示失败，请显示原因。
不要猜测 ID、伪造成功结果或自动改写我的工具授权策略。
准备文件范围由主程序原任务单独授权。可查看、暂停、重试已授权准备；xmission_prepare_due 每次最多检查一项到期工作，不播放音乐、不打开前台。
主程序已开启时调用自动转交给界面连接以同步显示；未开启时直接提交本地事务。
每项调用结束后这个进程就退出，无需你额外结束进程，也不要结束我的主程序。
可把这份说明保存在你自己的 Xmission 技能或长期指引中；保留已有 MCP 配置。
"#)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_reader_is_bounded_and_handles_unicode_bom_and_wrong_fields() {
        let valid="\u{feff}{\"name\":\"xmission_create_task\",\"arguments\":{\"requestId\":\"one\",\"input\":{\"title\":\"实验报告\"}}}";
        assert_eq!(read_request(valid.as_bytes()).unwrap()["arguments"]["input"]["title"],"实验报告");
        for text in ["[]","{}","{\"name\":\"unknown\"}","{\"name\":\"xmission_get_context\",\"arguments\":[]}","{\"name\":\"xmission_get_context\",\"extra\":1}"] {
            assert!(read_request(text.as_bytes()).is_err());
        }
        assert!(read_request(vec![b' ';MAX_REQUEST_BYTES+1].as_slice()).is_err());
    }

    #[tokio::test]
    async fn absent_database_is_not_created() {
        let dir=std::env::temp_dir().join(format!("xmission-missing-{}",uuid::Uuid::new_v4()));
        assert!(open_existing(&dir).await.is_err());
        assert!(!dir.exists());
    }

    #[tokio::test]
    async fn legacy_ui_is_probed_without_sending_a_mutation() {
        use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
        let writes=Arc::new(AtomicUsize::new(0));
        let observed=writes.clone();
        let router=axum::Router::new().route("/mcp",axum::routing::post(move |axum::Json(request):axum::Json<Value>| {
            let observed=observed.clone();
            async move {
                if request["method"]=="tools/call" {observed.fetch_add(1,Ordering::SeqCst);}
                axum::Json(json!({"jsonrpc":"2.0","id":request["id"],"result":{"protocolVersion":"2025-11-25"}}))
            }
        }));
        let listener=tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,0)).await.unwrap();
        let url=format!("http://127.0.0.1:{}/mcp",listener.local_addr().unwrap().port());
        let (stop,receiver)=tokio::sync::oneshot::channel::<()>();
        let worker=tokio::spawn(async move {axum::serve(listener,router).with_graceful_shutdown(async {let _=receiver.await;}).await.unwrap();});
        let request=json!({"name":"xmission_create_task","arguments":{"requestId":"old-ui","input":{"title":"不得发送"}}});
        assert!(forward(&url,"test-token","isolated-database",&request).await.unwrap_err().contains("更新界面"));
        assert_eq!(writes.load(Ordering::SeqCst),0);
        stop.send(()).unwrap();worker.await.unwrap();
    }

    #[tokio::test]
    async fn closed_app_writes_survive_worker_connections_and_respect_disabled_permission() {
        let dir=std::env::temp_dir().join(format!("xmission-once-{}",uuid::Uuid::new_v4()));
        let initial=crate::db::init_pool(&dir).await.unwrap();
        sqlx::query("INSERT INTO settings(key,value) VALUES('agent_enabled','true')").execute(&initial).await.unwrap();
        initial.close().await;
        let args=json!({"requestId":"once-create","input":{"title":"关闭界面后的任务"},"steps":[{"title":"后台步骤"}]});
        let pool=open_existing(&dir).await.unwrap();
        let before=crate::agent_tools::call_enabled(&pool,"xmission_create_task",args.clone()).await.unwrap();
        pool.close().await;
        let pool=open_existing(&dir).await.unwrap();
        assert_eq!(before,crate::agent_tools::call_enabled(&pool,"xmission_create_task",args.clone()).await.unwrap());
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT COUNT(*) FROM tasks").fetch_one(&pool).await.unwrap(),1);
        assert!(!dir.join("xmission.db.bak").exists(),"worker must not overwrite GUI migration backups");
        sqlx::query("UPDATE settings SET value='false' WHERE key='agent_enabled'").execute(&pool).await.unwrap();
        assert!(crate::agent_tools::call_enabled(&pool,"xmission_create_task",args).await.is_err());
        assert!(crate::agent_tools::call_enabled(&pool,"xmission_list_tasks",json!({})).await.is_err());
        pool.close().await;
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
