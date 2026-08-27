import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";
import { loadEnvFile } from "node:process";
import { migrate } from "drizzle-orm/libsql/migrator";

loadEnvFile();
export const db = drizzle(process.env.DB_FILE_NAME as string ?? "file:./data/data.sqlite", { schema });
await migrate(db, {migrationsFolder: process.env.MIGRATION_DIR ?? "./drizzle" as string});
