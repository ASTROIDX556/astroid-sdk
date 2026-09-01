export interface ClientPlugin {
  name: string;
  install(client: any): void;
}

export type EventName = string;

export interface EventPayload<T extends EventName = EventName> {
  id: string;
  event: T;
  organizationId: string;
  createdAt: string;
  data: unknown;
}

export interface EventMap {
  [key: string]: {
    event: EventName;
    data: EventPayload;
  };
}
