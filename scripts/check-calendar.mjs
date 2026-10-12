import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

process.env.TZ = 'Asia/Shanghai';
const source = readFileSync(new URL('../src/components/calendarLayout.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { automaticCalendarView, calendarDensity, mergeCalendarCourses, calendarWeek, calendarMonth, moveCalendarMonth, moveCalendarDate, calendarEntries } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

assert.equal(automaticCalendarView(420), 'day');
assert.equal(automaticCalendarView(780), 'week');
assert.equal(automaticCalendarView(1250), 'month');
let stable = 'week';
for (const width of [1040, 1055, 1048, 1060, 1032, 1068]) {
  stable = automaticCalendarView(width, stable); assert.equal(stable, 'week');
}
stable = automaticCalendarView(1080, stable); assert.equal(stable, 'month');
for (const width of [1060, 1044, 1035, 1050]) {
  stable = automaticCalendarView(width, stable); assert.equal(stable, 'month');
}
assert.equal(automaticCalendarView(1020, stable), 'week');
assert.equal(automaticCalendarView(610, 'day'), 'day');
assert.equal(automaticCalendarView(585, 'week'), 'week');
assert.equal(calendarDensity(250, 700, 'day'), 'icons');
assert.equal(calendarDensity(420, 700, 'day'), 'full');
assert.equal(calendarDensity(1400, 700, 'month'), 'full');
assert.equal(calendarDensity(770, 700, 'month'), 'titles');
assert.equal(calendarDensity(600, 700, 'month'), 'icons');
assert.equal(calendarDensity(330, 700, 'month'), 'markers');
assert.equal(calendarDensity(770, 120, 'month'), 'titles', 'grid height never switches between titles and counts');
assert.equal(moveCalendarMonth('2024-01-31', 1), '2024-02-29');
assert.equal(moveCalendarMonth('2026-01-31', 1), '2026-02-28');
assert.equal(moveCalendarMonth('2026-12-31', 1), '2027-01-31');
assert.equal(moveCalendarDate('2026-12-31', 1), '2027-01-01');
assert.deepEqual(calendarWeek('2026-10-04'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
const grid = calendarMonth('2026-10-04');
assert.equal(grid.length, 35);
assert.equal(grid[0], '2026-09-28');
assert.equal(grid.at(-1), '2026-11-01');
assert.equal(calendarMonth('2024-02-10').filter(date => date.startsWith('2024-02-')).length, 29);

const day = { date: '2026-10-04', weekday: 7, holidayName: null, isOff: null,
  courses: [{ id: 'c1', name: '数据结构', startTime: '08:00', endTime: '09:40', color: '#456', location: 'H302' }],
  tasksDue: [{ id: 'due', title: '旧标题', status: 'active' }] };
const task = { id: 'due', title: '实验报告', deadline: '2026-10-03T16:30:00Z', plannedDate: '2026-10-04', status: 'done', recurrence: 'none', createdAt: '2026-09-01T00:00:00Z' };
const entries = calendarEntries(day, [task], '2026-10-04');
assert.equal(entries.length, 2, 'deadline + plan must not duplicate the task');
assert.equal(entries[1].title, '实验报告');
assert.equal(entries[1].time, '00:30', 'UTC deadline belongs to the local calendar day');
assert.equal(entries[1].done, true);
assert.equal(entries[0].title, '数据结构', 'completed items have lowest priority');
const course = day.courses[0];
const periods = [
  { ...course, startTime: '09:55', endTime: '10:40' },
  { ...course, startTime: '08:55', endTime: '09:40' },
  { ...course, startTime: '08:00', endTime: '08:45' },
  { ...course, startTime: '08:00', endTime: '08:45' },
  { ...course, startTime: '13:30', endTime: '14:15' },
];
const blocks = mergeCalendarCourses(periods);
assert.deepEqual(blocks.map(c => [c.startTime, c.endTime, c.periodCount]), [['08:00','10:40',3],['13:30','14:15',1]]);
assert.equal(periods[2].endTime, '08:45', 'display merging must not mutate the timetable');
assert.equal(mergeCalendarCourses([periods[2], { ...periods[1], id:'another' }]).length,2);
assert.equal(mergeCalendarCourses([periods[2], { ...periods[1], location:'H401' }]).length,2);
assert.equal(mergeCalendarCourses([periods[2], { ...periods[1], startTime:'09:15' }]).length,2,'long gaps remain separate');
assert.equal(mergeCalendarCourses([periods[2], { ...periods[1], startTime:'invalid' }]).length,2);
assert.equal(mergeCalendarCourses([course, { ...course,startTime:'08:30',endTime:'09:00' }])[0].endTime,'09:40','overlap cannot shorten the block');
const mergedEntries = calendarEntries({ ...day,courses:periods,tasksDue:[] }, [],'2026-10-04');
assert.equal(mergedEntries.length,2);assert.equal(mergedEntries[0].label,'课程 · 连堂');
const prioritized = calendarEntries(day, [{ ...task, status: 'active' }, { ...task, id: 'plan', title: '计划', deadline: null, status: 'active' }, { ...task, id: 'daily', title: '日常', plannedDate: null, deadline: null, status: 'active', recurrence: 'daily' }], '2026-10-04');
assert.deepEqual(prioritized.map(entry => entry.title), ['实验报告', '数据结构', '计划', '日常']);
const routine = { ...task, id: 'routine', title: '阅读', deadline: null, plannedDate: null, recurrence: 'weekly', recurDays: '1,7', status: 'active', lastDoneDate: '2026-10-04' };
assert.equal(calendarEntries({ ...day, tasksDue: [] }, [routine], '2026-10-04').find(e => e.taskId === 'routine').done, true);
assert.equal(calendarEntries({ ...day, date: '2026-10-05', weekday: 1, tasksDue: [] }, [routine], '2026-10-04').find(e => e.taskId === 'routine').label, '每周目标');
assert.equal(calendarEntries({ ...day, date: '2026-10-06', weekday: 2, tasksDue: [] }, [routine], '2026-10-04').filter(e => e.taskId).length, 0);
assert.equal(calendarEntries({ ...day, date: '2026-09-27', tasksDue: [] }, [routine], '2026-10-04').filter(e => e.taskId).length, 0, 'do not invent historical recurring completions');
assert.equal(calendarEntries({ ...day, tasksDue: [] }, [{ ...routine, status: 'shelved' }], '2026-10-04').filter(e => e.taskId).length, 0);

process.env.TZ = 'America/New_York';
assert.equal(moveCalendarDate('2026-03-08', 1), '2026-03-09');
assert.equal(moveCalendarDate('2026-11-01', -1), '2026-10-31');
const taskSource = readFileSync(new URL('../src/api/tasks.ts', import.meta.url), 'utf8');
const taskJs = ts.transpileModule(taskSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/from '(@tauri-apps\/[^']+)'/g, (_, name) => `from '${import.meta.resolve(name)}'`);
const { isTaskDoneToday } = await import(`data:text/javascript;base64,${Buffer.from(taskJs).toString('base64')}`);
assert.equal(isTaskDoneToday({ status: 'active', recurrence: 'daily', doneToday: true }), true);
assert.equal(isTaskDoneToday({ status: 'active', recurrence: 'weekly', doneToday: true }), true);
assert.equal(isTaskDoneToday({ status: 'active', recurrence: 'daily', doneToday: false }), false, 'next task day returns to open');
assert.equal(isTaskDoneToday({ status: 'active', recurrence: 'none', doneToday: true }), false);
assert.equal(isTaskDoneToday({ status: 'done', recurrence: 'none', doneToday: false }), true);
console.log('Calendar regression checks passed: responsive modes, date boundaries, local deadlines, plans, recurring tasks and completion states.');
