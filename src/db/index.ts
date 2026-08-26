import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";
import { loadEnvFile } from "node:process";

loadEnvFile();
export const db = drizzle(process.env.DB_FILE_NAME as string, { schema });
