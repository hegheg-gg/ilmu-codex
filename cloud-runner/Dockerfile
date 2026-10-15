FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 4000

ENV PORT=4000
ENV ILMU_BASE_URL=https://api.ilmu.ai/v1

CMD ["node", "dist/server.js"]
