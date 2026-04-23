ARG BUILD_FROM
# hadolint ignore=DL3006
FROM ${BUILD_FROM} AS runtime

# BUILD_VERSION is injected by the HA Supervisor from config.yaml's `version:`
# field. We weave it into the git-clone RUN statement below so Docker's layer
# cache is invalidated on every addon version bump — without this the
# Supervisor happily reuses a stale layer that still contains pre-bugfix code.
ARG BUILD_VERSION=dev

# Git revision of the bridge source to build. Override via `build.yaml`'s
# `args:` map (e.g. pin to a release tag) or let Supervisor pass it in.
ARG SOURCE_REF=main
ARG SOURCE_REPO=https://github.com/simmikolon/datacake-homeassistant-mqtt-bridge.git

# Install Node.js, the toolchain `better-sqlite3` needs to build its native
# addon, and `tini` as PID 1 so signals land on the Node process correctly.
# `git` is required for the clone step below.
RUN apk add --no-cache \
      nodejs \
      npm \
      tini \
      git \
      ca-certificates \
      build-base \
      python3

# Fetch the exact bridge revision, install deps, build, and drop devDeps so
# the final image stays slim. Everything happens in a scratch directory that
# we wipe at the end.
WORKDIR /build
# hadolint ignore=DL3003
RUN echo "Cloning bridge sources for add-on v${BUILD_VERSION} from ${SOURCE_REF}" \
 && git clone --depth 1 --branch "${SOURCE_REF}" "${SOURCE_REPO}" source \
 && cd source \
 && npm ci \
 && npm run build \
 && npm prune --omit=dev \
 && mkdir -p /app \
 && cp -a dist /app/dist \
 && cp -a node_modules /app/node_modules \
 && cp package.json /app/package.json \
 && cd / \
 && rm -rf /build \
 # Strip the build toolchain now that the native addon is compiled; keep
 # nodejs + npm + tini for runtime.
 && apk del --purge git build-base python3

WORKDIR /app

ENV NODE_ENV=production \
    DB_PATH=/data/bridge.db \
    PORT=3000 \
    LOG_LEVEL=info \
    LOG_BUFFER_SIZE=500

# `/data` is the Supervisor-managed volume for persistent add-on state.
VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
