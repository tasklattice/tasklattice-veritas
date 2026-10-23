# syntax=docker/dockerfile:1
ARG NODE_VERSION=22.22.0
# Native compression dependencies need a compiler fallback on ARM64.
FROM node:${NODE_VERSION}-bookworm AS build
WORKDIR /app
ENV npm_config_nodedir=/usr/local
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
COPY catalog ./catalog
COPY examples ./examples
RUN --mount=type=cache,target=/root/.npm \
    npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=38100 \
    XDG_CACHE_HOME=/var/lib/veritas/cache \
    NPM_CONFIG_CACHE=/var/lib/veritas/cache/npm \
    HF_HOME=/var/lib/veritas/cache/huggingface \
    PROMPTFOO_CONFIG_DIR=/var/lib/veritas/promptfoo \
    PROMPTFOO_DISABLE_TELEMETRY=1 \
    PROMPTFOO_DISABLE_UPDATE=1
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Runtime source files also provide frozen implementation fingerprints and
# promptfoo's TypeScript provider/assertion entry points.
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/catalog ./catalog
COPY --from=build /app/examples ./examples
COPY --chmod=755 scripts/container-entrypoint.sh /usr/local/bin/veritas-entrypoint
RUN mkdir -p /var/lib/veritas/data /var/lib/veritas/runs \
      /var/lib/veritas/cache /var/lib/veritas/promptfoo \
    && chown -R node:node /var/lib/veritas \
    && ln -s /var/lib/veritas/data data \
    && ln -s /var/lib/veritas/runs runs \
    && ln -s /var/lib/veritas/cache .cache \
    && ln -s /var/lib/veritas/promptfoo .promptfoo
USER node
EXPOSE 38100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["veritas-entrypoint"]
CMD ["node", "--import", "tsx", "src/server/main.ts"]
