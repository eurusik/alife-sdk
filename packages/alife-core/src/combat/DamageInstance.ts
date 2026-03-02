/**
 * Value object representing a single damage event.
 *
 * Immutable by convention (all fields are readonly).
 * Created exclusively through the {@link createDamageInstance} factory
 * which validates that the amount is positive.
 */

export interface IDamageInstance {
  readonly amount: number;
  readonly damageTypeId: string;
  readonly sourceId: string;
  readonly sourceType: 'entity' | 'anomaly' | 'surge';
}

export interface IDamageInstanceParams {
  readonly amount: number;
  readonly damageTypeId: string;
  readonly sourceId: string;
  readonly sourceType: IDamageInstance['sourceType'];
}

/**
 * Factory that creates a validated IDamageInstance.
 *
 * @throws if amount is not positive
 */
export function createDamageInstance(params: IDamageInstanceParams): IDamageInstance {
  const { amount, damageTypeId, sourceId, sourceType } = params;

  if (amount <= 0) {
    throw new Error(
      `[DamageInstance] amount must be positive, got ${amount}`,
    );
  }

  return {
    amount,
    damageTypeId,
    sourceId,
    sourceType,
  };
}
