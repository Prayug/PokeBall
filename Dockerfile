# One process: the page and the room server. Build the page first (npm run build)
# so dist/ is in the image, then:
#   docker build -t pokeball .
#   docker run --rm -p 8787:8787 -v pokeball-leagues:/app/data/leagues pokeball
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY server ./server
COPY src ./src
COPY dist ./dist
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server/index.js"]
