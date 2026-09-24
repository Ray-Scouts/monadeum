import { Injectable, Module } from "@nestjs/common";
import { acceptQuote, acceptTokenField } from "./accept.js";

@Injectable()
export class ExternalService {
  quote(payload: unknown) {
    return acceptQuote(payload);
  }

  tokenField(value: unknown) {
    return acceptTokenField(value);
  }
}

@Module({
  providers: [ExternalService],
  exports: [ExternalService],
})
export class ExternalModule {}
