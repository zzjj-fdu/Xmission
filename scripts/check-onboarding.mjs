import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const moduleUrl = async path => {
  let code=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  if(code.includes("'./journeyFrames'"))code=code.replace("'./journeyFrames'",JSON.stringify(await moduleUrl('src/onboarding/journeyFrames.ts')));
  return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
};
const load = async path => import(await moduleUrl(path));
try {
  const m = await load('src/onboarding/model.ts');
  assert.equal(m.shouldOpen({}), false, 'existing databases never automatically replay');
  assert.equal(m.shouldOpen({ first_experience_eligible: 'true' }), true);
  assert.equal(m.shouldOpen({ first_experience_eligible: 'true', first_experience_v2: JSON.stringify({ version: 2, stage: 'done' }) }), false);
  assert.equal(m.readProgress('{broken').stage, 'arrival');
  assert.equal(m.readProgress(JSON.stringify({ version: 2, stage: 'qq', taskId: 'real-task' })).taskId, 'real-task');
  assert.equal(m.readProgress(JSON.stringify({ version: 1, stage: 'done' })).stage, 'arrival');
  assert.equal(m.readProgress(JSON.stringify({ version: 2, stage: 'tutorial', tutorial: 5 })).tutorial,0,'corrupt lesson index is recoverable');
  assert.equal(m.nextStage('atlas'), 'api');
  assert.equal(m.nextStage('qq'), 'journey', 'configuration leads into the approved picture journey');
  assert.equal(m.nextStage('journey'), 'task', 'journey returns to first real task');
  assert.equal(m.readProgress(JSON.stringify({version:2,stage:'journey',journeyFrame:15})).journeyFrame,15,'resume the saved image frame');
  assert.equal(m.readProgress(JSON.stringify({version:2,stage:'journey',journeyFrame:999})).journeyFrame,0,'corrupt frame resets safely');
  assert.equal(m.nextStage('tutorial'), 'done');
  const w = await load('src/onboarding/world.ts');
  assert.equal(w.chapters.length, 4);
  assert.ok(w.lands.length >= 12);
  assert.equal(new Set(w.chapters.map(c => c.land)).size, 4);
  const running = m.createOnce(); let calls = 0;
  const create = () => new Promise(resolve => setTimeout(() => { calls++; resolve({ id: 'saved' }); }, 15));
  const [a,b] = await Promise.all([running(create), running(create)]);
  assert.equal(a.id, b.id); assert.equal(calls, 1, 'double click creates only one real task');
  let attempts = 0; const retry = m.createOnce();
  await assert.rejects(retry(async () => { attempts++; throw Error('disk full'); }));
  await retry(async () => { attempts++; return { id: 'recovered' }; });
  assert.equal(attempts, 2, 'failure must permit retry');
  console.log('Onboarding eligibility, resume, map, and creation guards passed.');
} finally { /* No app or user database is touched. */ }
