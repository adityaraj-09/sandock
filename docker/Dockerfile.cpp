# C/C++ Sandbox Agent
# Optimized image for C/C++ execution

FROM node:20-alpine AS node-builder

WORKDIR /app
COPY sandbox-agent/package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM alpine:3.19

RUN apk add --no-cache \
    nodejs \
    npm \
    tini \
    g++ \
    gcc \
    libc-dev \
    make \
    cmake \
    && rm -rf /var/cache/apk/*

RUN addgroup -g 1001 -S sandbox && \
    adduser -u 1001 -S sandbox -G sandbox

WORKDIR /app

COPY --from=node-builder /app/node_modules ./node_modules
COPY sandbox-agent/package.json ./
COPY sandbox-agent/src ./src

RUN mkdir -p /app/data && chown -R sandbox:sandbox /app

ENV NODE_ENV=production
ENV SANDBOX_LANGUAGE=cpp

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

LABEL maintainer="Insien <dev@insien.com>" \
      version="1.0.0" \
      description="C/C++ Sandbox Agent"

USER sandbox

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
