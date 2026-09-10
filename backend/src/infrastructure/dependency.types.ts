export type DependencyState =
  | 'uninitialized'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'degraded'
  | 'disconnecting';

export interface DependencyStatus {
  name: string;
  state: DependencyState;
  ready: boolean;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  consecutiveFailures: number;
}

export interface InfrastructureDependency {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): DependencyStatus;
}
