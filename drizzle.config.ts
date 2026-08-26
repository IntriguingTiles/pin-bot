import { defineConfig } from "drizzle-kit";
import { loadEnvFile } from "node:process";

loadEnvFile();

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_FILE_NAME as string,
  },
});
