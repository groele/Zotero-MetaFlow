import type { Disposable, DomainId } from "./types";

export type CommandOwnerId = DomainId | "kernel";

export interface CommandDefinition {
  readonly id: string;
  readonly owner: CommandOwnerId;
  readonly title: string;
  readonly action: (...args: any[]) => unknown | Promise<unknown>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly onError?: (id: string, error: unknown) => void;

  constructor(onError?: (id: string, error: unknown) => void) {
    this.onError = onError;
  }

  register(definition: CommandDefinition): Disposable {
    this.commands.set(definition.id, definition);
    let active = true;
    return () => {
      if (!active)
        return;
      active = false;
      if (this.commands.get(definition.id) === definition)
        this.commands.delete(definition.id);
    };
  }

  async execute<T = unknown>(id: string, ...args: unknown[]): Promise<T | undefined> {
    const cmd = this.commands.get(id);
    if (!cmd)
      return undefined;
    try {
      return (await cmd.action(...args)) as T;
    }
    catch (error) {
      this.onError?.(id, error);
      throw error;
    }
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  listIds(): string[] {
    return [...this.commands.keys()];
  }

  clear(): void {
    this.commands.clear();
  }
}
