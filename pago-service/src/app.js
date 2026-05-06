import express from "express";
import cors from "cors";
import { testDB } from "./db.js";

const app = express();

app.use(cors());
app.use(express.json());

// LOG simple
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// TEST
app.get("/", (req, res) => {
  res.json({ message: "pa-service funcionando" });
});

// HEALTH DB
app.get("/health/db", async (req, res) => {
  try {
    await testDB();
    res.json({ status: "OK" });
  } catch (err) {
    res.status(500).json({ status: "ERROR", error: err.message });
  }
});

export default app;