// Exercise the real React components with isolated IPC fixtures, never user data.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import React, { act } from 'react';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Event', 'CustomEvent', 'Image', 'localStorage']) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.matchMedia = globalThis.matchMedia;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const callbacks = new Map(), listeners = new Map(), calls = [], settings = new Map();
dom.window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { listeners.delete(id); } };
let counter = 0;
const task = { id: 'task-one', title: '准备写论文', status: 'open', form: 'encounter', notes: null, importance: 3, urgency: 3, deadline: null, estimatedMin: null, parentId: null, xpValue: 10, recurrence: 'none', recurDays: null, lastDoneDate: null, doneToday: false, plannedDate: null, createdAt: new Date().toISOString() };
let tasks = [task], prep = { rules: [], runs: [], paused: false, boundary: '本机运行边界' }, chapter = null, keepsakes = [];
let goalData = null, deleted = [], plan = null;
dom.window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback(fn) { const id = ++counter; callbacks.set(id, fn); return id; },
  async invoke(name, args = {}) {
    calls.push({ name, args });
    if (name === 'plugin:event|listen') { listeners.set(++counter, args); return counter; }
    if (name === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
    if (name === 'plugin:path|resolve_directory') return 'C:\\Preparation-fixture';
    if (name === 'get_settings') return Object.fromEntries(settings);
    if (name === 'set_setting') { settings.set(args.key, args.value); return; }
    if (name === 'list_tasks') return tasks.map(t => ({ ...t }));
    if (name === 'get_goal_overview') return structuredClone(goalData);
    if (name === 'list_deleted_items') return structuredClone(deleted);
    if (name === 'list_steps') return [];
    if (name === 'set_goal_focus') { goalData.goals[0].focused = args.taskId != null; return; }
    if (name === 'advance_goal_stage') { goalData.goals[0].advanceFrom = null; return; }
    if (name === 'complete_step') { goalData.actions = goalData.actions.filter(a => a.stepId !== args.id); return { id: args.id, status: 'done' }; }
    if (name === 'preview_replan') return structuredClone(plan);
    if (name === 'apply_replan') return;
    if (name === 'reorder_work') return;
    if (name === 'restore_deleted_item') { deleted = deleted.filter(v => v.id !== args.id); return 'task-one'; }
    if (name === 'get_progress_review') return { days: args.days, note: '实际耗时仅统计专注记录', goals: [], trend: [{ date: '2026-10-07', tasks: 1, steps: 2, checkins: 0, focusMin: 20 }], comparisons: [{ id: task.id, title: '未计时完成任务', estimatedMin: 30, actualFocusMin: null, differenceMin: null }] };
    if (name === 'list_preparations') return structuredClone(prep);
    if (name === 'pomodoro_current') return null;
    if (name === 'get_wallet') return { coins: 0, xpTotal: 0, level: 1, xpIntoLevel: 0, xpToNext: 100, streak: 0 };
    if (name === 'get_journey') return { chapter, keepsakes, commissionReady: false };
    if (name === 'save_preparation') {
      const { input } = args;
      const rule = { id: 'rule-one', taskId: input.taskId, kind: input.kind, configJson: JSON.stringify(input.config), startAt: input.startAt, leadMin: input.leadMin, enabled: true, needsAuthorization: false, version: 1 };
      prep.rules = [rule]; return rule;
    }
    if (name === 'pause_preparation') { prep.rules[0].enabled = !args.paused; return; }
    if (name === 'read_preparation_artifact') return '# 从这里开始\n指定材料已经可读\n<script>unsafe</script>';
    if (name === 'complete_task') { tasks[0] = { ...tasks[0], status: 'done' }; return tasks[0]; }
    if (name === 'create_task') { const added = { ...task, ...args.input, id: 'task-' + ++counter }; tasks.push(added); return added; }
    if (name === 'update_task') { tasks = tasks.map(t => t.id === args.id ? { ...t, ...args.patch } : t); return tasks.find(t => t.id === args.id); }
    if (name === 'journey_action') {
      const { input } = args;
      if (input.action === 'start') chapter = { id: 'chapter-one', theme: input.theme, taskId: input.taskId, node: 0, paused: false, bag: null, route: null, discovery: null, gameBest: null };
      if (input.action === 'bag') chapter = { ...chapter, node: 1, bag: input.choice };
      if (input.action === 'route') chapter = { ...chapter, node: 2, route: input.choice, discovery: 'hidden-star' };
      return { chapter };
    }
    throw new Error('Unexpected fixture IPC: ' + name);
  },
};
const server = await createServer({ configFile: './vite.config.ts', configLoader: 'runner', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const root = createRoot(document.getElementById('root'));
const render = async (element) => { await act(async () => { root.render(element); }); };
const click = async text => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text));
  assert.ok(button, 'Button exists: ' + text); assert.equal(button.disabled, false, 'Button enabled: ' + text);
  await act(async () => { button.click(); });
};
const setInput = async (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(element, value); element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
};
try {
  const { TodayFocusTag } = await server.ssrLoadModule('/src/components/TodayFocusTag.tsx');
  await render(React.createElement(TodayFocusTag, { taskId: task.id }));
  const tag = document.querySelector('input[type="checkbox"]');
  assert.ok(tag); assert.equal(tag.checked, false);
  const beforeTag = calls.length;
  await act(async () => tag.click());
  assert.equal(tag.checked, true);
  assert.equal(calls.findLast(c => c.name === 'set_setting').args.key, `task_today_focus:${task.id}`);
  assert.match(settings.get(`task_today_focus:${task.id}`), /^\d{4}-\d{2}-\d{2}$/);
  await act(async () => tag.click());
  assert.equal(tag.checked, false);
  assert.equal(settings.get(`task_today_focus:${task.id}`), '');
  assert.deepEqual(calls.slice(beforeTag).map(c => c.name), ['set_setting', 'set_setting'], 'The detail tag changes settings only, not priority, planned dates or task status');
  const { recognizeQuickSchedule } = await server.ssrLoadModule('/src/utils/quickSchedule.ts');
  const fixed = new Date(2026, 9, 7, 10, 0);
  assert.equal(recognizeQuickSchedule('明晚七点复习第三章', fixed).localTime, '2026-10-08T19:00');
  assert.equal(recognizeQuickSchedule('周六上午九点半写论文', fixed).localTime, '2026-10-10T09:30');
  assert.equal(recognizeQuickSchedule('下周一下午三点开会', fixed).localTime, '2026-10-12T15:00');
  assert.equal(recognizeQuickSchedule('每天19点学习', fixed).recurrence, 'daily');
  assert.equal(recognizeQuickSchedule('每周六19点学习', fixed).recurDays, '6');
  assert.equal(recognizeQuickSchedule('2026-02-30 19:00学习', fixed), null);
  assert.equal(recognizeQuickSchedule('明天25点学习', fixed), null);
  assert.equal(recognizeQuickSchedule('明天123点学习', fixed), null);
  assert.equal(recognizeQuickSchedule('明天19:300学习', fixed), null);
  assert.equal(recognizeQuickSchedule('明天学习这一章', fixed), null);
  const { usePreparationStore } = await server.ssrLoadModule('/src/store/preparation.ts');
  const { PreparationPanel } = await server.ssrLoadModule('/src/components/PreparationPanel.tsx');
  await render(React.createElement(PreparationPanel, { task }));
  assert.equal(document.querySelector('form'), null, 'Configuration is tucked into the original task');
  await click('建立准备约定');
  const inputs = [...document.querySelectorAll('input')];
  const rootInput = inputs.find(i => i.placeholder.includes('完整目录'));
  assert.ok(rootInput); await setInput(rootInput, 'C:\\Changed-fixture');
  await act(async () => { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  const saved = calls.find(c => c.name === 'save_preparation'); assert.ok(saved);
  assert.equal(saved.args.input.config.search, false, 'Network search needs a specific opt-in');
  assert.equal(saved.args.input.config.notify, false, 'Ordinary preparations stay quiet');
  assert.equal(saved.args.input.taskId, task.id);
  assert.equal(saved.args.input.config.outputRoot, 'C:\\Changed-fixture');
  assert.ok(document.body.textContent.includes('已授权'));
  await click('暂停这条准备'); assert.equal(prep.rules[0].enabled, false);
  await click('恢复准备'); assert.equal(prep.rules[0].enabled, true);
  prep.runs = [{ id: 'run-one', taskId: task.id, ruleId: 'rule-one', version: 1, state: 'ready', actionAt: new Date().toISOString(), attempt: 1, error: null, resultJson: JSON.stringify({ summary: '写作目录已备好', artifacts: [{ name: 'START-HERE.md', path: 'C:/fixture/START-HERE.md' }], sources: [{ title: '候选论文', access: 'metadata' }], scope: '授权范围' }) }];
  await act(async () => { usePreparationStore.setState(prep); });
  assert.ok(document.body.textContent.includes('写作目录已备好'));
  assert.ok(document.body.textContent.includes('仅元数据，未阅读全文'));
  await click('从这里开始');assert.ok(document.querySelector('pre').textContent.includes('指定材料已经可读'));assert.equal(document.querySelectorAll('script').length, 0, 'Result text is never executed as markup');
  assert.equal(calls.filter(c => c.name === 'complete_task').length, 0, 'Preparation UI does not complete the person’s goal');
  const { PetQuickTasks } = await server.ssrLoadModule('/src/companions/PetQuickTasks.tsx');
  await render(React.createElement(PetQuickTasks, { focused: false, proactive: false }));
  const completed = document.querySelector('[aria-label="完成 准备写论文"]');assert.ok(completed);
  await act(async () => { completed.click(); });assert.equal(tasks[0].status, 'done');
  tasks = [{ ...task }];
  const { JourneyPanel } = await server.ssrLoadModule('/src/companions/JourneyPanel.tsx');
  await render(React.createElement(JourneyPanel, { theme: 'pixel-jrpg', game: () => React.createElement('p', null, '独立小游戏入口') }));
  await click('整理新一章'); await click('带上寻星罗盘'); await click('走山道');
  assert.equal(chapter.node, 2); assert.equal(chapter.bag, 'compass');assert.equal(chapter.route, 'ridge');
  assert.ok(document.body.textContent.includes('独立小游戏入口'));
  const { FirstSteps } = await server.ssrLoadModule('/src/components/FirstSteps.tsx');
  await render(React.createElement(FirstSteps, { onTask() {}, onSettings() {} }));
  assert.equal(document.querySelector('dialog'), null, 'Existing users are not interrupted');
  await act(async () => { window.dispatchEvent(new dom.window.CustomEvent('onboarding:open')); });
  await click('就从现在的主题开始');
  const entry = document.querySelector('input[placeholder="例如：明晚七点复习第三章"]');assert.ok(entry);
  await setInput(entry, '明晚七点复习第三章');
  assert.ok(document.body.textContent.includes('识别到'));
  await act(async () => { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  await click('今天就先推进');await click('稍后再做');assert.ok(document.body.textContent.includes('当前没有准备结果'));
  await click('继续');await click('现在开始使用');assert.equal(document.querySelector('dialog'), null);
  assert.equal(JSON.parse(settings.get('onboarding_state')).complete, true);
  // Verify that the real focus component owns only its context and that a
  // restored/unrelated session cannot auto-start sound.
  const contexts = [];
  let delayNextResume = false, releaseResume;
  class AudioFixture {
    constructor() { this.sampleRate = 100; this.state = 'suspended'; this.source = null; this.delayed = delayNextResume; delayNextResume = false; contexts.push(this); }
    createBuffer(_channels, size) { return { getChannelData: () => new Float32Array(size) }; }
    createBufferSource() { this.source = { connect() {}, start() { this.started = true; }, stop() { this.stops = (this.stops ?? 0) + 1; } }; return this.source; }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    async resume() { if (this.delayed) { this.delayed = false; await new Promise(resolve => { releaseResume = resolve; }); } if (this.state !== 'closed') this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
  }
  globalThis.AudioContext = AudioFixture;
  const foreign = new AudioFixture();
  const { usePomodoroStore } = await server.ssrLoadModule('/src/store/pomodoro.ts');
  const { FocusEnvironment } = await server.ssrLoadModule('/src/components/FocusEnvironment.tsx');
  const focus = { id: 'focus-one', taskId: task.id, state: 'running', updatedAt: new Date().toISOString(), remainingSecs: 100, durationMin: 25 };
  await act(async () => { usePomodoroStore.setState({ session: focus }); });
  await render(React.createElement(FocusEnvironment));
  assert.equal(contexts.length, 1, 'Restoring a session cannot auto-start sound');
  const signal = payload => { for (const args of listeners.values()) if (args.event === 'focus-environment') callbacks.get(args.handler)({ payload }); };
  await act(async () => { signal({ sessionId: 'old-session', sound: 'rain' }); });assert.equal(contexts.length, 1);
  await act(async () => { signal({ sessionId: focus.id, sound: 'rain' }); });assert.equal(contexts.length, 2);assert.equal(contexts[1].state, 'running');
  await act(async () => { usePomodoroStore.setState({ session: { ...focus, state: 'paused' } }); });assert.equal(contexts[1].state, 'suspended');
  await act(async () => { usePomodoroStore.setState({ session: null }); });assert.equal(contexts[1].state, 'closed');assert.equal(contexts[1].source.stops, 1);assert.equal(foreign.state, 'suspended');
  delayNextResume = true;
  await act(async () => { usePomodoroStore.setState({ session: { ...focus, id: 'focus-old' } }); });
  await act(async () => { signal({ sessionId: 'focus-old', sound: 'rain' }); });
  assert.equal(typeof releaseResume, 'function');
  await act(async () => { usePomodoroStore.setState({ session: { ...focus, id: 'focus-new' } }); });
  await act(async () => { signal({ sessionId: 'focus-new', sound: 'brown' }); });assert.equal(contexts[3].state, 'running');
  await act(async () => { releaseResume(); });assert.equal(contexts[3].state, 'running', 'A late old audio promise cannot stop the new session');
  await act(async () => { usePomodoroStore.setState({ session: null }); });assert.equal(contexts[3].state, 'closed');
  const { useTasksStore } = await server.ssrLoadModule('/src/store/tasks.ts');
  const { GoalWorkbench } = await server.ssrLoadModule('/src/components/GoalWorkbench.tsx');
  goalData = { today: '2026-10-07', actions: [{ key: 'step:original-leaf', taskId: task.id, stepId: 'original-leaf', title: '原步骤', goalTitle: task.title, estimatedMin: 30, deadline: null, reasons: ['截止临近'], focused: false }], goals: [{ taskId: task.id, title: '长期目标', paused: false, focused: false, done: 2, total: 3, stages: [{ id: 'phase-one', title: '阶段一', complete: true, done: 2, total: 2 }], activeStage: 'phase-two', advanceFrom: 'phase-one', pauseSuggested: false }], preferences: [], schedule: [], overload: '今日安排过多', dailyBudget: 180 };
  plan = { id: 'preview-one', createdAt: new Date().toISOString(), rows: [{ key: 'step:original-leaf', taskId: task.id, stepId: 'original-leaf', title: '原步骤', startsAt: '2026-10-08T12:00:00+08:00', previous: '2026-10-06', endsAt: '2026-10-08T12:30:00+08:00', minutes: 30, warning: null, reasons: ['避开临时课程'] }], notes: ['原截止日期不变'] };
  tasks = [{ ...task, status: 'open', form: 'main_quest' }, { ...task, id: 'second', title: '第二件事', status: 'open' }];
  await act(async () => useTasksStore.setState({ tasks }));
  await render(React.createElement(GoalWorkbench));
  assert.ok(document.body.textContent.includes('原步骤'));
  const createsBefore = calls.filter(c => c.name === 'create_task').length;
  await click('完成步骤'); assert.equal(calls.findLast(c => c.name === 'complete_step').args.id, 'original-leaf'); assert.equal(calls.filter(c => c.name === 'create_task').length, createsBefore);
  await click('阶段与负载'); await click('聚焦这条主线'); assert.equal(calls.findLast(c => c.name === 'set_goal_focus').args.taskId, task.id);
  await click('继续下一阶段'); assert.equal(calls.findLast(c => c.name === 'advance_goal_stage').args.stageId, 'phase-one');
  await click('预览新的安排'); assert.ok(document.body.textContent.includes('原步骤')); assert.equal(calls.filter(c => c.name === 'apply_replan').length, 0);
  await click('应用这份安排'); assert.equal(calls.findLast(c => c.name === 'apply_replan').args.id, 'preview-one');
  await click('四象限'); assert.ok(document.body.textContent.includes('重要且紧急'));
  await click('手动排序'); const down = document.querySelector('button[aria-label^="下移"]'); await act(async () => down.click()); assert.equal(calls.findLast(c => c.name === 'reorder_work').args.kind, 'task');
  await click('周月复盘'); assert.ok(document.body.textContent.includes('未记录')); await click('最近 30 天'); assert.equal(calls.findLast(c => c.name === 'get_progress_review').args.days, 30);
  const { SimpleCapture } = await server.ssrLoadModule('/src/components/SimpleCapture.tsx');
  await render(React.createElement(SimpleCapture)); await setInput(document.querySelector('input[aria-label="快速记录事情"]'), '明晚七点阅读');
  assert.ok(document.querySelector('input[type="datetime-local"]').value.endsWith('T19:00'));
  await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(calls.filter(c => c.name === 'create_task').length, createsBefore + 1);
  deleted = [{ id: 'delete-one', kind: 'task', entityId: task.id, title: '误删任务', deletedAt: new Date().toISOString() }];
  await render(React.createElement(GoalWorkbench)); await click('撤销删除'); assert.equal(calls.findLast(c => c.name === 'restore_deleted_item').args.id, 'delete-one');
  console.log('PASS: active detail tag changes settings only; isolated retained components and interfaces still pass regression tests (not mounted in the product)');
} finally { await act(async () => root.unmount()); await server.close(); dom.window.close(); }
