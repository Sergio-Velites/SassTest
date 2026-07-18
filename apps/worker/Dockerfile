# Build context: repository root (docker build -f apps/worker/Dockerfile .)

ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/worker ./apps/worker
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @flowhub/worker...
RUN pnpm --filter @flowhub/worker... run build
RUN pnpm --filter @flowhub/worker deploy --legacy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
CMD ["node", "dist/index.js"]
