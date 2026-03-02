// navigation/LevelGraph.ts
// Abstract 2D waypoint graph for offline NPC navigation.
//
// Vertices = named waypoints with (x, y) position and optional terrain tags.
// Edges    = directed connections with distance weight.
// Path     = A* search returning array of vertex IDs.

export interface IGraphVertex {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Terrain/location tags for path filtering (e.g. 'outdoor', 'indoor', 'danger') */
  readonly tags: ReadonlyArray<string>;
}

export interface IGraphEdge {
  readonly to: string;    // destination vertex ID
  readonly weight: number; // distance or cost (usually Euclidean distance)
}

// ---------------------------------------------------------------------------
// Serializable state shape for LevelGraph
// ---------------------------------------------------------------------------

export interface ILevelGraphState {
  vertices: Array<{ id: string; x: number; y: number; tags: string[] }>;
  edges: Array<{ from: string; edges: Array<{ to: string; weight: number }> }>;
}

/** Predicate to filter which vertices an NPC can traverse */
export type TerrainFilter = (vertex: IGraphVertex) => boolean;

// ---------------------------------------------------------------------------
// Min-heap for A* open set
// ---------------------------------------------------------------------------

interface HeapEntry {
  id: string;
  f: number;
}

/** Compact binary min-heap over HeapEntry sorted by f score. */
class MinHeap {
  private readonly data: HeapEntry[] = [];

  get size(): number { return this.data.length; }

  push(entry: HeapEntry): void {
    this.data.push(entry);
    this._bubbleUp(this.data.length - 1);
  }

  pop(): HeapEntry | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent].f <= this.data[i].f) break;
      const tmp = this.data[parent];
      this.data[parent] = this.data[i];
      this.data[i] = tmp;
      i = parent;
    }
  }

  private _sinkDown(i: number): void {
    const n = this.data.length;
    for (;;) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
      if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
      if (smallest === i) break;
      const tmp = this.data[smallest];
      this.data[smallest] = this.data[i];
      this.data[i] = tmp;
      i = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// LevelGraph
// ---------------------------------------------------------------------------

export class LevelGraph {
  private readonly _vertices = new Map<string, IGraphVertex>();
  private readonly _edges    = new Map<string, IGraphEdge[]>();

  // -------------------------------------------------------------------------
  // Graph construction
  // -------------------------------------------------------------------------

  /** Add a vertex. Overwrites if ID already exists. */
  addVertex(id: string, x: number, y: number, tags: string[] = []): this {
    this._vertices.set(id, { id, x, y, tags });
    if (!this._edges.has(id)) this._edges.set(id, []);
    return this;
  }

  /** Add a directed edge from → to. Weight defaults to Euclidean distance. */
  addEdge(from: string, to: string, weight?: number): this {
    const src = this._vertices.get(from);
    const dst = this._vertices.get(to);
    if (!src || !dst) return this;
    const w = weight ?? Math.sqrt((dst.x - src.x) ** 2 + (dst.y - src.y) ** 2);
    this._edges.get(from)!.push({ to, weight: w });
    return this;
  }

  /** Add an undirected edge (both directions). */
  addUndirectedEdge(a: string, b: string, weight?: number): this {
    this.addEdge(a, b, weight);
    this.addEdge(b, a, weight);
    return this;
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getVertex(id: string): IGraphVertex | undefined {
    return this._vertices.get(id);
  }

  getEdges(fromId: string): ReadonlyArray<IGraphEdge> {
    return this._edges.get(fromId) ?? [];
  }

  get vertexCount(): number { return this._vertices.size; }

  get edgeCount(): number {
    let n = 0;
    for (const edges of this._edges.values()) n += edges.length;
    return n;
  }

  /** Check if a vertex exists. */
  hasVertex(id: string): boolean {
    return this._vertices.has(id);
  }

  /** Returns all vertex IDs. */
  vertexIds(): IterableIterator<string> {
    return this._vertices.keys();
  }

  /** Returns an iterator over all IGraphVertex values. */
  vertices(): IterableIterator<IGraphVertex> {
    return this._vertices.values();
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  /** Remove a vertex, all its outgoing edges, and all incoming edges from other vertices. */
  removeVertex(id: string): this {
    this._vertices.delete(id);
    this._edges.delete(id);
    // Remove all incoming edges pointing to `id`
    for (const edges of this._edges.values()) {
      for (let i = edges.length - 1; i >= 0; i--) {
        if (edges[i].to === id) edges.splice(i, 1);
      }
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // Pathfinding
  // -------------------------------------------------------------------------

  /**
   * A* pathfinding using a binary min-heap for O(log n) open-set operations.
   *
   * Returns an array of vertex IDs from start to goal (inclusive), or null
   * if no path exists.
   *
   * @param filter - Optional predicate; vertices returning false are skipped.
   *   The start and goal vertices are never filtered out.
   */
  findPath(startId: string, goalId: string, filter?: TerrainFilter): string[] | null {
    if (startId === goalId) return [startId];
    if (!this._vertices.has(startId) || !this._vertices.has(goalId)) return null;

    const goal = this._vertices.get(goalId)!;

    const heuristic = (id: string): number => {
      const v = this._vertices.get(id)!;
      const dx = v.x - goal.x;
      const dy = v.y - goal.y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const gScore = new Map<string, number>();
    const cameFrom = new Map<string, string>();
    const closedSet = new Set<string>();

    const heap = new MinHeap();

    gScore.set(startId, 0);
    heap.push({ id: startId, f: heuristic(startId) });

    while (heap.size > 0) {
      const { id: current } = heap.pop()!;

      if (current === goalId) {
        // Reconstruct path — push+reverse is O(n) vs unshift which is O(n²)
        const path: string[] = [];
        let node: string | undefined = goalId;
        while (node !== undefined) {
          path.push(node);
          node = cameFrom.get(node);
        }
        path.reverse();
        return path;
      }

      if (closedSet.has(current)) continue;
      closedSet.add(current);

      const edges = this._edges.get(current);
      if (!edges) continue;

      for (const edge of edges) {
        if (closedSet.has(edge.to)) continue;

        const dst = this._vertices.get(edge.to);
        if (!dst) continue;

        // Start and goal are never filtered
        if (filter && edge.to !== goalId && !filter(dst)) continue;

        const tentativeG = (gScore.get(current) ?? Infinity) + edge.weight;
        if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, current);
          gScore.set(edge.to, tentativeG);
          heap.push({ id: edge.to, f: tentativeG + heuristic(edge.to) });
        }
      }
    }

    return null; // No path found
  }

  // -------------------------------------------------------------------------
  // Geometry helpers
  // -------------------------------------------------------------------------

  /**
   * Linear interpolation of world position along an edge.
   * t = 0 → fromVertex position, t = 1 → toVertex position.
   */
  interpolatePosition(fromId: string, toId: string, t: number): { x: number; y: number } {
    const from = this._vertices.get(fromId);
    const to   = this._vertices.get(toId);
    if (!from || !to) return { x: 0, y: 0 };
    const clamped = Math.max(0, Math.min(1, t));
    return {
      x: from.x + (to.x - from.x) * clamped,
      y: from.y + (to.y - from.y) * clamped,
    };
  }

  /**
   * Get edge weight between two directly connected vertices.
   * Returns Infinity if no direct edge exists.
   */
  edgeWeight(fromId: string, toId: string): number {
    const edges = this._edges.get(fromId);
    if (!edges) return Infinity;
    const edge = edges.find(e => e.to === toId);
    return edge?.weight ?? Infinity;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /** Serialize graph state for save/load. */
  serialize(): ILevelGraphState {
    return {
      vertices: Array.from(this._vertices.values()).map(v => ({
        id: v.id,
        x: v.x,
        y: v.y,
        tags: [...v.tags],
      })),
      edges: Array.from(this._edges.entries()).map(([from, edges]) => ({
        from,
        edges: edges.map(e => ({ to: e.to, weight: e.weight })),
      })),
    };
  }

  /** Restore a LevelGraph from serialized state (skips weight recalculation). */
  static restore(state: ILevelGraphState): LevelGraph {
    const graph = new LevelGraph();
    for (const v of state.vertices) {
      graph.addVertex(v.id, v.x, v.y, [...v.tags]);
    }
    for (const { from, edges } of state.edges) {
      const list = graph._edges.get(from);
      if (list) {
        for (const e of edges) {
          list.push({ to: e.to, weight: e.weight });
        }
      }
    }
    return graph;
  }
}
