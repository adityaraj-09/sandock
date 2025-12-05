# Go Sandbox Agent
# Optimized image for Go execution

FROM node:20-alpine AS node-builder

WORKDIR /app
COPY sandbox-agent/package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM golang:1.22-alpine

RUN apk add --no-cache nodejs npm tini git && rm -rf /var/cache/apk/*

RUN addgroup -g 1001 -S sandbox && \
    adduser -u 1001 -S sandbox -G sandbox

WORKDIR /app

COPY --from=node-builder /app/node_modules ./node_modules
COPY sandbox-agent/package.json ./
COPY sandbox-agent/src ./src

RUN mkdir -p /app/data /home/sandbox/go && \
    chown -R sandbox:sandbox /app /home/sandbox

ENV NODE_ENV=production
ENV SANDBOX_LANGUAGE=go
ENV GOPATH=/home/sandbox/go
ENV GOCACHE=/home/sandbox/go/cache

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

LABEL maintainer="Insien <dev@insien.com>" \
      version="1.0.0" \
      description="Go Sandbox Agent"

USER sandbox

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
