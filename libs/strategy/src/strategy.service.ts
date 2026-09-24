import { Injectable } from "@nestjs/common";
import { propose, type Action, type AgentView, type Quote } from "./propose.js";

@Injectable()
export class StrategyService {
  propose(state: AgentView, quote: Quote | null): Action | null {
    return propose(state, quote);
  }
}
