# Noren's API on the hackathon VPS: the settlement hub, the gas-station relay and the assistant proxy.
# Build context: the repo root (git archive of committed HEAD). Keys are mounted at run time, never built in.
FROM node:24-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY sdk/package.json sdk/
COPY hub/package.json hub/
COPY web/package.json web/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile --prod --filter "@noren-avax/hub..."
COPY sdk ./sdk
COPY hub ./hub
COPY deployments/fuji.json ./deployments/
ENV NODE_ENV=production NOREN_HOST=0.0.0.0 PORT=5370
EXPOSE 5370
CMD ["node", "hub/src/server.ts"]
