import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  buildShoppingList,
  generateDayPlan,
  generateWeekPlan,
} from "./planner.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/generate/day", async (req, res) => {
  try {
    const plan = await generateDayPlan(req.body);
    res.json(plan);
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/generate/week", async (req, res) => {
  try {
    const plan = await generateWeekPlan(req.body);
    res.json(plan);
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/shopping-list", (req, res) => {
  try {
    const { plan } = req.body || {};
    const list = buildShoppingList(plan);
    res.json({ list });
  } catch (err) {
    handleError(err, res);
  }
});

app.use((req, res) => {
  res.status(404).json({ message: "Not Found" });
});

app.use((err, req, res, next) => {
  // eslint-disable-line no-unused-vars
  handleError(err, res);
});

app.listen(PORT, () => {
  console.log(`NutriChat backend running on http://localhost:${PORT}`);
});

function handleError(err, res) {
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  const message =
    typeof err.message === "string" && err.message.length
      ? err.message
      : "伺服器發生錯誤，請稍後再試。";
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ message });
}

