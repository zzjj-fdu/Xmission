//! Task tools share the UI's transactional business operations.
use chrono::Local;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use crate::{gamification, models::{CreateTaskInput, TaskFilter, UpdateTaskPatch}, steps, task_engine};

fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object", "properties":properties, "required":required, "additionalProperties":false})
}
fn text(nullable: bool) -> Value {
    if nullable { json!({"type":["string","null"], "maxLength":16000}) }
    else { json!({"type":"string", "minLength":1, "maxLength":400}) }
}
fn minutes(nullable: bool) -> Value {
    json!({"type":if nullable { json!(["integer","null"]) } else { json!("integer") },"minimum":0,"maximum":525600})
}
fn task_properties(patch: bool) -> Value {
    let mut p = json!({
        "title":text(false),"notes":text(true),
        "importance":{"type":"integer","minimum":1,"maximum":5},
        "urgency":{"type":"integer","minimum":1,"maximum":5},
        "deadline":{"type":["string","null"],"description":"YYYY-MM-DD or ISO 8601 date-time. Resolve relative dates using xmission_get_context."},
        "estimatedMin":minutes(true),
        "recurrence":{"type":"string","enum":["none","daily","weekly"]},
        "recurDays":{"type":["string","null"],"description":"Weekly weekdays as comma-separated 1..7; Monday=1."},
        "icon":{"type":"string","description":"Optional existing semantic icon key; omit to use the theme default."}
    });
    if patch {
        p["status"] = json!({"type":"string","enum":["open","doing","overdue","shelved"],"description":"Use complete/reopen tools for completion and rewards."});
        p["plannedDate"] = json!({"type":["string","null"],"description":"YYYY-MM-DD; null clears the plan."});
    } else {
        p["form"] = json!({"type":"string","enum":["encounter","side_quest","main_quest"],"default":"encounter"});
        p["parentId"] = json!({"type":["string","null"],"description":"Optional parent main_quest ID for a child task. For checklist subtasks use step tools."});
    }
    p
}

pub(crate) fn catalog() -> Vec<Value> {
    let step = json!({"title":text(false),"deadline":text(true),"estimatedMin":minutes(true)});
    let id = json!({"id":text(false)});
    let specs = vec![
        ("xmission_get_context", "读取本地当前日期时间、钱包、今日课表和当前最大空档。先调用它解析这周五、明天等相对时间。", object(json!({}), &[]), false, false),
        ("xmission_list_tasks", "列出任务。可按状态/形态筛选，支持标题或备注关键词。返回真实 ID、父任务关系和今日打卡状态。", object(json!({"status":{"type":"string","enum":["open","doing","done","overdue","shelved"]},"form":{"type":"string","enum":["encounter","side_quest","main_quest"]},"query":text(false)}), &[]), false, false),
        ("xmission_get_task", "读取一个任务及完整步骤树。先确认真实 ID，勿猜测或重复创建。", object(id.clone(), &["id"]), false, false),
        ("xmission_create_task", "直接创建任务，可同时生成完整子步骤树；立即保存并同步界面，无须再到 Xmission 确认。form 默认 encounter，大目标用 main_quest。steps 按先父后子排列，parentIndex 是前面父步骤的数组索引。", object(json!({"input":object(task_properties(false), &["title"]),"steps":{"type":"array","maxItems":100,"items":object({let mut p=step.clone();p["parentIndex"]=json!({"type":"integer","minimum":0});p}, &["title"])}}), &["input"]), true, false),
        ("xmission_update_task", "直接编辑任务的标题、备注、时间、优先级、循环和计划日。只改变 patch 中出现的字段，null 清空可空字段。完成请用 complete 工具。", object(json!({"id":text(false),"patch":object(task_properties(true), &[])}), &["id","patch"]), true, false),
        ("xmission_complete_task", "直接完成任务并自动结算金币与经验；循环任务为今日打卡。同日重复完成不会重复发奖。", object(id.clone(), &["id"]), true, false),
        ("xmission_reopen_task", "撤销完成并回收本次金币和经验；循环任务只撤销今天的打卡。", object(id.clone(), &["id"]), true, false),
        ("xmission_delete_task", "直接删除指定任务及其全部步骤；其子任务保留并解除父任务关系。既有完成奖励保留，与界面删除一致。", object(id.clone(), &["id"]), true, true),
        ("xmission_add_step", "在任务下直接增加子步骤。parentStepId 可指定同一任务的父步骤，支持多层拆分。", object({let mut p=step.clone();p["taskId"]=text(false);p["parentStepId"]=text(true);p}, &["taskId","title"]), true, false),
        ("xmission_update_step", "直接修改子步骤标题、截止时间和估时；null 可以清空时间或估时。", object(json!({"id":text(false),"patch":object(step, &[])}), &["id","patch"]), true, false),
        ("xmission_complete_step", "直接完成一个子步骤，按现有规则结算奖励。不会自动完成父任务。", object(id.clone(), &["id"]), true, false),
        ("xmission_reopen_step", "撤销子步骤完成并回收它的奖励。", object(id.clone(), &["id"]), true, false),
        ("xmission_delete_step", "直接删除指定子步骤及全部后代步骤，保留其他步骤。", object(id.clone(), &["id"]), true, true),
        ("xmission_list_preparations", "查看主程序中已经授权的准备约定和真实结果。准备不完成人的任务、不发放奖励。新文件范围必须在原任务的准备设置中授权。", object(json!({"taskId":text(false)}), &[]), false, false),
        ("xmission_pause_preparation", "暂停或恢复指定准备约定。暂停立即阻止旧执行提交结果。已授权范围保持原样。", object(json!({"id":text(false),"paused":{"type":"boolean"}}), &["id","paused"]), true, false),
        ("xmission_retry_preparation", "重试当前失败的准备，沿用执行编号，不覆盖原稿。旧版本、过期安排和暂停规则不能重试。", object(id, &["id"]), true, false),
        ("xmission_prepare_due", "检查已在主程序授权的到期准备，每次最多处理一项。可由外部 Claw 定时调用，在主程序退出后运行本机模板；不增加授权范围、不启动音乐、不打开前台文件。结果如实列出 ready/failed/skipped。", object(json!({}), &[]), true, false),
    ];
    specs.into_iter().map(|(name,description,mut schema,write,destructive)| {
        if write {
            schema["properties"]["requestId"] = json!({"type":"string","minLength":1,"maxLength":128,"description":"Unique UUID per intended mutation. Reuse the SAME ID and SAME arguments for a retry; use a NEW ID for a new action, even on the same task. Durable across app restarts."});
            schema["required"].as_array_mut().unwrap().push(json!("requestId"));
        }
        json!({"name":name,"description":description,"inputSchema":schema,
            "annotations":{"readOnlyHint":!write,"destructiveHint":destructive,"idempotentHint":true,"openWorldHint":name=="xmission_prepare_due"}})
    }).collect()
}

/// Small validator for the exact schema vocabulary used above. Reject extra fields
/// rather than silently ignoring a model's mistaken field name.
fn validate(value: &Value, schema: &Value, path: &str) -> Result<(), String> {
    let matches = |kind: &str| match kind {
        "object"=>value.is_object(),"array"=>value.is_array(),"string"=>value.is_string(),
        "integer"=>value.as_i64().is_some(),"boolean"=>value.is_boolean(),"null"=>value.is_null(),_=>false,
    };
    let valid_type = match &schema["type"] {
        Value::String(t)=>matches(t),Value::Array(ts)=>ts.iter().any(|t| matches(t.as_str().unwrap_or(""))),_=>true,
    };
    if !valid_type { return Err(format!("{path} 的类型不正确")); }
    if let Some(options)=schema["enum"].as_array() {
        if !options.contains(value) { return Err(format!("{path} 不在允许的选项内")); }
    }
    if let Some(s)=value.as_str() {
        let len=s.chars().count() as u64;
        if len<schema["minLength"].as_u64().unwrap_or(0) || len>schema["maxLength"].as_u64().unwrap_or(16000) { return Err(format!("{path} 文本长度不正确")); }
    }
    if let Some(n)=value.as_i64() {
        if n<schema["minimum"].as_i64().unwrap_or(i64::MIN) || n>schema["maximum"].as_i64().unwrap_or(i64::MAX) { return Err(format!("{path} 数值超出范围")); }
    }
    if let Some(obj)=value.as_object() {
        if let Some(required)=schema["required"].as_array() {
            for field in required {
                let key=field.as_str().unwrap();
                if !obj.contains_key(key) { return Err(format!("{path}.{key} 是必填项")); }
            }
        }
        for (key,item) in obj {
            let spec=&schema["properties"][key];
            if spec.is_null() { return Err(format!("{path}.{key} 是未知字段")); }
            validate(item,spec,&format!("{path}.{key}"))?;
        }
    }
    if let Some(items)=value.as_array() {
        if items.len() as u64>schema["maxItems"].as_u64().unwrap_or(100) { return Err(format!("{path} 项数过多")); }
        for (i,item) in items.iter().enumerate() { validate(item,&schema["items"],&format!("{path}[{i}]"))?; }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) async fn call(pool: &SqlitePool, name: &str, args: Value) -> Result<Value, String> {
    call_inner(pool, name, args, false).await
}

pub(crate) async fn call_enabled(pool: &SqlitePool, name: &str, args: Value) -> Result<Value, String> {
    call_inner(pool, name, args, true).await
}

pub(crate) async fn require_enabled<'a>(executor: impl sqlx::Executor<'a, Database = sqlx::Sqlite>) -> Result<(), String> {
    let enabled: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'agent_enabled'")
        .fetch_optional(executor).await.map_err(|e| e.to_string())?;
    if enabled.as_deref() != Some("true") {return Err("任务接管已关闭，请在 Xmission 设置中开启接管".into());}
    Ok(())
}

async fn call_inner(pool: &SqlitePool, name: &str, args: Value, require_permission: bool) -> Result<Value, String> {
    let spec=catalog().into_iter().find(|t| t["name"]==name).ok_or_else(|| format!("未知工具：{name}"))?;
    validate(&args,&spec["inputSchema"],"arguments")?;
    if name=="xmission_prepare_due" {return prepare_due(pool,args,require_permission).await;}
    let id=args["id"].as_str().unwrap_or("");
    if spec["annotations"]["readOnlyHint"]==true {
        if require_permission { require_enabled(pool).await?; }
        return match name {
            "xmission_list_tasks"=>{
                let filter: TaskFilter=serde_json::from_value(json!({"status":args["status"],"form":args["form"]})).map_err(|e| e.to_string())?;
                let mut tasks=task_engine::list_tasks_db(pool,filter).await?;
                if let Some(query)=args["query"].as_str() {
                    let query=query.to_lowercase();
                    tasks.retain(|t| t.title.to_lowercase().contains(&query) || t.notes.as_deref().unwrap_or("").to_lowercase().contains(&query));
                }
                Ok(json!({"tasks":tasks}))
            },
            "xmission_get_task"=>Ok(json!({"task":task_engine::fetch_task(pool,id).await?,"steps":steps::list_steps_db(pool,id).await?,"preparation":crate::preparation::list_db(pool,Some(id)).await?})),
            "xmission_list_preparations"=>crate::preparation::list_db(pool,args["taskId"].as_str()).await,
            "xmission_get_context"=>{
                let now=Local::now();
                Ok(json!({"now":now.to_rfc3339(),"taskDate":gamification::task_day(now).to_string(),
                    "taskDayStartsAt":"04:00","wallet":gamification::build_wallet(pool).await?,
                    "coursesToday":crate::course::courses_on_date(pool,now.date_naive()).await?,
                    "largestFreeGapMinutes":crate::scheduler::today_free_gap_min(pool,now).await?}))
            },_=>unreachable!(),
        };
    }
    let request_id=args["requestId"].as_str().unwrap();
    if request_id.trim().is_empty() { return Err("requestId 不能为空".into()); }
    let arguments=serde_json::to_string(&args).map_err(|e| e.to_string())?;
    let mut tx=gamification::begin_write(pool).await?;
    // Recheck inside the write transaction so a queued one-shot cannot write
    // using stale permission after the UI has committed disabling takeover.
    if require_permission { require_enabled(&mut *tx).await?; }
    let prior: Option<(String,String,String)>=sqlx::query_as("SELECT tool, arguments_json, result_json FROM agent_requests WHERE request_id = ?")
        .bind(request_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
    if let Some((tool,stored,result))=prior {
        if tool!=name || serde_json::from_str::<Value>(&stored).map_err(|e|e.to_string())?!=args {
            return Err("requestId 已被另一项操作使用；重试必须保持工具名和参数完全相同".into());
        }
        return serde_json::from_str(&result).map_err(|e| e.to_string());
    }
    let result=match name {
        "xmission_pause_preparation"=>crate::preparation::pause_tx(&mut tx,id,args["paused"].as_bool().unwrap()).await?,
        "xmission_retry_preparation"=>crate::preparation::retry_tx(&mut tx,id).await?,
        "xmission_create_task"=>{
            let mut input=args["input"].clone();
            if input.get("form").is_none() { input["form"]=json!("encounter"); }
            let input: CreateTaskInput=serde_json::from_value(input).map_err(|e|e.to_string())?;
            let task=task_engine::create_task_tx(&mut tx,input).await?;
            let mut tree: Vec<crate::models::Step>=Vec::new();
            if let Some(drafts)=args["steps"].as_array() {
                for (index,draft) in drafts.iter().enumerate() {
                    let parent=if let Some(i)=draft["parentIndex"].as_u64() {
                        if i as usize>=index { return Err("parentIndex 必须指向当前步骤之前的父步骤".into()); }
                        Some(tree[i as usize].id.clone())
                    } else { None };
                    tree.push(steps::add_step_tx(&mut tx,task.id.clone(),draft["title"].as_str().unwrap().to_owned(),parent,
                        draft["deadline"].as_str().map(str::to_owned),draft["estimatedMin"].as_i64()).await?);
                }
            }
            json!({"task":task,"steps":tree})
        },
        "xmission_update_task"=>{
            let patch: UpdateTaskPatch=serde_json::from_value(args["patch"].clone()).map_err(|e|e.to_string())?;
            json!({"task":task_engine::update_task_tx(&mut tx,id,patch).await?})
        },
        "xmission_complete_task"=>{ let (task,wallet)=task_engine::complete_task_tx(&mut tx,id).await?; json!({"task":task,"wallet":wallet}) },
        "xmission_reopen_task"=>{ let (task,wallet)=task_engine::reopen_task_tx(&mut tx,id).await?; json!({"task":task,"wallet":wallet}) },
        "xmission_delete_task"=>{ task_engine::delete_task_tx(&mut tx,id).await?; json!({"deletedTaskId":id}) },
        "xmission_add_step"=>json!({"step":steps::add_step_tx(&mut tx,args["taskId"].as_str().unwrap().into(),args["title"].as_str().unwrap().into(),
            args["parentStepId"].as_str().map(str::to_owned),args["deadline"].as_str().map(str::to_owned),args["estimatedMin"].as_i64()).await?}),
        "xmission_update_step"=>{
            let p=&args["patch"];
            json!({"step":steps::update_step_tx(&mut tx,id,p["title"].as_str().map(str::to_owned),
                p.get("deadline").map(|v|v.as_str().map(str::to_owned)),p.get("estimatedMin").map(Value::as_i64)).await?})
        },
        "xmission_complete_step" | "xmission_reopen_step"=>{
            let (step,wallet)=steps::set_step_completed_tx(&mut tx,id,name=="xmission_complete_step").await?; json!({"step":step,"wallet":wallet})
        },
        "xmission_delete_step"=>{steps::delete_step_tx(&mut tx,id).await?;json!({"deletedStepId":id})},
        _=>unreachable!(),
    };
    crate::companion_feedback::agent(&mut tx,request_id,name,&result,&args).await?;
    sqlx::query("INSERT INTO agent_requests (request_id, tool, arguments_json, result_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(request_id).bind(name).bind(arguments).bind(result.to_string()).bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(result)
}

async fn prepare_due(pool:&SqlitePool,args:Value,require_permission:bool)->Result<Value,String> {
    let id=args["requestId"].as_str().ok_or("请提供操作编号")?;
    if id.trim().is_empty() {return Err("操作编号不能为空".into());}
    let mut tx=gamification::begin_write(pool).await?;
    if require_permission {require_enabled(&mut *tx).await?;}
    let prior:Option<(String,String,String)>=sqlx::query_as("SELECT tool,arguments_json,result_json FROM agent_requests WHERE request_id=?").bind(id).fetch_optional(&mut *tx).await.map_err(|e|e.to_string())?;
    if let Some((name,saved,result))=prior {
        if name!="xmission_prepare_due"||serde_json::from_str::<Value>(&saved).map_err(|e|e.to_string())?!=args {return Err("操作编号已被其他操作使用".into());}
        let result:Value=serde_json::from_str(&result).map_err(|e|e.to_string())?;
        return if let Some(error)=result["error"].as_str() {Err(error.into())}else{Ok(result)};
    }
    // A durable reservation prevents two clients retrying the same request from
    // claiming two distinct jobs. If the process dies, the run lease recovers;
    // subsequent scheduled checks use a fresh request id.
    sqlx::query("INSERT INTO agent_requests(request_id,tool,arguments_json,result_json,created_at)VALUES(?,'xmission_prepare_due',?,'{\"status\":\"running\",\"note\":\"查看准备记录；重复请求不会启动第二项工作\"}',?)")
        .bind(id).bind(args.to_string()).bind(chrono::Utc::now().to_rfc3339()).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;
    let checked=crate::preparation::tick(pool).await;
    let result=match &checked {
        Ok(processed)=>json!({"status":"checked","processed":processed.as_ref().map(|(task,ready,_)|json!({"taskId":task,"prepared":ready})),"preparation":crate::preparation::list_db(pool,None).await?}),
        Err(error)=>json!({"status":"failed","error":error}),
    };
    sqlx::query("UPDATE agent_requests SET result_json=? WHERE request_id=? AND tool='xmission_prepare_due'").bind(result.to_string()).bind(id).execute(pool).await.map_err(|e|e.to_string())?;
    checked.map(|_|result)
}
