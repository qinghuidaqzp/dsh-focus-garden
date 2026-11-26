import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { FocusGarden, GardenError, renderGarden, type GardenSnapshot } from './garden.js';

export const name = 'focus-garden';
export const inject = ['tools'];
export interface Config { defaultMinutes: Volatile<number> }
export const Config = z.object({
  defaultMinutes: z.number().step(1).min(1).max(180).default(25).description('每段专注的默认分钟数（1–180）。修改后应用于新任务。').volatile(),
});

const outputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    phase: { type: 'string', enum: ['idle', 'running', 'paused', 'ready'], required: true },
    remainingSeconds: { type: 'integer', required: true },
    progressPercent: { type: 'integer', required: true },
    harvested: { type: 'integer', required: true },
    totalFocusMinutes: { type: 'number', required: true },
  },
} as const;

export function apply(ctx: Context, config: Config): void {
  const gardens = new FocusGarden();
  let disposed = false;
  ctx.effect(() => () => { disposed = true; gardens.clear(); });

  function run(exec: ToolRunContext, action: (id: string) => GardenSnapshot, headline?: string) {
    exec.signal.throwIfAborted();
    if (disposed) throw new HarnessError('番茄花园已卸载，请重新启用插件。', 'PLUGIN_UNLOADED');
    const id = exec.agent?.id;
    if (!id) throw new HarnessError('请在 Harness 会话中使用番茄花园。', 'SESSION_REQUIRED');
    try {
      const value = action(id);
      return {
        text: renderGarden(value, headline), phase: value.phase,
        remainingSeconds: value.remainingSeconds, progressPercent: value.progressPercent,
        harvested: value.harvested, totalFocusMinutes: value.totalFocusMinutes,
      };
    } catch (error) {
      if (error instanceof GardenError) throw new HarnessError(error.message, error.code);
      throw error;
    }
  }

  ctx.tools.register(defineTool({
    name: 'garden_focus',
    description: 'Manage a playful focus timer in the current conversation. Start grows an emoji plant; pause excludes paused time, resume continues, cancel discards only unfinished growth. Minutes are elapsed timer time, not measured attention. No background notifications or model wake-ups. Do not claim a timer has finished until status or harvest confirms it.',
    parameters: {
      action: { type: 'string', enum: ['start', 'pause', 'resume', 'cancel'], required: true, description: 'The requested focus operation.' },
      task: { type: 'string', description: 'Required for start: a short focus goal, up to 200 characters.' },
      minutes: { type: 'integer', description: 'Optional for start: 1–180 minutes, defaults to plugin setting.' },
    },
    output: { schema: outputSchema, render: (_args, value) => [{ type: 'text', text: value.text }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return run(exec, id => {
        switch (args.action) {
          case 'start': return gardens.start(id, args.task ?? '', args.minutes ?? config.defaultMinutes.get());
          case 'pause': return gardens.pause(id);
          case 'resume': return gardens.resume(id);
          case 'cancel': return gardens.cancel(id);
          default: throw new GardenError('INVALID_ACTION', '不支持的操作。');
        }
      }, args.action === 'start' ? '播下一颗专注种子' : undefined);
    },
    presentCall: () => ({ card: 'generic', title: '照顾番茄花园', kind: 'other' }),
  }));

  ctx.tools.register(defineTool({
    name: 'garden_status',
    description: 'Show the current conversation’s emoji garden, real remaining timer time, progress and harvest totals. State is in-memory for this loaded plugin; no disk persistence. Use to verify completion instead of guessing from chat history.',
    parameters: {},
    output: { schema: outputSchema, render: (_args, value) => [{ type: 'text', text: value.text }] },
    isConcurrencySafe: () => true,
    async execute(_args, exec) { return run(exec, id => gardens.status(id)); },
    presentCall: () => ({ card: 'generic', title: '看看花园', kind: 'read' }),
  }));

  ctx.tools.register(defineTool({
    name: 'garden_harvest',
    description: 'Harvest one flower only after the current focus timer has actually completed. Adds completed minutes to the current conversation’s garden; a plant cannot be harvested twice. Does not award partial or cancelled sessions.',
    parameters: {},
    output: { schema: outputSchema, render: (_args, value) => [{ type: 'text', text: value.text }] },
    isConcurrencySafe: () => false,
    async execute(_args, exec) { return run(exec, id => gardens.harvest(id), '收获成功！新花已经入园'); },
    presentCall: () => ({ card: 'generic', title: '收获专注花朵', kind: 'other' }),
  }));
}
