// @alife-sdk/simulation — offline tick-based A-Life world simulation.
// Zero Phaser dependencies. Depends on @alife-sdk/core.

export * from './types/index';
export * from './ports/index';
export * from './terrain/index';
export * from './npc/index';
export * from './brain/index';
export * from './combat/index';
export * from './surge/index';
export * from './squad/index';
export * from './movement/index';
export * from './plugin/index';
export { createInMemoryKernel } from './createInMemoryKernel';
export type { IInMemoryKernelOptions, IInMemoryKernelResult } from './createInMemoryKernel';
