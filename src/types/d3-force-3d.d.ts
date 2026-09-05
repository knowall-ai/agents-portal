// Minimal typings for d3-force-3d (the package ships none).
declare module 'd3-force-3d' {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }
  export interface SimulationLinkDatum<N extends SimulationNodeDatum> {
    source: N | string | number;
    target: N | string | number;
  }
  export interface Force<N extends SimulationNodeDatum> {
    (alpha: number): void;
    initialize?(nodes: N[], random?: () => number): void;
  }
  export interface Simulation<N extends SimulationNodeDatum, L extends SimulationLinkDatum<N>> {
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaTarget(target: number): this;
    alphaDecay(decay: number): this;
    velocityDecay(decay: number): this;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
    tick(iterations?: number): this;
    restart(): this;
    stop(): this;
    on(type: 'tick' | 'end', listener: (() => void) | null): this;
  }
  export interface ForceLink<
    N extends SimulationNodeDatum,
    L extends SimulationLinkDatum<N>,
  > extends Force<N> {
    links(): L[];
    links(links: L[]): this;
    id(fn: (node: N) => string): this;
    distance(d: number | ((link: L) => number)): this;
    strength(s: number | ((link: L) => number)): this;
  }
  export interface ForceManyBody<N extends SimulationNodeDatum> extends Force<N> {
    strength(s: number | ((node: N) => number)): this;
    distanceMax(d: number): this;
  }
  export interface ForceCenter<N extends SimulationNodeDatum> extends Force<N> {
    x(x: number): this;
    y(y: number): this;
    z(z: number): this;
    strength(s: number): this;
  }
  export interface ForceCollide<N extends SimulationNodeDatum> extends Force<N> {
    radius(r: number | ((node: N) => number)): this;
  }
  export function forceSimulation<N extends SimulationNodeDatum, L extends SimulationLinkDatum<N>>(
    nodes?: N[],
    numDimensions?: number
  ): Simulation<N, L>;
  export function forceLink<N extends SimulationNodeDatum, L extends SimulationLinkDatum<N>>(
    links?: L[]
  ): ForceLink<N, L>;
  export function forceManyBody<N extends SimulationNodeDatum>(): ForceManyBody<N>;
  export function forceCenter<N extends SimulationNodeDatum>(
    x?: number,
    y?: number,
    z?: number
  ): ForceCenter<N>;
  export function forceCollide<N extends SimulationNodeDatum>(
    radius?: number | ((node: N) => number)
  ): ForceCollide<N>;
}
