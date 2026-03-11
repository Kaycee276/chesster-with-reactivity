# Chesster — On-Chain Multiplayer Chess with Real-Time Reactivity

Chesster is a fully on-chain, two-player chess game built on **Somnia Testnet**. Players can create or join games, wager native **STT** tokens locked in a smart contract escrow, and see every move update in real time — powered by the **Somnia Reactivity SDK**.

**Live demo:** [chesster-lovat.vercel.app](https://chesster-lovat.vercel.app)

---

## How Somnia Reactivity Is Used

Reactivity is the core real-time layer of Chesster. Every time a move is recorded on-chain, the Reactivity SDK detects the state change and instantly pushes the new game state to both players' browsers — no WebSocket server, no polling, no trusted intermediary.

### Integration (`frontend/src/api/reactivity.ts`)

```ts
import { SDK } from "@somnia-chain/reactivity";

// One subscription per active game
const result = await sdk.subscribe({
  // Simulate getGame(gameCodeBytes32) on every block where the contract emits
  ethCalls: [{ to: CONTRACT_ADDRESS, data: callData }],
  // Only listen to events from the ChessGame contract
  eventContractSources: [CONTRACT_ADDRESS],
  // Skip blocks where state didn't change — no noise, pure signal
  onlyPushChanges: true,
  onData: (payload) => {
    // Decode ABI-encoded game struct → update React state instantly
    onUpdate(parseSimulationResult(payload.result.simulationResults[0]));
  },
});
```

### What gets pushed in real time

| Field | What it means in-game |
|---|---|
| `board` | Full 8×8 board — decoded from on-chain bytes |
| `currentTurn` | Whose turn it is (white / black) |
| `status` | `pending → active → finished` |
| `inCheck` | Whether the current player's king is in check |
| `winner` | Winner address (resolved to color client-side) |
| `drawOfferer` | Address that offered a draw |
| `activeSince` | Unix timestamp both clients use to sync the timer |

### Why Reactivity, not polling

The game also maintains a SQLite database as a source of truth for non-chain data (time control, wager status, etc.). The DB is polled every 3 seconds as a **resilience fallback** for escrow settlement and opponent-join detection. **Reactivity is the primary channel** for board state — it fires in near real-time on every on-chain state change, making the chess experience feel instant.

---

## Architecture

```
Chesster/
├── contracts/                  # Solidity — Foundry project
│   └── src/
│       ├── ChessGame.sol       # On-chain game state & move recording
│       └── ChessterEscrow.sol  # Native STT wager escrow
│
├── backend/                    # Node.js + Express coordinator
│   ├── server.js
│   ├── controllers/            # HTTP request handlers
│   ├── models/                 # SQLite game model + escrow settlement
│   ├── routes/                 # REST API routes
│   └── services/
│       ├── chessEngine.js      # Move validation (pure JS)
│       ├── chessGameService.js # On-chain move submission (ethers.js)
│       ├── escrowService.js    # resolveMatch / resolveAsDraw calls
│       └── timerService.js     # Turn timer enforcement
│
└── frontend/                   # React + TypeScript + Viem
    └── src/
        ├── api/
        │   ├── reactivity.ts   # Somnia Reactivity SDK integration
        │   └── gameApi.ts      # REST calls to backend
        ├── components/
        │   ├── ChessBoard.tsx  # Game UI + payout modal
        │   └── GameLobby.tsx   # Create / join + escrow deposit
        └── store/
            └── gameStore.ts    # Zustand store + Reactivity subscription
```

### How a move flows end-to-end

```
Player clicks square
  → Backend validates move (chessEngine.js)
  → Backend calls ChessGame.recordMove() on-chain
  → Somnia Reactivity detects contract state change
  → SDK pushes new game struct to both browsers
  → React state updates → board re-renders for both players
```

---

## Smart Contracts

Both contracts are deployed on **Somnia Testnet (Chain ID: 50312)**.

### `ChessGame.sol`
- Stores full game state on-chain: board (packed bytes), turn, status, winner, draw offer, captured pieces
- `recordMove()` — called by the coordinator wallet after server-side validation
- `getGame()` — the read function Reactivity simulates on every state change
- `activateGame()` — called when both players have joined; sets `activeSince` timestamp for timer sync

### `ChessterEscrow.sol`
- Native ETH (STT) escrow — no ERC-20 dependency
- `createMatch(gameCode)` — creator locks their wager; `payable`
- `joinMatch(gameCode)` — opponent matches the wager; `payable`
- `resolveMatch(gameCode, winner)` — coordinator sends 95% of pot to winner (5% protocol fee)
- `resolveAsDraw(gameCode)` — coordinator refunds both players in full

---

## Setup & Local Development

### Prerequisites
- Node.js 18+
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- A wallet with Somnia Testnet STT ([faucet](https://testnet.somnia.network))

### 1. Clone & install

```bash
git clone https://github.com/your-username/chesster.git
cd chesster
```

### 2. Deploy contracts

```bash
cd contracts
cp .env.example .env
# Set PRIVATE_KEY and SOMNIA_RPC_URL in .env

forge install
forge build

# Deploy ChessGame
forge script script/DeployChessGame.s.sol \
  --rpc-url https://dream-rpc.somnia.network/ \
  --broadcast

# Deploy ChessterEscrow
forge script script/DeployEscrow.s.sol \
  --rpc-url https://dream-rpc.somnia.network/ \
  --broadcast
```

### 3. Backend

```bash
cd backend
cp .env.example .env
# Fill in:
#   CHESS_GAME_CONTRACT_ADDRESS=0x...
#   ESCROW_CONTRACT_ADDRESS=0x...
#   COORDINATOR_PRIVATE_KEY=0x...      ← coordinator wallet (needs STT for gas)
#   SOMNIA_RPC_URL=https://dream-rpc.somnia.network/
#   CORS_ORIGIN=http://localhost:5173

npm install
npm run dev
# Runs on http://localhost:3000
```

### 4. Frontend

```bash
cd frontend
cp .env.example .env
# Fill in:
#   VITE_BACKEND_URL=http://localhost:3000/
#   VITE_CHESS_GAME_CONTRACT_ADDRESS=0x...
#   VITE_ESCROW_CONTRACT_ADDRESS=0x...
#   VITE_PROJECT_ID=your_reown_appkit_project_id
#   VITE_SOMNIA_WS_URL=wss://dream-rpc.somnia.network/ws

npm install
npm run dev
# Runs on http://localhost:5173
```

---

## How to Play

1. **Connect wallet** — MetaMask or any EIP-1193 wallet on Somnia Testnet
2. **Create a game** — choose time control (5–60 min), optionally enable a STT wager
   - With wager: confirm the `createMatch` transaction to lock your STT in escrow
3. **Share the game code** — opponent enters the code and joins (matching the wager if set)
4. **Play** — moves update in real time via Reactivity for both players
5. **Win / draw** — escrow automatically pays out the winner or refunds both players

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/games` | Create a new game |
| `POST` | `/api/games/:code/join` | Join as black |
| `GET` | `/api/games/:code` | Get game state |
| `POST` | `/api/games/:code/move` | Submit a move |
| `POST` | `/api/games/:code/resign` | Resign |
| `POST` | `/api/games/:code/draw` | Offer or accept a draw |
| `GET` | `/api/games/pending` | List open games in the lobby |

---

## Features

- Full chess move validation including castling, en passant, promotion
- Real-time board sync via Somnia Reactivity SDK (`onlyPushChanges: true`)
- Native STT wagering with on-chain escrow (95% to winner, draw = full refund)
- Turn timer with server-enforced timeout and client-side countdown
- Waiting screen for creator until opponent joins
- Payout modal with on-chain transaction link (Somnia Explorer)
- Draw offers, resign, in-check detection
- Sound effects and piece move animations

---

## Built With

- **Somnia Reactivity SDK** (`@somnia-chain/reactivity`) — real-time on-chain subscriptions
- **Solidity + Foundry** — smart contracts
- **React + TypeScript + Vite** — frontend
- **Zustand** — client state management
- **Viem + ethers.js** — chain interaction
- **Reown AppKit** — wallet connection
- **Node.js + Express + SQLite** — backend coordinator
