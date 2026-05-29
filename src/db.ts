import postgres from "postgres";
import { config } from "./config.js";

export const sql = config.DATABASE_URL
  ? postgres(config.DATABASE_URL, {
    max: 5,
    connect_timeout: 30,
    idle_timeout: 30,
    prepare: false,
    fetch_types: false,
    ssl: config.DATABASE_URL.includes("sslmode=require") ? "require" : false
  })
  : null;

export function requireDatabase(): postgres.Sql {
  if (!sql) {
    throw new Error("DATABASE_URL is required for voice flow audio cache");
  }
  return sql;
}
