# One process: the page and the room server, ready for a host such as Render (see render.yaml).
#   docker build -t pokeball .
#   docker run --rm -p 8787:8787 -v pokeball-leagues:/app/data/leagues pokeball
# The page (dist/index.html) is built and committed; the 3D models are fetched here from the
# release named in build/models3d.json.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund
COPY server ./server
COPY src ./src
COPY build ./build
COPY dist ./dist
RUN node build/fetch_models3d.mjs
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/index.js"]
