FROM node:24-bookworm-slim AS installer

ARG TARGETARCH
ARG SIVITACODE_RELEASE=dsh-v0.1.0-rc.5-sivitacode.1
ARG SIVITACODE_VERSION=0.1.0-rc.5

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY deploy/install-sivitacode.mjs /tmp/install-sivitacode.mjs

# Build from the verified release rather than resolving the monorepo package graph
# again, so every installation route consumes identical product bytes.
RUN set -eu; \
  target_architecture=${TARGETARCH:-$(dpkg --print-architecture)}; \
  case "$target_architecture" in amd64) architecture=x64 ;; arm64) architecture=arm64 ;; *) echo "unsupported architecture: $target_architecture" >&2; exit 1 ;; esac; \
  base="https://github.com/Maggotxy/sivitacode/releases/download/$SIVITACODE_RELEASE"; \
  archive="sivitacode-server-$SIVITACODE_VERSION-linux-$architecture.tar.gz"; \
  curl --fail --location --retry 3 --output "/tmp/$archive" "$base/$archive"; \
  curl --fail --location --retry 3 --output "/tmp/$archive.sha256" "$base/$archive.sha256"; \
  node /tmp/install-sivitacode.mjs install --root /opt/sivitacode --archive "/tmp/$archive" --checksum "/tmp/$archive.sha256"

FROM node:24-bookworm-slim

ENV HOME=/var/lib/sivitacode \
  SIVITACODE_HOME=/var/lib/sivitacode \
  DSH_TELEMETRY_DISABLED=1

COPY --from=installer --chown=node:node /opt/sivitacode /opt/sivitacode
RUN mkdir -p /var/lib/sivitacode /workspace && chown node:node /var/lib/sivitacode /workspace

USER node
WORKDIR /workspace
VOLUME ["/var/lib/sivitacode"]
EXPOSE 3080

ENTRYPOINT ["/usr/local/bin/node", "/opt/sivitacode/current/node_modules/@deepseek-ai/dsh/lib/sivitacode.js"]
CMD ["web"]
