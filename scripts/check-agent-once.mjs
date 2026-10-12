// Native one-shot process checks against a throwaway DB; never the user's DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';

const executable = path.resolve(process.argv[2] ?? 'src-tauri/target/debug/xmission.exe');
const tempRoot = path.resolve(os.tmpdir());
const directory = fs.mkdtempSync(path.join(tempRoot, 'xmission-agent-once-'));
assert.equal(path.dirname(path.resolve(directory)), tempRoot);
assert.ok(path.basename(directory).startsWith('xmission-agent-once-'));
const requestFile = path.join(directory, 'request.json');
const env = { ...process.env, XMISSION_DATA_DIR: directory };
const launch = (args, input) => {
  const child = spawnSync(executable, args, { env, input, encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024 });
  assert.ifError(child.error);
  assert.equal(child.signal, null, 'child should return and exit normally');
  assert.notEqual(child.status, null, 'process must terminate after its result');
  const output = JSON.parse(child.stdout.trim());
  assert.equal(child.status, output.isError ? 1 : 0);
  return output;
};
const call = (name, args = {}, stdin = false) => {
  const request = JSON.stringify({ name, arguments: args });
  if (stdin) return launch(['--agent-call'], request);
  fs.writeFileSync(requestFile, `\uFEFF${request}`, 'utf8');
  return launch(['--agent-call', requestFile]);
};

let database;
try {
  const catalog = launch(['--agent-catalog']);
  assert.equal(catalog.result.tools.length, 17);
  assert.equal(fs.existsSync(path.join(directory, 'xmission.db')), false);
  const missing = call('xmission_get_context', {}, true);
  assert.equal(missing.isError, true);
  assert.match(missing.error, /先打开/);
  assert.equal(fs.existsSync(path.join(directory, 'xmission.db')), false);
  assert.equal(launch(['--agent-typo']).isError, true);

  database = new DatabaseSync(path.join(directory, 'xmission.db'));
  for (const filename of fs.readdirSync('src-tauri/migrations').filter(n => n.endsWith('.sql')).sort()) {
    database.exec(fs.readFileSync(path.join('src-tauri/migrations', filename), 'utf8'));
  }
  assert.equal(call('xmission_list_tasks').isError, true, 'disabled access must fail');
  // Reserve a random test port instead of forwarding into the user's UI server.
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const testPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  database.prepare("INSERT INTO settings(key,value) VALUES('agent_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  database.prepare("INSERT INTO settings(key,value) VALUES('agent_port',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(testPort));

  const context = call('xmission_get_context');
  if (context.isError) {
    assert.match(context.error, /密钥/, 'unexpected failure must not be treated as unavailable credentials');
    console.log('PASS: native catalog, stdin/file Unicode framing, disabled/missing-data errors, each process exits; positive calls unavailable until takeover credentials are configured');
  } else {
    const args = { requestId: randomUUID(), input: { title: '隔离后台任务', form: 'main_quest' }, steps: [{ title: '后台步骤' }] };
    const created = call('xmission_create_task', args).result;
    assert.equal(created.task.title, args.input.title);
    assert.deepEqual(call('xmission_create_task', args, true).result, created);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 1);
    const completedArgs = { requestId: randomUUID(), id: created.task.id };
    assert.equal(call('xmission_complete_task', completedArgs).result.task.status, 'done');
    assert.equal(call('xmission_reopen_task', { requestId: randomUUID(), id: created.task.id }).result.task.status, 'open');
    call('xmission_complete_task', completedArgs);
    const current = call('xmission_get_task', { id: created.task.id }).result;
    assert.equal(current.task.status, 'open');
    assert.equal(current.steps.length, 1);
    assert.equal(call('xmission_get_context').result.wallet.xpTotal, 0);
    // Model the explicit grant that the task UI creates. Execute the real
    // native preparation tool against this isolated directory/DB only.
    const ruleId = randomUUID(), stamp = new Date().toISOString();
    const config = { topic: '隔离写作准备', outputRoot: directory, sources: [], search: false, referenceLimit: 8, focusMin: 25, sound: 'none', openSources: false, notify: false };
    database.prepare('INSERT INTO preparation_rules(id,task_id,kind,config_json,start_at,lead_min,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?)')
      .run(ruleId, created.task.id, 'writing', JSON.stringify(config), new Date(Date.now() + 30 * 60000).toISOString(), 60, stamp, stamp);
    const prepareArgs = { requestId: randomUUID() };
    const prepared = call('xmission_prepare_due', prepareArgs).result;
    assert.equal(prepared.processed.prepared, true);
    assert.deepEqual(call('xmission_prepare_due', prepareArgs).result, prepared);
    const run = database.prepare("SELECT * FROM preparation_runs WHERE state='ready'").get();
    assert.ok(fs.existsSync(path.join(run.output_dir, 'START-HERE.md')));
    assert.ok(fs.existsSync(path.join(run.output_dir, 'references/index.md')));
    assert.equal(call('xmission_get_context').result.wallet.xpTotal, 0);
    database.prepare("UPDATE settings SET value='false' WHERE key='agent_enabled'").run();
    assert.equal(call('xmission_delete_task', { requestId: randomUUID(), id: created.task.id }).isError, true);
    assert.equal(fs.existsSync(path.join(directory, 'xmission.db.bak')), false);
    console.log('PASS: native closed-UI tasks/steps and real preparation files, retry/reopen invariants, permission revocation, no GUI backup side effects, each child emits JSON then exits');
  }
} finally {
  database?.close();
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
