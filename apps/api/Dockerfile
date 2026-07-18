# Build context: repository root (docker build -f apps/api/Dockerfile .)

ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
# Install only the api's dependency subgraph, build topologically, then
# produce a pruned production bundle with workspace deps included.
RUN pnpm install --frozen-lockfile --filter @flowhub/api...
RUN pnpm --filter @flowhub/api... run build
RUN pnpm --filter @flowhub/api deploy --legacy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 3001
# The same image serves as the migration job:
#   command: node node_modules/@flowhub/database/dist/migrate.js
CMD ["node", "dist/index.js"]
