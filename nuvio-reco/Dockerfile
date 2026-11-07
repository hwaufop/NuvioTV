FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json *.mjs ./
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV PORT=7000 HOST=0.0.0.0 DATA_DIR=/app/data
EXPOSE 7000
CMD ["node","server.mjs"]
