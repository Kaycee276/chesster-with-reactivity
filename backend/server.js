require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");

const gameRoutes = require("./routes/gameRoutes");
const escrowRoutes = require("./routes/escrowRoutes");
const timerService = require("./services/timerService");
const chessGameService = require("./services/chessGameService");
const escrowService = require("./services/escrowService");

const app = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: CORS_ORIGIN, methods: ["GET", "POST"] }));
app.use(express.json());

app.use("/api", gameRoutes);
app.use("/api/escrow", escrowRoutes);

app.get("/health", (_req, res) => {
	res.json({ status: "ok", message: "Chesster backend running" });
});

chessGameService.init();
escrowService.init();
timerService.init();

server.listen(PORT, "0.0.0.0", () => {
	console.log(`Chesster backend running on port ${PORT}`);
});
