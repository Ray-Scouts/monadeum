import { toEventSelector, type Hex } from "viem";
import type { AccountAdmission, EventHandler } from "./types.js";

export class HandlerRegistryError extends Error {}

/** The set of handlers one indexer runs. Registration is checked so two handlers cannot write the same kind. */
export class HandlerRegistry {
  private readonly handlers: EventHandler[] = [];
  private gate: AccountAdmission | null = null;

  register(handler: EventHandler): this {
    if (this.handlers.some((h) => h.name === handler.name)) throw new HandlerRegistryError(`handler ${handler.name} is already registered`);
    if (handler.events.length === 0) throw new HandlerRegistryError(`handler ${handler.name} declares no events`);
    if (handler.kinds.length === 0) throw new HandlerRegistryError(`handler ${handler.name} declares no kinds`);
    for (const kind of handler.kinds) {
      const owner = this.handlers.find((h) => h.kinds.includes(kind));
      if (owner) throw new HandlerRegistryError(`kind ${kind} is already declared by handler ${owner.name}`);
    }
    this.handlers.push(handler);
    return this;
  }

  /** Sets the rule that admits discovered accounts. Its handler must be a `contract-by-account` source. */
  admitWith(admission: AccountAdmission): this {
    if (admission.handler.source.kind !== "contract-by-account") throw new HandlerRegistryError("an admission handler must be a contract-by-account source");
    this.gate = admission;
    return this;
  }

  admission(): AccountAdmission | null {
    return this.gate;
  }

  list(): readonly EventHandler[] {
    return this.handlers;
  }

  /** Handlers whose events can add accounts to the tracked set. They run first in every batch. */
  discovery(): EventHandler[] {
    return this.handlers.filter((h) => h.source.kind === "contract" && h.source.discoversAccounts === true);
  }

  /** Every other handler, run after discovery so an account found in a batch is followed in that same batch. */
  followers(): EventHandler[] {
    return this.handlers.filter((h) => !(h.source.kind === "contract" && h.source.discoversAccounts === true));
  }
}

export function selectors(handler: EventHandler): Hex[] {
  return handler.events.map((e) => toEventSelector(e));
}
