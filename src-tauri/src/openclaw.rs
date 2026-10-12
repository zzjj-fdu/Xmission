async fn until_cancelled<F:std::future::Future>(work:F, mut cancel:tokio::sync::oneshot::Receiver<()>)->Option<F::Output>{
    tokio::select!{ biased; _=&mut cancel=>None, result=work=>Some(result) }
}
#[cfg(not(test))]
mod native {
    use std::{path::PathBuf, process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex}};
    use serde::{Serialize, Deserialize};
    use serde_json::{Value, json};
    use sqlx::SqlitePool;
    use tauri::{AppHandle, Manager, State, WebviewWindow};

    #[cfg(unix)]
    struct UnixProcessGroup(u32);
    #[cfg(unix)]
    impl Drop for UnixProcessGroup {fn drop(&mut self){let _=Command::new("/bin/kill").args(["-KILL","--",&format!("-{}",self.0)]).stdout(Stdio::null()).stderr(Stdio::null()).status();}}

    #[derive(Clone, Serialize, Deserialize)]
    #[serde(rename_all="camelCase")]
    pub struct ClawStatus { phase:String,message:String,mcp_connected:bool,qq_connected:bool,qq_bound:bool,qr_data_url:Option<String>,error:Option<String>,#[serde(default)] progress:Option<u8> }
    impl Default for ClawStatus { fn default()->Self {Self{phase:"idle".into(),message:"书记尚未连接".into(),mcp_connected:false,qq_connected:false,qq_bound:false,qr_data_url:None,error:None,progress:None}} }
    #[cfg(windows)]
    struct OwnedJob(windows::Win32::Foundation::HANDLE);
    #[cfg(windows)]
    unsafe impl Send for OwnedJob {}
    // Kernel job handles may be referenced across threads. Closing requires &mut self
    // through Drop; runtime ownership and all process operations are mutex guarded.
    #[cfg(windows)]
    unsafe impl Sync for OwnedJob {}
    #[cfg(windows)]
    impl Drop for OwnedJob {fn drop(&mut self){unsafe{let _=windows::Win32::Foundation::CloseHandle(self.0);}}}
    #[cfg(windows)]
    impl OwnedJob {
        fn attach(child:&Child)->Result<Self,String>{
            use std::os::windows::io::AsRawHandle;
            use windows::Win32::System::JobObjects::*;
            unsafe {
                let job=Self(CreateJobObjectW(None,None).map_err(|_|"无法创建后台进程容器")?);
                let mut limits=JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(job.0,JobObjectExtendedLimitInformation,&limits as *const _ as *const std::ffi::c_void,std::mem::size_of_val(&limits) as u32).map_err(|_|"无法设置后台退出清理")?;
                AssignProcessToJobObject(job.0,windows::Win32::Foundation::HANDLE(child.as_raw_handle())).map_err(|_|"无法关联书记后台进程")?;
                Ok(job)
            }
        }
    }
    struct Running { child:Child, stdin:Option<ChildStdin>, port:u16, token:String, #[cfg(windows)] _job:OwnedJob }
    impl Drop for Running {
        fn drop(&mut self) {
            self.stdin.take();
            // Killing the owned host and dropping its Windows job also stops npm/gateway descendants.
            #[cfg(unix)]{
                // Host starts in its own group; stop only that group, including npm/gateway children.
                let _=Command::new("/bin/kill").args(["-KILL","--",&format!("-{}",self.child.id())]).stdout(Stdio::null()).stderr(Stdio::null()).status();
            }
            let _=self.child.kill();let _=self.child.wait();
        }
    }
    struct Pending {cancel:Option<tokio::sync::oneshot::Sender<()>>,done:tokio::sync::watch::Receiver<bool>}
    #[derive(Default)]
    pub struct ClawRuntime { running:tokio::sync::Mutex<Option<Running>>, snapshot:Mutex<ClawStatus>, preparing:std::sync::atomic::AtomicBool,pending:Mutex<Option<Pending>>,cancelling:std::sync::atomic::AtomicBool }
    fn main_only(window:&WebviewWindow)->Result<(),String>{if window.label()=="main"{Ok(())}else{Err("请在主窗口配置书记".into())}}
    fn root(app:&AppHandle)->Result<PathBuf,String>{
        let data=std::env::var_os("XMISSION_DATA_DIR").map(PathBuf::from).map(Ok).unwrap_or_else(||app.path().app_data_dir().map_err(|e|e.to_string()))?;
        Ok(data.join("managed-openclaw"))
    }
    fn hide(command:&mut Command){#[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}}
    async fn bootstrap(path:&std::path::Path)->Result<PathBuf,String>{
        tokio::fs::create_dir_all(path).await.map_err(|_|"无法创建书记目录")?;
        let script=path.join("claw-bootstrap.ps1");tokio::fs::write(&script,include_str!("../resources/claw-bootstrap.ps1")).await.map_err(|_|"无法保存运行环境准备脚本")?;
        #[cfg(windows)]{
            let mut command=tokio::process::Command::new("powershell.exe");command.creation_flags(0x08000000).kill_on_drop(true);
            command.args(["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File"]).arg(script).arg("-Runtime").arg(path.join("runtime")).stdin(Stdio::null());
            let output=tokio::time::timeout(std::time::Duration::from_secs(300),command.output()).await.map_err(|_|"运行环境下载超时，请重试")?.map_err(|_|"无法启动运行环境准备")?;
            if !output.status.success(){return Err("运行环境下载或校验失败，请检查网络后重试".into());}
            let node=PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());if !node.is_file(){return Err("运行环境没有正确安装".into());}Ok(node)
        }
        #[cfg(target_os="macos")]{
            use std::os::unix::process::CommandExt;
            let script=path.join("claw-bootstrap.sh");tokio::fs::write(&script,include_str!("../resources/claw-bootstrap.sh")).await.map_err(|_|"无法保存 Mac 运行环境准备程序")?;
            let mut command=tokio::process::Command::new("/bin/sh");command.kill_on_drop(true).arg(script).arg(path.join("runtime")).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());command.as_std_mut().process_group(0);
            let child=command.spawn().map_err(|_|"无法启动 Mac 运行环境准备")?;
            let _group=UnixProcessGroup(child.id().ok_or("运行环境进程不可用")?);
            let output=tokio::time::timeout(std::time::Duration::from_secs(300),child.wait_with_output()).await.map_err(|_|"运行环境下载超时，请重试")?.map_err(|_|"无法准备 Mac 运行环境")?;
            if !output.status.success(){return Err("运行环境下载或校验失败，请检查网络后重试".into());}
            let node=PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());if !node.is_file(){return Err("运行环境没有正确安装".into());}Ok(node)
        }
        #[cfg(all(not(windows),not(target_os="macos")))]{let output=tokio::process::Command::new("node").arg("--version").kill_on_drop(true).output().await.map_err(|_|"请安装 Node 24.16 或更新兼容版本")?;if !output.status.success(){return Err("Node 不可用".into());}Ok(PathBuf::from("node"))}
    }
    async fn private_input(app:AppHandle,pool:&SqlitePool)->Result<Value,String>{
        let (base_url,model,key)=crate::llm::current_config(pool).await?;
        let key=key.ok_or_else(||"请先保存 AI API Key，再连接 OpenClaw".to_string())?;
        let service=app.state::<crate::agent_api::AgentService>();
        let state_pool=app.state::<SqlitePool>();
        let port=crate::agent_api::saved_port(pool).await?;
        crate::agent_api::set_agent_connection(app.clone(),service.clone(),state_pool.clone(),true,port).await?;
        crate::agent_api::test_agent_connection(service.clone(),state_pool.clone()).await?;
        let config=crate::agent_api::get_agent_config(service,state_pool).await?;
        Ok(json!({"baseUrl":base_url,"model":model,"apiKey":key,"mcp":serde_json::from_str::<Value>(&config).map_err(|_|"任务连接配置不可用")?}))
    }
    async fn spawn_host(app:&AppHandle,input:Value)->Result<Running,String>{
        let dir=root(app)?;let node=bootstrap(&dir).await?;
        tokio::fs::write(dir.join("claw-host.mjs"),include_str!("../resources/claw-host.mjs")).await.map_err(|_|"无法写入书记启动程序")?;
        tokio::fs::write(dir.join("claw-core.mjs"),include_str!("../resources/claw-core.mjs")).await.map_err(|_|"无法写入书记配置程序")?;
        let token=format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple());
        let mut payload=input;payload["controlToken"]=Value::String(token.clone());
        {
            use std::io::Write;
            let mut command=Command::new(node);hide(&mut command);
            #[cfg(unix)]{use std::os::unix::process::CommandExt;command.process_group(0);}
            command.arg(dir.join("claw-host.mjs")).current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
            let mut child=command.spawn().map_err(|_|"无法启动书记后台")?;
            #[cfg(windows)]
            let job=match OwnedJob::attach(&child){Ok(job)=>job,Err(e)=>{let _=child.kill();return Err(e);}};
            let mut running=Running{child,stdin:None,port:0,token,#[cfg(windows)] _job:job};
            let mut stdin=running.child.stdin.take().ok_or("后台输入不可用")?;
            writeln!(stdin,"{}",payload).map_err(|_|"无法传递书记配置")?;
            running.stdin=Some(stdin);
            let stdout=running.child.stdout.take().ok_or("后台启动结果不可用")?;
            // Only the pipe reader is blocking. The process/job stays in this cancellable future.
            let line=tokio::time::timeout(std::time::Duration::from_secs(30),tokio::task::spawn_blocking(move||{
                use std::io::BufRead;
                let mut reader=std::io::BufReader::new(stdout);let mut line=String::new();reader.read_line(&mut line)?;
                std::thread::spawn(move||{let _=std::io::copy(&mut reader,&mut std::io::sink());});
                Ok::<_,std::io::Error>(line)
            })).await.map_err(|_|"书记后台启动超时")?.map_err(|_|"书记启动没有完成")?.map_err(|_|"后台没有响应")?;
            let port=serde_json::from_str::<Value>(&line).ok().and_then(|v|v["port"].as_u64()).filter(|v|*v<=65535&&*v>1024).ok_or("后台没有返回有效连接")? as u16;
            running.port=port;Ok(running)
        }
    }
    async fn request(running:&Running,action:Option<&str>,input:Option<Value>)->Result<ClawStatus,String>{
        let client=reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(if action.is_some(){55}else{3})).build().map_err(|_|"连接客户端不可用")?;
        let url=format!("http://127.0.0.1:{}/{}",running.port,if action.is_some(){"action"}else{"status"});
        let request=if let Some(action)=action{client.post(url).json(&json!({"action":action,"input":input}))}else{client.get(url)};
        let response=request.bearer_auth(&running.token).send().await.map_err(|_|"书记后台没有响应，请重新连接")?;
        if !response.status().is_success(){return Err("操作没有完成，请检查连接状态后重试".into());}
        response.json().await.map_err(|_|"书记返回状态不可用".into())
    }
    async fn launch(app:AppHandle,pool:SqlitePool,runtime:Arc<ClawRuntime>,prepare:bool,cancel:tokio::sync::oneshot::Receiver<()>,done:tokio::sync::watch::Sender<bool>){
        let result=super::until_cancelled(async{
            let input=private_input(app.clone(),&pool).await?;
            *runtime.snapshot.lock().unwrap()=ClawStatus{phase:"preparing".into(),progress:Some(20),message:"正在准备兼容运行环境…".into(),..Default::default()};
            let mut guard=runtime.running.lock().await;
            if guard.as_mut().is_some_and(|r|r.child.try_wait().ok().flatten().is_some()){guard.take();}
            if guard.is_none(){*guard=Some(spawn_host(&app,input.clone()).await?);}
            let status=request(guard.as_ref().unwrap(),Some(if prepare{"prepare"}else{"start"}),Some(input)).await?;
            sqlx::query("INSERT INTO settings(key,value) VALUES('claw_managed_enabled','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value").execute(&pool).await.map_err(|_|"无法保存书记启动偏好")?;
            Ok::<_,String>(status)
        },cancel).await;
        if result.is_none() {runtime.running.lock().await.take();}
        if !runtime.cancelling.load(std::sync::atomic::Ordering::Acquire){
            *runtime.snapshot.lock().unwrap()=match result{Some(Ok(s))=>s,Some(Err(e))=>ClawStatus{phase:"error".into(),message:"准备没有完成".into(),error:Some(e),..Default::default()},None=>ClawStatus{phase:"cancelled".into(),message:"配置已取消，可重新开始".into(),..Default::default()}};
        }
        runtime.pending.lock().unwrap().take();
        runtime.preparing.store(false,std::sync::atomic::Ordering::Release);
        let _=done.send(true);
    }
    fn begin(app:AppHandle,pool:SqlitePool,runtime:Arc<ClawRuntime>,prepare:bool)->ClawStatus{
        let mut pending=runtime.pending.lock().unwrap();
        if runtime.cancelling.load(std::sync::atomic::Ordering::Acquire)||runtime.preparing.swap(true,std::sync::atomic::Ordering::AcqRel){return runtime.snapshot.lock().unwrap().clone();}
        let (send,receive)=tokio::sync::oneshot::channel();let(done,finished)=tokio::sync::watch::channel(false);
        *pending=Some(Pending{cancel:Some(send),done:finished});
        let status=ClawStatus{phase:"preparing".into(),progress:Some(8),message:"正在读取 AI 配置并准备任务连接…".into(),..Default::default()};
        *runtime.snapshot.lock().unwrap()=status.clone();
        drop(pending);
        tauri::async_runtime::spawn(launch(app,pool,runtime,prepare,receive,done));status
    }
    #[tauri::command]
    pub async fn claw_status(window:WebviewWindow,state:State<'_,Arc<ClawRuntime>>)->Result<ClawStatus,String>{
        main_only(&window)?;
        if state.cancelling.load(std::sync::atomic::Ordering::Acquire)||state.preparing.load(std::sync::atomic::Ordering::Acquire){return Ok(state.snapshot.lock().unwrap().clone());}
        if let Ok(mut guard)=state.running.try_lock(){if let Some(running)=guard.as_mut(){
            if running.child.try_wait().map_err(|_|"无法读取后台状态")?.is_some(){guard.take();*state.snapshot.lock().unwrap()=ClawStatus{phase:"stopped".into(),message:"书记后台已停止，可重新连接".into(),..Default::default()};}
            else{let result=request(running,None,None).await;if !state.cancelling.load(std::sync::atomic::Ordering::Acquire)&&!state.preparing.load(std::sync::atomic::Ordering::Acquire){match result{Ok(s)=>*state.snapshot.lock().unwrap()=s,Err(e)=>{let mut s=state.snapshot.lock().unwrap();s.error=Some(e);s.mcp_connected=false;s.qq_connected=false;}}}}
        }}
        Ok(state.snapshot.lock().unwrap().clone())
    }
    #[tauri::command]
    pub async fn claw_action(window:WebviewWindow,app:AppHandle,pool:State<'_,SqlitePool>,state:State<'_,Arc<ClawRuntime>>,action:String)->Result<ClawStatus,String>{
        main_only(&window)?;
        if action=="cancel" {
            let finished={let mut pending=state.pending.lock().unwrap();
                if state.cancelling.swap(true,std::sync::atomic::Ordering::AcqRel){return Ok(state.snapshot.lock().unwrap().clone());}
                {let mut s=state.snapshot.lock().unwrap();s.phase="cancelling".into();s.message="正在停止本次配置…".into();}
                pending.as_mut().map(|p|{if let Some(send)=p.cancel.take(){let _=send.send(());}p.done.clone()})};
            if let Some(mut done)=finished{while !*done.borrow(){if done.changed().await.is_err(){break;}}}
            state.running.lock().await.take();
            let saved=sqlx::query("UPDATE settings SET value='false' WHERE key='claw_managed_enabled'").execute(pool.inner()).await;
            let status=ClawStatus{phase:"cancelled".into(),message:"配置已取消，已下载内容会保留，可重新开始".into(),error:saved.err().map(|_|"配置已停止，但自动启动偏好未保存，请重试取消".into()),..Default::default()};
            *state.snapshot.lock().unwrap()=status.clone();state.cancelling.store(false,std::sync::atomic::Ordering::Release);return Ok(status);
        }
        if matches!(action.as_str(),"prepare"|"start"){
            return Ok(begin(app,pool.inner().clone(),state.inner().clone(),action=="prepare"));
        }
        if !matches!(action.as_str(),"stop"|"qr"|"cancelQr"|"check"){return Err("未知书记操作".into());}
        let guard=state.running.lock().await;let running=guard.as_ref().ok_or("请先连接书记")?;
        let status=request(running,Some(&action),None).await?;*state.snapshot.lock().unwrap()=status.clone();
        if action=="stop"{sqlx::query("UPDATE settings SET value='false' WHERE key='claw_managed_enabled'").execute(pool.inner()).await.map_err(|e|e.to_string())?;}
        Ok(status)
    }
    pub fn restore(app:AppHandle,pool:SqlitePool,runtime:Arc<ClawRuntime>){
        tauri::async_runtime::spawn(async move{
            let enabled:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='claw_managed_enabled'").fetch_optional(&pool).await.unwrap_or(None);
            if enabled.as_deref()!=Some("true"){return;}
            begin(app,pool,runtime,false);
        });
    }
    pub fn shutdown(runtime:&ClawRuntime){if let Some(p)=runtime.pending.lock().unwrap().as_mut(){if let Some(send)=p.cancel.take(){let _=send.send(());}}if let Ok(mut guard)=runtime.running.try_lock(){guard.take();}}
}
#[cfg(not(test))]
pub use native::*;
#[cfg(all(test,windows))]
mod cancellation_tests {
    use super::until_cancelled;
    #[tokio::test]
    async fn cancellation_drops_inflight_process_and_allows_retry() {
        // Exercise a real owned OS process, as used by runtime bootstrap.
        let mut command=tokio::process::Command::new("powershell.exe");
        command.args(["-NoProfile","-NonInteractive","-Command","Start-Sleep -Seconds 30"]).kill_on_drop(true);
        #[cfg(windows)] command.creation_flags(0x08000000);
        let child=command.spawn().unwrap();let pid=child.id().unwrap();
        let (send,receive)=tokio::sync::oneshot::channel();
        let pending=tokio::spawn(until_cancelled(async move {let mut child=child;child.wait().await},receive));
        tokio::task::yield_now().await;send.send(()).unwrap();
        assert!(pending.await.unwrap().is_none());
        let output=tokio::process::Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-Command",&format!("if(Get-Process -Id {pid} -ErrorAction SilentlyContinue){{exit 1}}")]).output().await.unwrap();
        assert!(output.status.success(),"cancelled preparation process must be gone");
        let (_send,receive)=tokio::sync::oneshot::channel();
        assert_eq!(until_cancelled(async{42},receive).await,Some(42),"retry can complete normally");
    }
}
