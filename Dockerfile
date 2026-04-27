FROM node:22-bookworm-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY README.md LICENSE ./
COPY docker ./docker

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7001 \
    DATA_DIR=/data \
    TMP_DIR=/data/tmp \
    TRANSLATION_DIR=/data/translations \
    CAT_LIBRARY_ROOT=/data/cat-library \
    UV_CACHE_DIR=/data/uv-cache \
    UV_PYTHON_INSTALL_DIR=/data/uv-python \
    UV_PROJECT_ENVIRONMENT=/data/cat-venv \
    UV_TORCH_BACKEND=cpu

RUN mkdir -p /data && chown -R node:node /app /data

VOLUME ["/data"]
EXPOSE 7001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 7001) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "docker/render-cat-configs.js"]
CMD ["node", "src/server.js"]
