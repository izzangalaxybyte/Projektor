# Build: docker build -f deploy/Dockerfile -t projektor .   (context is the repo root)

# ---- build: compile the server and the web app -------------------------------------------
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY packages/api-contract/package.json packages/api-contract/
RUN pnpm install --frozen-lockfile
COPY server server
COPY web web
COPY packages packages
RUN pnpm --filter @projektor/server build \
 && pnpm --filter @projektor/web build \
 && pnpm --filter @projektor/server --prod deploy --legacy /out/server

# ---- runtime: Node + ffmpeg with Intel VAAPI drivers ---------------------------------------
FROM node:20-bookworm-slim AS runtime
# Intel's newer media driver is in non-free; the older i965 driver covers pre-Broadwell iGPUs.
# The Intel drivers only exist for amd64; an arm64 build (a Mac, for tests) gets ffmpeg alone.
RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libva-drm2 libva2 vainfo tini \
 && if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      apt-get install -y --no-install-recommends intel-media-va-driver-non-free i965-va-driver; \
    fi \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/server/dist ./dist
COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /out/server/package.json ./package.json
COPY --from=build /src/server/drizzle ./drizzle
COPY --from=build /src/web/dist ./web/dist
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8096 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    HARDWARE_ACCEL=auto \
    VAAPI_DEVICE=/dev/dri/renderD128 \
    LIBVA_DRIVER_NAME=iHD
VOLUME ["/data"]
EXPOSE 8096
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8096/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
