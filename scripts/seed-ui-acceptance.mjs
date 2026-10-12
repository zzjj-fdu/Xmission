// Isolated desktop acceptance data. Never opens an existing database.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const target = path.resolve(process.argv[2] ?? '.acceptance-data');
const theme = process.argv[3] ?? 'pixel-jrpg';
if (!['pixel-jrpg','parchment-journal','animal-crossing','stardew-valley'].includes(theme)) throw new Error('Unknown theme');
fs.mkdirSync(target, { recursive: true });
const file = path.join(target, 'xmission.db');
if (fs.existsSync(file)) throw new Error('Refusing to replace an existing acceptance database');
const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _sqlx_migrations(version BIGINT PRIMARY KEY,description TEXT NOT NULL,installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,success BOOLEAN NOT NULL,checksum BLOB NOT NULL,execution_time BIGINT NOT NULL);');
for (const name of fs.readdirSync('src-tauri/migrations').filter(n => n.endsWith('.sql')).sort()) {
  const bytes = fs.readFileSync(path.join('src-tauri/migrations', name));
  db.exec(bytes.toString('utf8'));
  const [version, ...parts] = name.replace(/\.sql$/, '').split('_');
  db.prepare('INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time)VALUES(?,?,1,?,0)').run(Number(version), parts.join(' '), crypto.createHash('sha384').update(bytes).digest());
}
const now = new Date(), day = new Date(now.getTime() - 4 * 3600000);
const date = (offset = 0) => { const d = new Date(day); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const insert = db.prepare('INSERT INTO tasks(id,title,form,importance,urgency,deadline,estimated_min,created_at,planned_date,status,completed_at)VALUES(?,?,?,?,?,?,?,?,?,?,?)');
insert.run('goal-demo','完成一份可以审阅的研究报告：从阅读资料到第一版正文','main_quest',5,3,date(5),120,date(-5),null,'open',null);
insert.run('ordinary-demo','下午去取快递，顺便补充笔记本','encounter',3,4,date(0),30,date(-1),date(0),'open',null);
insert.run('later-demo','每周整理一次桌面资料和归档，保留自己的原始文稿','encounter',3,2,date(7),45,date(-3),null,'open',null);
insert.run('completed-demo','已经完成的读书笔记','encounter',4,3,date(-1),40,date(-3),null,'done',now.toISOString());
const step = db.prepare('INSERT INTO task_steps(id,task_id,parent_step_id,title,order_index,deadline,estimated_min,status,completed_at)VALUES(?,?,?,?,?,?,?,?,?)');
step.run('stage-read','goal-demo',null,'资料阅读与问题整理',0,date(-1),30,'done',now.toISOString());
step.run('read-leaf','goal-demo','stage-read','提取核心论点，核对来源',0,date(-1),30,'done',now.toISOString());
step.run('stage-draft','goal-demo',null,'写出第一版正文',1,date(2),60,'open',null);
step.run('draft-leaf','goal-demo','stage-draft','写第一节：用清楚的语言解释问题、已有材料与需要核验的结论',0,date(1),45,'open',null);
db.prepare('INSERT INTO goal_preferences(task_id,focused,manual_order)VALUES(?,1,0)').run('goal-demo');
const setting = db.prepare('INSERT INTO settings(key,value)VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
for (const [key,value] of Object.entries({theme,agent_enabled:'false',preparation_paused:'true',companion_preferences:JSON.stringify({enabled:false,desktopEnabled:false,proactive:false,reminders:false}),onboarding_state:JSON.stringify({step:5,complete:true}),daily_capacity_min:'180'})) setting.run(key,value);
db.close();
console.log(`Prepared isolated acceptance data: ${target}`);
