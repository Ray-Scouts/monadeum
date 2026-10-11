# One Dockerfile, several targets, built from the repository root (deploy/docker-compose.yml sets the context):
#
#   server   the compiled workspace; runs api, worker, indexer, or the migration step depending on the command
#   web      the Next.js app, built in api mode with the public build arguments below
#
# Base images are pinned by tag. Pinning them by digest as well is a hardening step listed in deploy/README.md.

FROM oven/bun:1.3.14 AS bun

FROM node:22.20.0-bookworm-slim AS deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

# Compiles every package the three server processes import, in dependency order (the order of the root test script).
FROM deps AS build-server
RUN set -eu; \
    for p in libs/commitment libs/recovery libs/fitness libs/reallocation libs/risk libs/wallets libs/auth \
             libs/reproduction libs/strategy libs/external libs/x402 libs/trading libs/tick libs/read-model \
             libs/agent-registry libs/db apps/worker apps/indexer apps/api; do \
      (cd "$p" && ./node_modules/.bin/tsc -p tsconfig.json); \
    done

FROM node:22.20.0-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app
# Owned by root and read-only to the node user: the server processes write nothing under /app.
COPY --from=build-server /app /app
# The vault volume is mounted here. A named volume takes this directory's owner and mode on first use, so the vault
# directory belongs to the node user (uid 1000) with mode 0700, which the file vault requires.
RUN install -d -o node -g node -m 0700 /var/lib/monadeum/vault
USER node
# The command is set per service in docker-compose.yml.
CMD ["node", "apps/api/dist/src/main.js"]

FROM deps AS build-web
ARG NEXT_PUBLIC_MONADEUM_DATA_SOURCE=api
ARG NEXT_PUBLIC_MONADEUM_API_URL
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL=USDC
ARG NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS=6
ENV NEXT_PUBLIC_MONADEUM_DATA_SOURCE=$NEXT_PUBLIC_MONADEUM_DATA_SOURCE \
    NEXT_PUBLIC_MONADEUM_API_URL=$NEXT_PUBLIC_MONADEUM_API_URL \
    NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL=$NEXT_PUBLIC_MONADEUM_SETTLEMENT_SYMBOL \
    NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS=$NEXT_PUBLIC_MONADEUM_SETTLEMENT_DECIMALS \
    NEXT_TELEMETRY_DISABLED=1
RUN bun run --filter @monadeum/web build

FROM node:22.20.0-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web
# Owned by the node user: next start writes its cache under .next.
COPY --from=build-web --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
