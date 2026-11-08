FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/sdk/package.json packages/sdk/package.json
RUN pnpm install --frozen-lockfile
COPY . .

FROM base AS server
RUN pnpm --filter @hookrelay/server build
USER node
CMD ["pnpm", "--filter", "@hookrelay/server", "exec", "tsx", "src/index.ts"]

FROM base AS web
ENV API_URL=http://api:4000
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @hookrelay/web build
USER node
CMD ["pnpm", "--filter", "@hookrelay/web", "start"]
