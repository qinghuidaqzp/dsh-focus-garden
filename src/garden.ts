export type Phase = 'idle' | 'running' | 'paused' | 'ready';
export interface GardenSnapshot {
  phase: Phase;
  task: string;
  durationMinutes: number;
  remainingSeconds: number;
  progressPercent: number;
  harvested: number;
  totalFocusMinutes: number;
  flowers: string[];
}
interface Garden {
  phase: Phase;
  task: string;
  durationMs: number;
  elapsedMs: number;
  resumedAt: number | null;
  harvested: number;
  totalFocusMinutes: number;
  flowers: string[];
}

export class GardenError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'GardenError'; }
}

const species = ['🌻', '🌷', '🌼', '🌺', '🪷', '🌹', '💮', '🪻'];

/** All operations are synchronous: a completed plant can only be harvested once. */
export class FocusGarden {
  private readonly gardens = new Map<string, Garden>();
  constructor(private readonly now: () => number = () => performance.now(), private readonly capacity = 128) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new GardenError('INVALID_CAPACITY', '会话数量限制必须是正整数。');
  }

  private get(sessionId: string): Garden {
    if (typeof sessionId !== 'string' || !sessionId) throw new GardenError('SESSION_REQUIRED', '需要在 Harness 会话中使用番茄花园。');
    let value = this.gardens.get(sessionId);
    if (!value) {
      if (this.gardens.size >= this.capacity) throw new GardenError('GARDEN_LIMIT', '花园会话数量已达到上限；重载插件后可重新开始。');
      value = { phase: 'idle', task: '', durationMs: 0, elapsedMs: 0, resumedAt: null, harvested: 0, totalFocusMinutes: 0, flowers: [] };
      this.gardens.set(sessionId, value);
    }
    return value;
  }

  private refresh(garden: Garden): void {
    if (garden.phase !== 'running' || garden.resumedAt === null) return;
    const now = this.now();
    const delta = Math.max(0, now - garden.resumedAt);
    garden.elapsedMs = Math.min(garden.durationMs, garden.elapsedMs + delta);
    garden.resumedAt = Math.max(garden.resumedAt, now);
    if (garden.elapsedMs >= garden.durationMs) { garden.phase = 'ready'; garden.resumedAt = null; }
  }

  private view(garden: Garden): GardenSnapshot {
    this.refresh(garden);
    return {
      phase: garden.phase, task: garden.task,
      durationMinutes: garden.durationMs / 60_000,
      remainingSeconds: Math.max(0, Math.ceil((garden.durationMs - garden.elapsedMs) / 1000)),
      progressPercent: garden.durationMs ? Math.floor(garden.elapsedMs / garden.durationMs * 100) : 0,
      harvested: garden.harvested, totalFocusMinutes: garden.totalFocusMinutes,
      flowers: [...garden.flowers],
    };
  }

  status(sessionId: string): GardenSnapshot { return this.view(this.get(sessionId)); }

  start(sessionId: string, task: string, minutes: number): GardenSnapshot {
    if (typeof task !== 'string' || !task.trim() || task.trim().length > 200) throw new GardenError('TASK_INVALID', '请填写 1–200 字的专注目标。');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new GardenError('MINUTES_INVALID', '专注时长必须是 1–180 分钟之间的整数。');
    const garden = this.get(sessionId);
    this.refresh(garden);
    if (garden.phase !== 'idle') throw new GardenError('FOCUS_EXISTS', garden.phase === 'ready' ? '已有一朵花可以收获，请先收获再开始。' : '已有专注任务，请先暂停、完成或取消。');
    Object.assign(garden, { phase: 'running', task: task.trim(), durationMs: minutes * 60_000, elapsedMs: 0, resumedAt: this.now() });
    return this.view(garden);
  }

  pause(sessionId: string): GardenSnapshot {
    const garden = this.get(sessionId); this.refresh(garden);
    if (garden.phase !== 'running') throw new GardenError('NOT_RUNNING', garden.phase === 'ready' ? '专注已经完成，可以直接收获。' : '当前没有正在计时的专注任务。');
    garden.phase = 'paused'; garden.resumedAt = null;
    return this.view(garden);
  }

  resume(sessionId: string): GardenSnapshot {
    const garden = this.get(sessionId);
    if (garden.phase !== 'paused') throw new GardenError('NOT_PAUSED', '只有暂停中的专注任务可以继续。');
    garden.phase = 'running'; garden.resumedAt = this.now();
    return this.view(garden);
  }

  cancel(sessionId: string): GardenSnapshot {
    const garden = this.get(sessionId); this.refresh(garden);
    if (garden.phase === 'idle') throw new GardenError('NO_FOCUS', '当前没有需要取消的专注任务。');
    if (garden.phase === 'ready') throw new GardenError('READY_TO_HARVEST', '专注已经完成，请收获这朵花。');
    Object.assign(garden, { phase: 'idle', task: '', durationMs: 0, elapsedMs: 0, resumedAt: null });
    return this.view(garden);
  }

  harvest(sessionId: string): GardenSnapshot {
    const garden = this.get(sessionId); this.refresh(garden);
    if (garden.phase !== 'ready') throw new GardenError('NOT_READY', '还没有完成的花朵可以收获。请继续专注，或先开始一个任务。');
    garden.flowers.push(species[garden.harvested % species.length]);
    if (garden.flowers.length > 48) garden.flowers.shift();
    garden.harvested += 1;
    garden.totalFocusMinutes += garden.durationMs / 60_000;
    Object.assign(garden, { phase: 'idle', task: '', durationMs: 0, elapsedMs: 0, resumedAt: null });
    return this.view(garden);
  }

  clear(): void { this.gardens.clear(); }
}

/** Pure Markdown rendering; tasks are quoted, not interpreted as tool instructions. */
export function renderGarden(value: GardenSnapshot, headline = '你的番茄花园'): string {
  const stage = value.phase === 'idle' ? '🪴' : value.progressPercent < 25 ? '🌱' : value.progressPercent < 60 ? '🌿' : value.progressPercent < 100 ? '🌳' : '🌸';
  const status = { idle: '等待播种', running: '专注中', paused: '已暂停', ready: '花开了，可以收获！' }[value.phase];
  const rows: string[] = [];
  for (let i = 0; i < value.flowers.length; i += 8) rows.push(value.flowers.slice(i, i + 8).join(' '));
  const task = value.task.replace(/[\r\n]/g, ' ').replace(/([\\`*_{}\[\]<>#|])/g, '\\$1');
  return [
    `${stage} **${headline}** · ${status}`,
    ...(task ? [`目标：${task}`, `进度 ${value.progressPercent}% · 剩余 ${Math.floor(value.remainingSeconds / 60)} 分 ${value.remainingSeconds % 60} 秒`] : []),
    rows.length ? rows.join('\n\n') : '▫️ ▫️ ▫️ ▫️ ▫️ ▫️ ▫️ ▫️',
    `累计收获 ${value.harvested} 朵 · 完成 ${value.totalFocusMinutes} 分钟专注`,
    value.phase === 'running' ? '到时后询问“看看花园”或“收获花朵”。本插件不弹出通知或自动唤醒模型。' : value.phase === 'paused' ? '暂停时间不会计入成长。准备好后说“继续专注”。' : '',
  ].filter(Boolean).join('\n\n');
}
