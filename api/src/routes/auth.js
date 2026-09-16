import { Router } from "express";
import { z } from "zod";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

export const authRouter = Router();

const credentials = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
});

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );
}

authRouter.post("/register", async (req, res, next) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: z.flattenError(parsed.error).fieldErrors });
  }

  const email = parsed.data.email.toLowerCase();

  try {
    const hash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
    const { rows } = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, hash]
    );
    res.status(201).json({ user: rows[0], token: signToken(rows[0]) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "email already registered" });
    }
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid credentials" });
  }

  const email = parsed.data.email.toLowerCase();

  try {
    const { rows } = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [email]
    );
    const user = rows[0];
    const ok = user && (await argon2.verify(user.password_hash, parsed.data.password));
    if (!ok) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    res.json({ user: { id: user.id, email: user.email }, token: signToken(user) });
  } catch (err) {
    next(err);
  }
});
