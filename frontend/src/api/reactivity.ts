import { SDK } from "@somnia-chain/reactivity";
import {
  createPublicClient,
  webSocket,
  defineChain,
  encodeFunctionData,
  decodeAbiParameters,
  hexToBytes,
  keccak256,
  toHex,
} from "viem";
import ChessGameABI from "../abi/ChessGame.json";

const SOMNIA_WS_URL =
  import.meta.env.VITE_SOMNIA_WS_URL || "wss://dream-rpc.somnia.network/ws";
const CONTRACT_ADDRESS = (
  import.meta.env.VITE_CHESS_GAME_CONTRACT_ADDRESS || ""
) as `0x${string}`;

const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "Somnia Token", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://dream-rpc.somnia.network/"],
      webSocket: [SOMNIA_WS_URL],
    },
  },
});

export interface ContractGame {
  playerWhite: string;
  playerBlack: string;
  board: string[][];
  currentTurn: "white" | "black";
  status: "pending" | "active" | "finished";
  inCheck: boolean;
  winner: string;
  drawOfferer: string;
  activeSince: number;
  endReason: string;
}

function decodeBoard(boardBytes: Uint8Array): string[][] {
  const board: string[][] = [];
  for (let r = 0; r < 8; r++) {
    const row: string[] = [];
    for (let c = 0; c < 8; c++) {
      row.push(String.fromCharCode(boardBytes[r * 8 + c]));
    }
    board.push(row);
  }
  return board;
}

const GAME_OUTPUT_ABI = [
  {
    type: "tuple" as const,
    components: [
      { name: "playerWhite", type: "address" as const },
      { name: "playerBlack", type: "address" as const },
      { name: "boardState", type: "bytes" as const },
      { name: "currentTurn", type: "uint8" as const },
      { name: "status", type: "uint8" as const },
      { name: "inCheck", type: "bool" as const },
      { name: "winner", type: "address" as const },
      { name: "drawOfferer", type: "address" as const },
      { name: "activeSince", type: "uint64" as const },
      { name: "endReason", type: "string" as const },
    ],
  },
] as const;

type RawGame = {
  playerWhite: string;
  playerBlack: string;
  boardState: `0x${string}`;
  currentTurn: number;
  status: number;
  inCheck: boolean;
  winner: string;
  drawOfferer: string;
  activeSince: bigint;
  endReason: string;
};

const STATUSES = ["pending", "active", "finished"] as const;

function parseSimulationResult(hex: `0x${string}`): ContractGame {
  const [g] = decodeAbiParameters(GAME_OUTPUT_ABI, hex) as [RawGame];
  const boardBytes = hexToBytes(g.boardState);
  return {
    playerWhite: g.playerWhite,
    playerBlack: g.playerBlack,
    board: decodeBoard(boardBytes),
    currentTurn: g.currentTurn === 0 ? "white" : "black",
    status: STATUSES[g.status] ?? "pending",
    inCheck: g.inCheck,
    winner: g.winner,
    drawOfferer: g.drawOfferer,
    activeSince: Number(g.activeSince),
    endReason: g.endReason,
  };
}

class ReactivityService {
  private sdk: SDK | null = null;
  private unsubFn: (() => void) | null = null;

  private getSDK(): SDK {
    if (!this.sdk) {
      const publicClient = createPublicClient({
        chain: somniaTestnet,
        transport: webSocket(SOMNIA_WS_URL),
      });
      this.sdk = new SDK({ publicClient });
    }
    return this.sdk;
  }

  subscribeToGame(
    gameCode: string,
    onUpdate: (game: ContractGame) => void,
    onError?: (err: unknown) => void,
  ): void {
    if (!CONTRACT_ADDRESS) return;
    this.unsubscribeFromGame();

    const gameCodeBytes32 = keccak256(toHex(gameCode));
    const callData = encodeFunctionData({
      abi: ChessGameABI,
      functionName: "getGame",
      args: [gameCodeBytes32],
    });

    const sdk = this.getSDK();
    const { unsubscribe } = sdk.subscribe({
      ethCalls: [{ to: CONTRACT_ADDRESS, data: callData as `0x${string}` }],
      eventContractSources: [CONTRACT_ADDRESS],
      onlyPushChanges: true,
      onData: (payload) => {
        const raw = payload.result.simulationResults[0];
        if (!raw) return;
        try {
          onUpdate(parseSimulationResult(raw as `0x${string}`));
        } catch (err) {
          onError?.(err);
        }
      },
      onError,
    });

    this.unsubFn = unsubscribe;
  }

  unsubscribeFromGame(): void {
    this.unsubFn?.();
    this.unsubFn = null;
  }
}

export const reactivityService = new ReactivityService();
