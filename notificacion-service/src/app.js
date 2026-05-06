import express from "express";
import { testDB } from "./db.js";

const app = express();

app.use(express.json());

testDB();

export default app;