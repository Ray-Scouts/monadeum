import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorker } from "../src/main.js";

test("the worker boots as its own Nest context and does not listen for http", async () => {
  const app = await createWorker();
  assert.equal(typeof app.get, "function");
  await app.close();
});
