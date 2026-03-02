import { TerrainBuilder } from './TerrainBuilder';

describe('TerrainBuilder', () => {
  // -----------------------------------------------------------------------
  // Fluent API + build()
  // -----------------------------------------------------------------------
  describe('fluent API', () => {
    it('builds a valid SmartTerrainConfig with all options', () => {
      const config = new TerrainBuilder('bar_rostok')
        .name('Bar "Rostok"')
        .bounds({ x: 100, y: 200, width: 300, height: 300 })
        .capacity(8)
        .dangerLevel(3)
        .allowFactions(['stalkers', 'duty'])
        .shelter(true)
        .tags(['indoor', 'settlement'])
        .addJob({ type: 'guard', slots: 2, position: { x: 120, y: 210 } })
        .addSpawnPoint({ x: 110, y: 205, factionId: 'stalkers' })
        .addPatrolRoute({
          id: 'route1',
          routeType: 'loop',
          waypoints: [{ x: 100, y: 200 }, { x: 150, y: 250 }],
        })
        .build();

      expect(config.id).toBe('bar_rostok');
      expect(config.name).toBe('Bar "Rostok"');
      expect(config.bounds).toEqual({ x: 100, y: 200, width: 300, height: 300 });
      expect(config.capacity).toBe(8);
      expect(config.dangerLevel).toBe(3);
      expect(config.allowedFactions).toEqual(['stalkers', 'duty']);
      expect(config.isShelter).toBe(true);
      expect(config.tags).toEqual(['indoor', 'settlement']);
      expect(config.jobs).toHaveLength(1);
      expect(config.spawnPoints).toHaveLength(1);
      expect(config.patrolRoutes).toHaveLength(1);
    });

    it('returns minimal config when optional fields are omitted', () => {
      const config = new TerrainBuilder('t1')
        .name('Test')
        .bounds({ x: 0, y: 0, width: 10, height: 10 })
        .capacity(1)
        .build();

      expect(config.id).toBe('t1');
      expect(config.name).toBe('Test');
      expect(config.allowedFactions).toBeUndefined();
      expect(config.isShelter).toBeUndefined();
      expect(config.tags).toBeUndefined();
      expect(config.jobs).toBeUndefined();
      expect(config.spawnPoints).toBeUndefined();
      expect(config.patrolRoutes).toBeUndefined();
    });

    it('each chained call returns `this` for fluency', () => {
      const builder = new TerrainBuilder('t1');
      expect(builder.name('Test')).toBe(builder);
      expect(builder.bounds({ x: 0, y: 0, width: 10, height: 10 })).toBe(builder);
      expect(builder.capacity(1)).toBe(builder);
      expect(builder.dangerLevel(0)).toBe(builder);
      expect(builder.allowFactions([])).toBe(builder);
      expect(builder.shelter(false)).toBe(builder);
      expect(builder.tags([])).toBe(builder);
      expect(builder.addJob({ type: 'guard', slots: 1 })).toBe(builder);
      expect(builder.addSpawnPoint({ x: 0, y: 0, factionId: 'f' })).toBe(builder);
      expect(
        builder.addPatrolRoute({ id: 'r', routeType: 'loop', waypoints: [] }),
      ).toBe(builder);
    });
  });

  // -----------------------------------------------------------------------
  // Validation errors
  // -----------------------------------------------------------------------
  describe('validation', () => {
    it('throws when name is missing', () => {
      expect(() =>
        new TerrainBuilder('t1')
          .bounds({ x: 0, y: 0, width: 10, height: 10 })
          .capacity(1)
          .build(),
      ).toThrow('name is required');
    });

    it('throws when bounds is missing', () => {
      expect(() =>
        new TerrainBuilder('t1').name('Test').capacity(1).build(),
      ).toThrow('bounds is required');
    });

    it('throws when capacity is zero', () => {
      expect(() =>
        new TerrainBuilder('t1')
          .name('Test')
          .bounds({ x: 0, y: 0, width: 10, height: 10 })
          .build(), // capacity defaults to 0
      ).toThrow('capacity must be a positive number');
    });

    it('throws when capacity is set to a negative number', () => {
      expect(() =>
        new TerrainBuilder('t1').capacity(-1),
      ).toThrow('capacity must be non-negative');
    });

    it('throws when id is empty', () => {
      expect(() => new TerrainBuilder('')).toThrow('id must not be empty');
    });

    it('aggregates multiple validation errors', () => {
      expect(() => new TerrainBuilder('t1').build()).toThrow(
        /name is required.*bounds is required.*capacity must be a positive number/,
      );
    });
  });
});
