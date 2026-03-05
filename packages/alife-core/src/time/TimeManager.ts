// time/TimeManager.ts
// Standalone game-time manager.
// Wraps Clock with optional EventBus wiring — for games that do not use ALifeKernel.

import { Clock } from '../core/Clock';
import type { IClockConfig, IClockState } from '../core/Clock';
import type { EventBus } from '../events/EventBus';
import type { ALifeEventPayloads } from '../events/ALifeEvents';
import { ALifeEvents } from '../events/ALifeEvents';

export interface ITimeManagerConfig {
  /** Optional EventBus to receive 'time:hour_changed' and 'time:day_night_changed'. */
  events?: EventBus<ALifeEventPayloads>;
  /** Clock config (timeFactor, startHour, etc). onHourChanged/onDayNightChanged are managed internally. */
  clockConfig?: Omit<IClockConfig, 'onHourChanged' | 'onDayNightChanged'>;
}

export class TimeManager {
  private _clock: Clock;
  private readonly _events: EventBus<ALifeEventPayloads> | undefined;

  constructor(config: ITimeManagerConfig = {}) {
    this._events = config.events;
    this._clock = new Clock({
      ...(config.clockConfig ?? {}),
      ...this._buildCallbacks(),
    });
  }

  update(deltaMs: number): void {
    this._clock.update(deltaMs);
  }

  get clock(): Clock {
    return this._clock;
  }

  serialize(): IClockState {
    return this._clock.serialize();
  }

  restore(state: IClockState): void {
    this._clock = Clock.fromState(state, this._buildCallbacks());
  }

  private _buildCallbacks(): Pick<IClockConfig, 'onHourChanged' | 'onDayNightChanged'> {
    if (!this._events) return {};
    const events = this._events;
    return {
      onHourChanged: (hour: number, day: number) => {
        events.emit(ALifeEvents.HOUR_CHANGED, { hour, day, isDay: this._clock.isDay });
      },
      onDayNightChanged: (isDay: boolean) => {
        events.emit(ALifeEvents.DAY_NIGHT_CHANGED, { isDay });
      },
    };
  }
}
