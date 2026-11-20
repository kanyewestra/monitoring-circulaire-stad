FROM node:22-alpine
WORKDIR /app
COPY server.js model.json ./
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
