require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const http    = require("http");

const gameRoutes   = require("./routes/gameRoutes");
const escrowRoutes = require("./routes/escrowRoutes");
const timerService = require("./services/timerService");
const chessGameService = require("./services/chessGameService");

const app    = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const PORT        = process.env.PORT        || 3000;

app.use(cors({ origin: CORS_ORIGIN, methods: ["GET", "POST"] }));
app.use(express.json());

app.use("/api",         gameRoutes);
app.use("/api/escrow",  escrowRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", message: "Chesster backend running" });
});

// Initialise on-chain services
chessGameService.init();
timerService.init();   // no longer needs Socket.IO – see timerService.js

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chesster backend running on port ${PORT}`);
});
