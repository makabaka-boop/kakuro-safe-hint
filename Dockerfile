# 多阶段构建：Node 构建静态资源 -> nginx 提供 puzzle 页面（整站离线可用）
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build && npm test

FROM nginx:1.27-alpine AS runtime
# 单页应用（hash 路由），任何路径都返回 index.html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
