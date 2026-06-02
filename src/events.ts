import { EventEmitter } from "node:events";

export interface PhaseStartEvent {
  phase: string;
  index: number;
  total: number;
}
export interface PhaseDoneEvent {
  phase: string;
  index: number;
  total: number;
}
export interface PhaseFailEvent {
  phase: string;
  index: number;
  total: number;
  error: string;
}
export interface MilestoneEvent {
  name: string;
  dimension: string;
}
export interface SmeltWaitEvent {
  seconds: number;
}

export type BotEventMap = {
  "phase:start": [PhaseStartEvent];
  "phase:complete": [PhaseDoneEvent];
  "phase:fail": [PhaseFailEvent];
  milestone: [MilestoneEvent];
  "smelt:wait": [SmeltWaitEvent];
};

export class TypedEmitter<M extends Record<string, unknown[]>> {
  private readonly ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(0);
  }

  on<K extends keyof M & string>(event: K, listener: (...args: M[K]) => void): () => void {
    this.ee.on(event, listener as (...args: unknown[]) => void);
    return () => this.ee.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof M & string>(event: K, ...args: M[K]): void {
    this.ee.emit(event, ...args);
  }
}

export type BotEventChannel = TypedEmitter<BotEventMap>;

export const botEvents: BotEventChannel = new TypedEmitter<BotEventMap>();
