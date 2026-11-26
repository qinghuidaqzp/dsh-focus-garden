import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FocusGarden, renderGarden } from '../src/garden.js';

function clock() {
  let time = 0;
  return { garden: new FocusGarden(() => time), advance(ms: number) { time += ms; }, set(ms: number) { time = ms; } };
}

test('a full focus interval grows exactly one harvest and records its minutes', () => {
  const h = clock();
  assert.equal(h.garden.start('a', '写完测试', 25).remainingSeconds, 1500);
  h.advance(750_000);
  assert.equal(h.garden.status('a').progressPercent, 50);
  assert.throws(() => h.garden.harvest('a'), { code: 'NOT_READY' });
  h.advance(750_000);
  assert.equal(h.garden.status('a').phase, 'ready');
  const result = h.garden.harvest('a');
  assert.equal(result.phase, 'idle');
  assert.equal(result.harvested, 1);
  assert.equal(result.totalFocusMinutes, 25);
  assert.deepEqual(result.flowers, ['🌻']);
  assert.throws(() => h.garden.harvest('a'), { code: 'NOT_READY' });
});

test('paused time never contributes to growth and resume uses only remaining active time', () => {
  const h = clock();
  h.garden.start('a', '专注', 1);
  h.advance(20_000);
  assert.equal(h.garden.pause('a').remainingSeconds, 40);
  h.advance(3_600_000);
  assert.equal(h.garden.status('a').remainingSeconds, 40);
  assert.equal(h.garden.resume('a').remainingSeconds, 40);
  h.advance(39_999);
  assert.equal(h.garden.status('a').phase, 'running');
  h.advance(1);
  assert.equal(h.garden.harvest('a').harvested, 1);
});

test('sessions are isolated and returned arrays cannot mutate the stored garden', () => {
  const h = clock();
  h.garden.start('a', '一号任务', 1);
  h.garden.start('b', '二号任务', 2);
  h.advance(60_000);
  const a = h.garden.harvest('a');
  a.flowers.push('malicious');
  assert.deepEqual(h.garden.status('a').flowers, ['🌻']);
  assert.equal(h.garden.status('b').phase, 'running');
  assert.equal(h.garden.status('b').harvested, 0);
});

test('cancel discards unfinished growth while preserving earlier harvests', () => {
  const h = clock();
  h.garden.start('a', '成功任务', 1); h.advance(60_000); h.garden.harvest('a');
  h.garden.start('a', '改天再做', 2); h.advance(30_000);
  const result = h.garden.cancel('a');
  assert.equal(result.phase, 'idle');
  assert.equal(result.harvested, 1);
  assert.equal(result.totalFocusMinutes, 1);
  h.advance(1_000_000);
  assert.throws(() => h.garden.harvest('a'), { code: 'NOT_READY' });
});

test('state transitions reject replacement, double pause, early harvest and completed cancellation', () => {
  const h = clock();
  assert.throws(() => h.garden.resume('a'), { code: 'NOT_PAUSED' });
  assert.throws(() => h.garden.cancel('a'), { code: 'NO_FOCUS' });
  h.garden.start('a', '目标', 1);
  assert.throws(() => h.garden.start('a', '覆盖目标', 1), { code: 'FOCUS_EXISTS' });
  h.garden.pause('a');
  assert.throws(() => h.garden.pause('a'), { code: 'NOT_RUNNING' });
  h.garden.resume('a'); h.advance(60_000);
  assert.throws(() => h.garden.pause('a'), { code: 'NOT_RUNNING' });
  assert.throws(() => h.garden.cancel('a'), { code: 'READY_TO_HARVEST' });
  assert.throws(() => h.garden.start('a', '覆盖花朵', 1), { code: 'FOCUS_EXISTS' });
});

test('elapsed time is capped, rounded up for display, and never counts a backward clock twice', () => {
  const h = clock();
  h.garden.start('a', '目标', 1);
  h.advance(10_100);
  assert.equal(h.garden.status('a').remainingSeconds, 50);
  h.set(5000);
  assert.equal(h.garden.status('a').remainingSeconds, 50);
  h.set(10_100);
  assert.equal(h.garden.status('a').remainingSeconds, 50);
  h.advance(100_000_000);
  const complete = h.garden.status('a');
  assert.equal(complete.progressPercent, 100);
  assert.equal(complete.remainingSeconds, 0);
  assert.equal(h.garden.harvest('a').totalFocusMinutes, 1);
});

test('bounds minutes, task, session identity and memory capacity without evicting active state', () => {
  const h = clock();
  for (const minutes of [0, -1, 0.5, 181, NaN, Infinity]) assert.throws(() => h.garden.start('a', '目标', minutes), { code: 'MINUTES_INVALID' });
  for (const task of ['', '  ', 'a'.repeat(201)]) assert.throws(() => h.garden.start('a', task, 1), { code: 'TASK_INVALID' });
  assert.throws(() => h.garden.status(''), { code: 'SESSION_REQUIRED' });
  const limited = new FocusGarden(() => 0, 1);
  limited.start('a', '保留任务', 1);
  assert.throws(() => limited.start('b', '新任务', 1), { code: 'GARDEN_LIMIT' });
  assert.equal(limited.status('a').task, '保留任务');
});

test('retains last 48 visible flowers while preserving all completion totals', () => {
  const h = clock();
  for (let i = 0; i < 50; i++) {
    h.garden.start('a', `任务 ${i}`, 1); h.advance(60_000); h.garden.harvest('a');
  }
  const result = h.garden.status('a');
  assert.equal(result.flowers.length, 48);
  assert.equal(result.harvested, 50);
  assert.equal(result.totalFocusMinutes, 50);
  assert.equal(new Set(result.flowers).size, 8);
});

test('clear drops all process-local state, and rendering escapes task markup', () => {
  const h = clock();
  const value = h.garden.start('a', '[run](evil) <script>\n**goal**', 1);
  const text = renderGarden(value);
  assert.ok(text.includes('🌱'));
  assert.ok(text.includes('不弹出通知'));
  assert.ok(!text.includes('[run]'));
  assert.ok(!text.includes('<script>'));
  h.garden.clear();
  assert.equal(h.garden.status('a').phase, 'idle');
});
