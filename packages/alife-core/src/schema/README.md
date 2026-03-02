# schema

Runtime validation helpers for raw game data — assertion functions, a validator factory, and pre-built validators for core SDK types.

```ts
import {
  assertDefined, assertString, assertNumber, assertNumberInRange,
  assertBoolean, assertArray, assertObject,
  createValidator,
  validateMonsterDefinition,
  validateFactionDefinition,
} from '@alife-sdk/core/schema';
import type { ValidationResult } from '@alife-sdk/core/schema';
```

---

## Concepts

### Two layers of validation

The SDK validates game data in two ways:

| Layer | Where | Behaviour |
|-------|-------|-----------|
| **Registry validation** | `Registry.register()` | Throws immediately on first error — fail-fast, best for programmatic data |
| **Schema validation** | `validateMonsterDefinition` / `validateFactionDefinition` | Collects **all** errors — best for JSON files loaded from disk or network |

Schema validators are intentionally **non-throwing** — they return a
`ValidationResult` you can inspect and report before deciding whether to abort.

### `ValidationResult`

```ts
type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };
```

---

## Assertion helpers

Assert functions narrow `unknown` to a concrete type and throw a descriptive
error immediately if the check fails. Use them at **system boundaries** —
when parsing external JSON, reading save data, or consuming untrusted input.

### `assertDefined(value, name)`

Throws if `value` is `null` or `undefined`.

```ts
assertDefined(config.spawnPoint, 'config.spawnPoint');
// Now TypeScript knows config.spawnPoint is not null/undefined
```

### `assertString(value, name)`

```ts
assertString(raw.factionId, 'factionId');
// raw.factionId is now typed as string
```

### `assertNumber(value, name)`

Rejects `NaN` in addition to wrong types.

```ts
assertNumber(raw.hp, 'hp');
```

### `assertNumberInRange(value, name, min, max)`

Combines `assertNumber` with a bounds check.

```ts
assertNumberInRange(raw.accuracy, 'accuracy', 0, 1);
assertNumberInRange(raw.rank, 'rank', 1, 5);
```

### `assertBoolean(value, name)`

```ts
assertBoolean(raw.isDay, 'isDay');
```

### `assertArray(value, name)`

```ts
assertArray(raw.abilities, 'abilities');
// raw.abilities is now unknown[]
```

### `assertObject(value, name)`

Rejects `null`, arrays, and primitives — accepts only plain objects.

```ts
assertObject(raw.lair, 'lair');
// raw.lair is now Record<string, unknown>
```

---

## `createValidator(name, rules)`

Factory that builds a reusable **non-throwing** validator from an array of
rule functions.

```ts
function createValidator<T>(
  name:  string,
  rules: Array<(input: unknown) => string | null>,
): (input: unknown) => ValidationResult
```

Each rule receives the raw input and returns:
- `null` — this rule passed
- `string` — error message for this rule

The validator runs **all rules** even after a failure — you get a complete
error list on the first call, not just the first problem.

### Example — custom validator

```ts
import { createValidator } from '@alife-sdk/core/schema';

const validateSpawnPoint = createValidator('SpawnPoint', [
  (input) => (input !== null && typeof input === 'object' ? null : 'must be an object'),
  (input) => {
    const o = input as Record<string, unknown>;
    if (typeof o.x !== 'number') return '"x" must be a number';
    return null;
  },
  (input) => {
    const o = input as Record<string, unknown>;
    if (typeof o.y !== 'number') return '"y" must be a number';
    return null;
  },
  (input) => {
    const o = input as Record<string, unknown>;
    if (typeof o.terrainId !== 'string') return '"terrainId" must be a string';
    return null;
  },
]);

const result = validateSpawnPoint(rawJson);
if (!result.valid) {
  console.error('Bad spawn point:', result.errors.join('\n'));
  return;
}
// proceed with rawJson as a valid spawn point
```

---

## `validateMonsterDefinition`

Pre-built validator for `IMonsterDefinition`. Validates the full shape of a
monster archetype as it would arrive from a JSON file.

```ts
const validateMonsterDefinition: (input: unknown) => ValidationResult
```

**Rules checked (all at once):**

- `input` is a plain object
- `name` — non-empty string
- `hp`, `speed`, `damage`, `attackRange`, `detectionRange` — positive numbers
- `fov` — number in (0, 360]
- `packSize` — `[min, max]` tuple, `min ≥ 1`, `min ≤ max`
- `abilities` — array
- `lair` — object with `inner < patrol < outer` (numbers)
- `rank` — number in [1, 5]
- `faction` — string if provided

### Usage

```ts
import { validateMonsterDefinition } from '@alife-sdk/core/schema';

// Loading from JSON file
const raw = await fetch('/data/monsters.json').then(r => r.json());

for (const [id, def] of Object.entries(raw)) {
  const result = validateMonsterDefinition(def);

  if (!result.valid) {
    console.error(`Monster "${id}" has ${result.errors.length} error(s):`);
    result.errors.forEach(e => console.error(' ', e));
    continue; // skip invalid entries
  }

  monsterRegistry.register(id, def as IMonsterDefinition);
}
```

---

## `validateFactionDefinition`

Pre-built validator for `IFactionDefinition`.

```ts
const validateFactionDefinition: (input: unknown) => ValidationResult
```

**Rules checked:**

- `input` is a plain object
- `name` — non-empty string
- `baseRelations` — object, each value in [-100, 100]
- `immunities` — object, each value in [0, 1]
- `defaultEquipment` — plain object if provided
- `spawnRules` — object with `targetRatio` and `balanceTolerance` as numbers

### Usage

```ts
import { validateFactionDefinition } from '@alife-sdk/core/schema';
import type { IFactionDefinition } from '@alife-sdk/core/registry';

const raw = await fetch('/data/factions.json').then(r => r.json());

for (const [id, def] of Object.entries(raw)) {
  const result = validateFactionDefinition(def);

  if (!result.valid) {
    logger.error('schema', `Faction "${id}" invalid`, { errors: result.errors });
    throw new Error(`Invalid faction data for "${id}"`);
  }

  factionRegistry.register(id, def as IFactionDefinition);
}
```

---

## Tips

**Validate JSON at the boundary, register after.**
Schema validators are for raw external data. Once you have a `valid: true`
result, cast and hand the object straight to the registry — the registry will
run its own checks too, but those are a safety net, not the primary gate.

**Assertions are for internal code, validators for external data.**
`assertNumber(x, 'x')` is a developer-facing guard — if it fires, it's a
programming error. `validateMonsterDefinition` is user-facing — if it fires,
the data file is wrong.

**Collect and display all errors before aborting.**
`ValidationResult.errors` is an array for a reason. Show all problems at
once so the data author doesn't have to fix-and-reload in a loop:

```ts
if (!result.valid) {
  throw new Error(
    `Invalid monster "${id}":\n` + result.errors.map(e => `  • ${e}`).join('\n')
  );
}
```
