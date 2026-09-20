import pg from "pg";
import { errText } from "./errText.js"; 

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

pool.on("error", (err) => {
  console.error("Postgres idle client error:", errText(err)); 
});