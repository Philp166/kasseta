// Минимальные типы для yuka (в пакете нет собственных деклараций): только то, что реально используется в проекте.
declare module 'yuka' {
  export class Vector3 {
    x: number; y: number; z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    clone(): Vector3;
    add(v: Vector3): this;
    sub(v: Vector3): this;
    subVectors(a: Vector3, b: Vector3): this;
    addVectors(a: Vector3, b: Vector3): this;
    multiplyScalar(s: number): this;
    divideScalar(s: number): this;
    dot(v: Vector3): number;
    cross(v: Vector3): this;
    length(): number;
    squaredLength(): number;
    distanceTo(v: Vector3): number;
    squaredDistanceTo(v: Vector3): number;
    normalize(): this;
  }
  export class Quaternion {
    x: number; y: number; z: number; w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
    set(x: number, y: number, z: number, w: number): this;
    copy(q: Quaternion): this;
    clone(): Quaternion;
  }
  export class Telegram { sender: GameEntity; receiver: GameEntity; message: string; delay: number; data: unknown }
  export class GameEntity {
    name: string;
    active: boolean;
    position: Vector3;
    rotation: Quaternion;
    scale: Vector3;
    boundingRadius: number;
    neighbors: GameEntity[];
    neighborhoodRadius: number;
    updateNeighborhood: boolean;
    manager: EntityManager | null;
    forward: Vector3;
    up: Vector3;
    start(): this;
    update(delta: number): this;
    lookAt(target: Vector3): this;
    rotateTo(target: Vector3, delta: number, tolerance?: number): boolean;
    getDirection(result: Vector3): Vector3;
    handleMessage(telegram: Telegram): boolean;
  }
  export class MovingEntity extends GameEntity {
    velocity: Vector3;
    maxSpeed: number;
    updateOrientation: boolean;
    getSpeed(): number;
    getSpeedSquared(): number;
  }
  export class SteeringBehavior { active: boolean; weight: number }
  export class SteeringManager {
    behaviors: SteeringBehavior[];
    add(b: SteeringBehavior): this;
    remove(b: SteeringBehavior): this;
    clear(): this;
    calculate(delta: number, result: Vector3): Vector3;
  }
  export class Vehicle extends MovingEntity {
    mass: number;
    maxForce: number;
    steering: SteeringManager;
    smoother: unknown;
  }
  export class SeekBehavior extends SteeringBehavior { target: Vector3; constructor(target?: Vector3) }
  export class ArriveBehavior extends SteeringBehavior { target: Vector3; deceleration: number; tolerance: number; constructor(target?: Vector3, deceleration?: number, tolerance?: number) }
  export class FleeBehavior extends SteeringBehavior { target: Vector3; panicDistance: number; constructor(target?: Vector3, panicDistance?: number) }
  export class WanderBehavior extends SteeringBehavior { radius: number; distance: number; jitter: number; constructor(radius?: number, distance?: number, jitter?: number) }
  export class SeparationBehavior extends SteeringBehavior { constructor() }
  export class ObstacleAvoidanceBehavior extends SteeringBehavior { obstacles: GameEntity[]; brakingWeight: number; dBoxMinLength: number; constructor(obstacles?: GameEntity[]) }
  export class EntityManager {
    entities: GameEntity[];
    add(e: GameEntity): this;
    remove(e: GameEntity): this;
    clear(): this;
    update(delta: number): this;
  }
  export class State<T = unknown> {
    enter(owner: T): void;
    execute(owner: T): void;
    exit(owner: T): void;
    onMessage(owner: T, telegram: Telegram): boolean;
  }
  export class StateMachine<T = unknown> {
    owner: T;
    currentState: State<T> | null;
    previousState: State<T> | null;
    globalState: State<T> | null;
    states: Map<string, State<T>>;
    constructor(owner?: T);
    update(): this;
    add(id: string, state: State<T>): this;
    remove(id: string): this;
    get(id: string): State<T> | undefined;
    changeTo(id: string): this;
    revert(): this;
    in(state: State<T>): boolean;
  }
  export class Vision {
    owner: GameEntity;
    fieldOfView: number;
    range: number;
    obstacles: GameEntity[];
    constructor(owner?: GameEntity | null);
    visible(point: Vector3): boolean;
  }
  export class MemoryRecord { entity: GameEntity; timeBecameVisible: number; timeLastSensed: number; lastSensedPosition: Vector3; visible: boolean }
  export class MemorySystem {
    records: MemoryRecord[];
    memorySpan: number;
    constructor(owner?: GameEntity | null);
    getRecord(entity: GameEntity): MemoryRecord | null;
    createRecord(entity: GameEntity): this;
    deleteRecord(entity: GameEntity): this;
    hasRecord(entity: GameEntity): boolean;
    clear(): this;
  }
  export class Regulator { constructor(updateFrequency?: number); ready(): boolean }
  export class Time { constructor(); update(): this; getDelta(): number; getElapsed(): number }
  // Нечёткая логика
  export class FuzzySet { constructor(representativeValue?: number); degreeOfMembership: number }
  export class LeftShoulderFuzzySet extends FuzzySet { constructor(left?: number, midpoint?: number, right?: number) }
  export class TriangularFuzzySet extends FuzzySet { constructor(left?: number, midpoint?: number, right?: number) }
  export class RightShoulderFuzzySet extends FuzzySet { constructor(left?: number, midpoint?: number, right?: number) }
  export class FuzzyVariable { add(set: FuzzySet): this }
  export class FuzzyTerm {}
  export class FuzzyAND extends FuzzyTerm { constructor(...terms: Array<FuzzyTerm | FuzzySet>) }
  export class FuzzyOR extends FuzzyTerm { constructor(...terms: Array<FuzzyTerm | FuzzySet>) }
  export class FuzzyRule { constructor(antecedent?: FuzzyTerm | FuzzySet | null, consequence?: FuzzyTerm | FuzzySet | null) }
  export class FuzzyModule {
    static DEFUZ_TYPE: { MAXAV: number; CENTROID: number };
    addFLV(name: string, flv: FuzzyVariable): this;
    addRule(rule: FuzzyRule): this;
    fuzzify(name: string, value: number): this;
    defuzzify(name: string, type?: number): number;
  }
}
