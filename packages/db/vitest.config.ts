import { defineConfig } from "vitest/config";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../apps/web/.env") });

export default defineConfig({
  test: {
    environment: "node",
  },
});
