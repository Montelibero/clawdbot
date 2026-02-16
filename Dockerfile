FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable
ENV PNPM_CONFIG_LINK_WORKSPACE_PACKAGES=true

# Install uv/uvx (Astral) + webhook.site CLI
ENV UV_INSTALL_DIR=/usr/local/bin
RUN curl -fsSL https://astral.sh/uv/install.sh | sh && \
    npm install -g @webhooksite/cli

# Install system utilities and Python tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    jq \
    zip \
    unzip \
    sqlite3 \
    python3 \
    python3-pip \
    && pip3 install --break-system-packages --no-cache-dir csvkit \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install RTK (Rust Token Killer) for shell output compression
ARG RTK_VERSION=v0.18.0
RUN ARCH=$(dpkg --print-architecture) && \
    case "$ARCH" in \
      amd64) RTK_TARGET="x86_64-unknown-linux-gnu" ;; \
      arm64) RTK_TARGET="aarch64-unknown-linux-gnu" ;; \
      *) echo "RTK: unsupported arch $ARCH, skipping" && exit 0 ;; \
    esac && \
    curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/${RTK_VERSION}/rtk-${RTK_TARGET}.tar.gz" \
      | tar -xz -C /usr/local/bin rtk && \
    chmod +x /usr/local/bin/rtk

WORKDIR /app

ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
LABEL org.opencontainers.image.revision=$GIT_COMMIT

ARG CLAWDBOT_DOCKER_APT_PACKAGES=""
RUN if [ -n "$CLAWDBOT_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $CLAWDBOT_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY extensions/*/package.json ./extensions/
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
RUN node -e "const fs=require('fs');const p='extensions/telegram-user/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(j.devDependencies&&j.devDependencies.clawdbot){delete j.devDependencies.clawdbot;fs.writeFileSync(p,JSON.stringify(j,null,2));}" \
    && npm --prefix extensions/telegram-user install --omit=dev
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV CLAWDBOT_PREFER_PNPM=1
ENV CI=true
RUN pnpm -C ui install --prod --no-frozen-lockfile --ignore-workspace
RUN pnpm -C ui run build

ENV NODE_ENV=production

# Security hardening: Run as non-root user
# The node:22-bookworm image includes a 'node' user (uid 1000)
# This reduces the attack surface by preventing container escape via root privileges
USER node

CMD ["node", "dist/index.js"]
