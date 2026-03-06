/**
 * chessGameService.js
 *
 * Writes validated game state to the ChessGame contract on Somnia Testnet.
 * Emitting on-chain events enables Somnia Reactivity subscriptions on the
 * frontend to receive board updates without polling or Socket.IO.
 *
 * All write calls are fire-and-forget (no await at call sites) except
 * activateGame(), which is awaited once when the game first goes active so
 * the contract is ready before the first move arrives.
 */

const { ethers } = require("ethers");

const RPC_URL     = process.env.SOMNIA_RPC_URL     || "https://dream-rpc.somnia.network/";
const CONTRACT    = process.env.CHESS_GAME_CONTRACT_ADDRESS || null;
const COORDINATOR = process.env.COORDINATOR_PRIVATE_KEY     || null;

// Canonical draw sentinel matching the contract constant
const DRAW_ADDRESS = "0x000000000000000000000000000000000000dEaD";

const ABI = [
  "function createGame(bytes32 gameCode, address playerWhite) external",
  "function joinGame(bytes32 gameCode, address playerBlack) external",
  "function recordMove(bytes32 gameCode, uint8 fromRow, uint8 fromCol, uint8 toRow, uint8 toCol, bytes newBoardState, bool inCheck) external",
  "function recordDrawOffer(bytes32 gameCode, address offerer) external",
  "function endGame(bytes32 gameCode, address winner, string reason) external",
];

let provider = null;
let wallet   = null;
let contract = null;
let ready    = false;

function init() {
  if (!CONTRACT) {
    console.warn("[ChessGame] CHESS_GAME_CONTRACT_ADDRESS not set – on-chain tracking disabled");
    return;
  }
  if (!COORDINATOR) {
    console.warn("[ChessGame] COORDINATOR_PRIVATE_KEY not set – on-chain tracking disabled");
    return;
  }

  provider = new ethers.JsonRpcProvider(RPC_URL);
  wallet   = new ethers.Wallet(COORDINATOR, provider);
  contract = new ethers.Contract(CONTRACT, ABI, wallet);
  ready    = true;

  console.log("[ChessGame] Contract connected at", CONTRACT);
  console.log("[ChessGame] Coordinator wallet:", wallet.address);
}

/** Convert the string[][] board to 64 ASCII bytes for the contract. */
function boardToBytes(board) {
  const buf = Buffer.alloc(64);
  let i = 0;
  for (const row of board) {
    for (const cell of row) {
      buf[i++] = cell.charCodeAt(0);
    }
  }
  return buf;
}

/** Resolve "white" | "black" | "draw" to the on-chain winner address. */
function resolveWinnerAddress(winner, dbGame) {
  if (winner === "draw")  return DRAW_ADDRESS;
  if (winner === "white") return dbGame.player_white_address || ethers.ZeroAddress;
  if (winner === "black") return dbGame.player_black_address || ethers.ZeroAddress;
  return ethers.ZeroAddress;
}

/**
 * Called once when both players have joined (game goes active).
 * Awaited so the contract is initialised before the first move.
 */
async function activateGame(gameCode, playerWhiteAddress, playerBlackAddress) {
  if (!ready) return;
  const code = ethers.id(gameCode);
  try {
    const tx1 = await contract.createGame(code, playerWhiteAddress);
    await tx1.wait();
    const tx2 = await contract.joinGame(code, playerBlackAddress);
    await tx2.wait();
    console.log(`[ChessGame] ${gameCode} activated on-chain`);
  } catch (err) {
    console.error(`[ChessGame] activateGame failed for ${gameCode}:`, err.message);
    throw err; // propagate so caller can decide to continue anyway
  }
}

/** Fire-and-forget: record a validated move on-chain. */
async function recordMove(gameCode, from, to, board, inCheck) {
  if (!ready) return;
  try {
    const boardBytes = boardToBytes(board);
    await contract.recordMove(
      ethers.id(gameCode),
      from[0], from[1],
      to[0],   to[1],
      boardBytes,
      inCheck ?? false,
    );
  } catch (err) {
    console.error(`[ChessGame] recordMove failed for ${gameCode}:`, err.message);
  }
}

/** Fire-and-forget: record a draw offer on-chain. */
async function recordDrawOffer(gameCode, offererAddress) {
  if (!ready) return;
  try {
    await contract.recordDrawOffer(ethers.id(gameCode), offererAddress || ethers.ZeroAddress);
  } catch (err) {
    console.error(`[ChessGame] recordDrawOffer failed for ${gameCode}:`, err.message);
  }
}

/**
 * Fire-and-forget: end the game on-chain and settle the Reactivity event.
 * @param {string} gameCode  Human-readable game code
 * @param {object} dbGame    Full game row from Supabase (needs player addresses)
 * @param {string} winner    "white" | "black" | "draw"
 * @param {string} reason    "checkmate" | "resignation" | "stalemate" | "time" | "draw_agreed"
 */
async function endGame(gameCode, dbGame, winner, reason) {
  if (!ready) return;
  try {
    const winnerAddr = resolveWinnerAddress(winner, dbGame);
    await contract.endGame(ethers.id(gameCode), winnerAddr, reason || "");
    console.log(`[ChessGame] ${gameCode} ended on-chain – winner: ${winner}`);
  } catch (err) {
    console.error(`[ChessGame] endGame failed for ${gameCode}:`, err.message);
  }
}

module.exports = { init, activateGame, recordMove, recordDrawOffer, endGame };
