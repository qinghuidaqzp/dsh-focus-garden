import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ToolsService, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.js';

async function harness(t: TestContext) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt, {}).await();
  await ctx.plugin(ToolsService).await();
  const fiber = ctx.plugin(plugin, {}); await fiber.await();
  const execute = (name: string, args: unknown, id: string | undefined = 'session-a', signal = new AbortController().signal) => {
    const tool = ctx.tools.get(name); assert.ok(tool);
    return tool.execute(args, { signal, agent: id ? { id } : undefined } as unknown as ToolRunContext) as Promise<{ text: string; phase: string; remainingSeconds: number; harvested: number }>;
  };
  return { ctx, fiber, execute };
}

test('real Cordis mounts all native tools, exposes settings and cleans up on unload', async t => {
  const h = await harness(t);
  assert.deepEqual(h.ctx.tools.schemas().map(t => t.name), ['garden_focus', 'garden_status', 'garden_harvest']);
  assert.equal((h.fiber.effectiveConfig as plugin.Config).defaultMinutes.get(), 25);
  const tool = h.ctx.tools.get('garden_focus')!;
  assert.deepEqual(tool.parameters.required, ['action']);
  await h.fiber.dispose();
  assert.deepEqual(h.ctx.tools.definitions(), []);
  await assert.rejects(tool.execute({ action: 'start', task: 'after unload' }, { signal: new AbortController().signal, agent: { id: 'a' } } as unknown as ToolRunContext), { code: 'PLUGIN_UNLOADED' });
});

test('native tools retain state per real agent identity and respect live default settings', async t => {
  const h = await harness(t);
  const first = await h.execute('garden_focus', { action: 'start', task: '写测试' });
  assert.equal(first.phase, 'running');
  assert.equal(first.remainingSeconds, 1500);
  assert.match(first.text, /播下一颗专注种子/);
  assert.equal((await h.execute('garden_status', {}, 'session-b')).phase, 'idle');
  assert.equal((await h.execute('garden_focus', { action: 'pause' })).phase, 'paused');
  assert.equal((await h.execute('garden_focus', { action: 'resume' })).phase, 'running');
  assert.equal((await h.execute('garden_focus', { action: 'cancel' })).phase, 'idle');
  await h.fiber.update({ defaultMinutes: 7 });
  assert.equal((await h.execute('garden_focus', { action: 'start', task: '另一个目标' })).remainingSeconds, 420);
});

test('native errors preserve actionable codes and do not award incomplete work', async t => {
  const h = await harness(t);
  await assert.rejects(h.execute('garden_focus', { action: 'start', task: '目标', minutes: 0 }), { code: 'MINUTES_INVALID' });
  await assert.rejects(h.execute('garden_focus', { action: 'start' }), { code: 'TASK_INVALID' });
  await h.execute('garden_focus', { action: 'start', task: '目标', minutes: 1 });
  await assert.rejects(h.execute('garden_harvest', {}), { code: 'NOT_READY' });
  assert.equal((await h.execute('garden_status', {})).harvested, 0);
  const status = h.ctx.tools.get('garden_status')!;
  await assert.rejects(status.execute({}, { signal: new AbortController().signal } as ToolRunContext), { code: 'SESSION_REQUIRED' });
});

test('cancelled tool calls do not mutate an existing garden', async t => {
  const h = await harness(t);
  const controller = new AbortController();
  const reason = new Error('user cancelled'); controller.abort(reason);
  await assert.rejects(h.execute('garden_focus', { action: 'start', task: 'must not start' }, 'session-a', controller.signal), e => e === reason);
  assert.equal((await h.execute('garden_status', {})).phase, 'idle');
});

test('native output uses the Markdown garden and reports read/write concurrency intent', async t => {
  const h = await harness(t);
  const value = await h.execute('garden_status', {});
  const status = h.ctx.tools.get('garden_status')!;
  assert.deepEqual(status.output.render({}, value), [{ type: 'text', text: value.text }]);
  assert.equal(status.isConcurrencySafe?.({}), true);
  assert.equal(h.ctx.tools.get('garden_focus')!.isConcurrencySafe?.({}), false);
});
