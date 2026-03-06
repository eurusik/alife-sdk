// @alife-sdk/core — public API barrel
// Framework-agnostic A-Life simulation and AI decision-making system.
// This package has zero external dependencies.

// ---------------------------------------------------------------------------
// Core (root-only, not a sub-path)
// ---------------------------------------------------------------------------
export { ALifeKernel, KERNEL_STATE_VERSION } from './core/ALifeKernel';
export type { IALifeKernelConfig, IALifeKernelOptions, IALifeKernelState, IPluginStateCapsule, StateMigration } from './core/ALifeKernel';
export { DEFAULT_DEVTOOLS_CONFIG } from './core/DevToolsInspector';
export type { IDevToolsSnapshot, IDevToolsConfig } from './core/DevToolsInspector';
export { PortRegistry, createPortToken } from './core/PortRegistry';
export type { PortToken } from './core/PortRegistry';
export { Ports, REQUIRED_PORTS } from './core/PortTokens';
export { DiagnosticsCollector, ALifeValidationError } from './core/Diagnostics';
export type { IDiagnostic, DiagnosticSeverity } from './core/Diagnostics';
export { Clock } from './core/Clock';
export type { IClockConfig, IClockState } from './core/Clock';
export { SpatialGrid } from './core/SpatialGrid';
export type { IRect } from './core/SpatialGrid';
export { ReactiveQuery } from './core/ReactiveQuery';
export type { QueryChanges, QueryChangeListener } from './core/ReactiveQuery';
export type { ISerializable } from './core/ISerializable';

// ---------------------------------------------------------------------------
// Sub-path re-exports
// ---------------------------------------------------------------------------
export * from './core/math/index';
export * from './events/index';
export * from './registry/index';
export * from './entity/index';
export * from './faction/index';
export * from './combat/index';
export * from './terrain/index';
export * from './movement/index';
export * from './spawn/index';
export * from './ai/index';
export * from './logger/index';
export * from './ports/index';
export * from './plugins/index';
export * from './schema/index';
export * from './config/index';
export * from './time/index';
export * from './navigation/index';
