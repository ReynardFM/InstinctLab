# Queue worker image (stage 4): one container = one worker taking runs from Redis.
# Built and started by docker compose (compose.yaml); see README "Stage 4: queue + Docker".
# Node 22.18+ runs the TypeScript source directly, so there is no build step.
FROM node:22.22.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
USER node
CMD ["node", "src/queue/worker-main.ts"]
