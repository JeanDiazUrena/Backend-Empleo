import express from "express";
import cors from "cors";
import { testDB } from "./db.js";

const app = express();

app.use(cors());
app.use(express.json());

// Logger
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// Test
app.get("/", (req, res) => {
    res.json({ message: "perfile-service funcionando" });
});

// DB test
app.get("/health/db", async (req, res) => {
    try {
        await testDB();
        res.json({ status: "DB OK" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default app;