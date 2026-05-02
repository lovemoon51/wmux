import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 单元测试配置：node 环境覆盖 main + 渲染端纯函数
// 排除 e2e/smoke 脚本（它们在 scripts/ 下，由独立 npm script 运行）
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    reporters: ["default"]
  },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@renderer": fileURLToPath(new URL("./src/renderer/src", import.meta.url))
    }
  }
});
