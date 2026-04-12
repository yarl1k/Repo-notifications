# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.14.1
ARG PNPM_VERSION=10.25.0

FROM node:${NODE_VERSION}-slim AS base

ENV CI=true

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

RUN npm install -g pnpm@${PNPM_VERSION}

################################################################################
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/backend/package.json ./app/backend/package.json
COPY app/backend/database ./app/backend/database
COPY app/backend/prisma.config.ts ./app/backend/prisma.config.ts

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --filter ./app/backend --frozen-lockfile

################################################################################
FROM deps AS build

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --filter ./app/backend --frozen-lockfile

COPY app/backend ./app/backend

WORKDIR /usr/src/app/app/backend
RUN pnpm exec prisma generate
RUN pnpm run build

################################################################################
FROM base AS final
ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY --chown=node:node pnpm-workspace.yaml ./
COPY --chown=node:node app/backend/package.json ./app/backend/package.json
COPY --chown=node:node app/backend/database ./app/backend/database
COPY --chown=node:node app/backend/prisma.config.ts ./app/backend/prisma.config.ts


COPY --chown=node:node app/backend/swagger.yaml ./app/backend/swagger.yaml
COPY --chown=node:node app/frontend ./app/frontend

COPY --from=deps --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=deps --chown=node:node /usr/src/app/app/backend/node_modules ./app/backend/node_modules
COPY --from=build --chown=node:node /usr/src/app/app/backend/dist ./app/backend/dist

USER node
EXPOSE 3000

CMD ["sh", "-c", "pnpm --filter ./app/backend exec prisma migrate deploy && pnpm --filter ./app/backend start"]