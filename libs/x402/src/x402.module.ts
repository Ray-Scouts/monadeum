import { Module } from "@nestjs/common";
import { X402Client } from "./client.js";

// The client needs deployment configuration (endpoints, settlement asset, network) and a Payer from the wallet layer,
// so the consuming app provides it: { provide: X402Client, useFactory: ... }.
@Module({})
export class X402Module {
  static forRoot(client: X402Client) {
    return { module: X402Module, providers: [{ provide: X402Client, useValue: client }], exports: [X402Client] };
  }
}
