import express from "express";
import { createServer } from "http";

async function startServer() {
  const app = express();
  const server = createServer(app);

  // 解析 JSON 请求体
  app.use(express.json());

  // 动态导入 API 路由
  const { default: apiRoutes } = await import("./server/routes.js");
  app.use(apiRoutes);

  const port = 3002;

  server.listen(port, () => {
    console.log(`Backend API server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
