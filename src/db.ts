import postgres from "postgres";
import dns from "node:dns";
import { config } from "./config.js";

dns.setDefaultResultOrder("ipv4first");

export const sql = config.DATABASE_URL
  ? postgres(config.DATABASE_URL, {
    max: 5,
    connect_timeout: 30,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    prepare: false,
    fetch_types: false,
    ssl: "require",
    connection: {
      application_name: "voice-agent-service"
    }
  })
  : null;

export function requireDatabase(): postgres.Sql {
  if (!sql) {
    throw new Error("DATABASE_URL is required for voice flow audio cache");
  }
  return sql;
}
