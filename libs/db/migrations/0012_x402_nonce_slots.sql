-- X402Module: nonce slots of the x402 payer (ARCHITECTURE.md section 16.3, x402 signature path).
--
-- X402PaymentValidator derives every EIP-3009 nonce from (account, hour of validAfter, slot), and USDC accepts each
-- nonce once. The payer claims a slot here, durably, before it signs, so a slot is never signed for twice:
-- - the primary key makes (account, epoch, slot) a once-only claim;
-- - `payment_key` is unique, so one purchase holds at most one slot;
-- - (account, nonce) is unique, so monitoring maps an on-chain AuthorizationUsed event back to exactly one payment.
-- No role may UPDATE or DELETE a claim: a slot, once claimed, is never reused or released.

CREATE TABLE x402_nonce_slots (
  account_key   text NOT NULL CHECK (account_key ~ '^0x[0-9a-f]{40}$'),
  epoch         numeric(78, 0) NOT NULL CHECK (epoch >= 0),
  slot          integer NOT NULL CHECK (slot >= 0),
  nonce_key     text NOT NULL CHECK (nonce_key ~ '^0x[0-9a-f]{64}$'),
  payment_key   text NOT NULL UNIQUE,
  body          jsonb NOT NULL,
  PRIMARY KEY (account_key, epoch, slot),
  UNIQUE (account_key, nonce_key)
);

REVOKE ALL ON x402_nonce_slots FROM PUBLIC;
GRANT SELECT, INSERT ON x402_nonce_slots TO monadeum_worker;
GRANT SELECT ON x402_nonce_slots TO monadeum_reader, monadeum_indexer;
