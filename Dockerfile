FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4188
USER node
EXPOSE 4188
CMD ["npm", "start"]
