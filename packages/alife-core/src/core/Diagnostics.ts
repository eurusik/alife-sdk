// core/Diagnostics.ts
// Structured error/warning collector for kernel initialization.
//
// Instead of throwing on the first validation failure, the kernel collects
// all problems into a DiagnosticsCollector and returns it from init().
// This gives developers a complete picture of what's wrong — missing ports,
// unresolved plugin dependencies, config issues — in a single pass.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** A single diagnostic message produced during kernel validation. */
export interface IDiagnostic {
  /** How severe the problem is. Errors block init; warnings and infos do not. */
  readonly severity: DiagnosticSeverity;
  /** Origin of the diagnostic: `'kernel'`, a plugin name, or `'config'`. */
  readonly source: string;
  /** Dot-separated path to the problematic value (e.g. `'ports.pathfinder'`). */
  readonly path: string;
  /** Human-readable explanation of the problem. */
  readonly message: string;
  /** Optional suggestion for how to fix it (e.g. `'Did you mean "bandits"?'`). */
  readonly hint?: string;
}

// ---------------------------------------------------------------------------
// Validation error
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link DiagnosticsCollector.throwIfErrors} when at least one
 * diagnostic with severity `'error'` has been collected.
 */
export class ALifeValidationError extends Error {
  readonly diagnostics: readonly IDiagnostic[];

  constructor(diagnostics: readonly IDiagnostic[]) {
    super(`A-Life validation failed:\n${formatDiagnostics(diagnostics)}`);
    this.name = 'ALifeValidationError';
    this.diagnostics = diagnostics;
  }
}

// ---------------------------------------------------------------------------
// DiagnosticsCollector
// ---------------------------------------------------------------------------

/**
 * Accumulates diagnostics during kernel initialization.
 *
 * After all validation passes complete, call {@link throwIfErrors} to
 * either let execution continue (no errors) or throw a single
 * {@link ALifeValidationError} containing every collected problem.
 *
 * @example
 * ```ts
 * const diag = new DiagnosticsCollector();
 * diag.error('kernel', 'ports.entityAdapter', 'Required port not provided');
 * diag.warning('surge', 'config.surge.durationMs', 'Duration seems too short');
 * diag.throwIfErrors(); // throws ALifeValidationError
 * ```
 */
export class DiagnosticsCollector {
  private readonly items: IDiagnostic[] = [];

  /** Add a raw diagnostic entry. */
  add(diagnostic: IDiagnostic): void {
    this.items.push(diagnostic);
  }

  /** Shorthand: add an error diagnostic. */
  error(source: string, path: string, message: string, hint?: string): void {
    this.items.push({ severity: 'error', source, path, message, hint });
  }

  /** Shorthand: add a warning diagnostic. */
  warning(source: string, path: string, message: string, hint?: string): void {
    this.items.push({ severity: 'warning', source, path, message, hint });
  }

  /** Shorthand: add an informational diagnostic. */
  info(source: string, path: string, message: string, hint?: string): void {
    this.items.push({ severity: 'info', source, path, message, hint });
  }

  /** All error-severity diagnostics. */
  get errors(): IDiagnostic[] {
    return this.items.filter((d) => d.severity === 'error');
  }

  /** All warning-severity diagnostics. */
  get warnings(): IDiagnostic[] {
    return this.items.filter((d) => d.severity === 'warning');
  }

  /** All collected diagnostics in insertion order. */
  get all(): readonly IDiagnostic[] {
    return this.items;
  }

  /** `true` when at least one error-severity diagnostic exists. */
  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }

  /**
   * Throw {@link ALifeValidationError} if any errors were collected.
   * Safe to call when only warnings/infos are present — does nothing.
   */
  throwIfErrors(): void {
    if (this.hasErrors) {
      throw new ALifeValidationError(this.errors);
    }
  }

  /** Format all diagnostics as a human-readable multi-line string. */
  format(): string {
    return formatDiagnostics(this.items);
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const SEVERITY_ICON: Record<DiagnosticSeverity, string> = {
  error: 'ERROR',
  warning: 'WARN',
  info: 'INFO',
};

function formatDiagnostics(diagnostics: readonly IDiagnostic[]): string {
  return diagnostics
    .map((d) => {
      const prefix = `[${SEVERITY_ICON[d.severity]}] ${d.source} > ${d.path}`;
      const hint = d.hint ? `\n         hint: ${d.hint}` : '';
      return `  ${prefix}: ${d.message}${hint}`;
    })
    .join('\n');
}
