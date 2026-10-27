FROM node:22.22.3-bookworm-slim AS build
WORKDIR /app
COPY shared ./shared
COPY schema ./schema
COPY player/package.json player/package-lock.json ./player/
RUN npm ci --prefix player
COPY player ./player
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL=
RUN VITE_SUPABASE_URL="$VITE_SUPABASE_URL" VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" VITE_API_URL="$VITE_API_URL" npm run --prefix player build
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server
COPY server ./server
RUN npm run --prefix server build && npm prune --prefix server --omit=dev

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /app
COPY ingest/requirements.txt ./ingest/requirements.txt
RUN pip install --no-cache-dir -r ingest/requirements.txt
COPY ingest ./ingest
COPY schema ./schema
COPY supabase/migrations ./supabase/migrations
COPY shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/player/dist ./player/dist
ENV HOST=0.0.0.0 PORT=3001 PYTHON_BIN=/usr/local/bin/python3
RUN useradd --create-home --uid 10001 paper
USER paper
EXPOSE 3001
CMD ["npm", "--prefix", "server", "start"]
