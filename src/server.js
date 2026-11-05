import express from "express";
import { pathToFileURL } from "node:url";
import { openDb } from "./db.js";
import { recommend } from "./recommend.js";

const MAX_LIMIT = 20;
// Number() alone would accept "7.0", "0x7" or "1e1"; only plain digits are allowed.
const isPositiveInt = (s) => typeof s === "string" && /^[1-9]\d*$/.test(s);

export function createApp(db = openDb()) {
  const app = express();

  app.get("/users/:id/recommendations", (req, res) => {
    const rawLimit = req.query.limit ?? "5";
    if (!isPositiveInt(req.params.id)) {
      return res.status(400).json({ error: "user id must be a positive integer" });
    }
    const id = Number(req.params.id);
    const limit = Number(rawLimit);
    if (!isPositiveInt(rawLimit) || limit > MAX_LIMIT) {
      return res.status(400).json({ error: `limit must be an integer from 1 to ${MAX_LIMIT}` });
    }
    const result = recommend(db, id, { limit });
    if (!result) return res.status(404).json({ error: `user ${id} not found` });
    res.json(result);
  });

  return app;
}

// Start only when run directly (`npm start`), not when imported by tests.
// pathToFileURL handles the spaces in this project's folder path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`Circle recommendations API on http://localhost:${port}`);
    console.log(`Try: curl http://localhost:${port}/users/7/recommendations`);
  });
}
