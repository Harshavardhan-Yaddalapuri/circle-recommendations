import express from "express";
import { pathToFileURL } from "node:url";
import { openDb } from "./db.js";
import { recommend } from "./recommend.js";

const MAX_LIMIT = 20;

export function createApp(db = openDb()) {
  const app = express();

  app.get("/users/:id/recommendations", (req, res) => {
    const id = Number(req.params.id);
    const limit = req.query.limit === undefined ? 5 : Number(req.query.limit);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "user id must be a positive integer" });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
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
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`Circle recommendations API on http://localhost:${port}`);
    console.log(`Try: curl http://localhost:${port}/users/7/recommendations`);
  });
}
