import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect } from "react";
import { api } from "../api/gameApi";
import { reactivityService } from "../api/reactivity";
import type { ContractGame } from "../api/reactivity";
import { useToastStore } from "./toastStore";
import { getCapturedPieces } from "../utils/chessUtils";
import type { GameState } from "../types/game";

// ── Module-level local countdown timer ────────────────────────────────────────
let _timerInterval: ReturnType<typeof setInterval> | null = null;

function startLocalTimer() {
  if (_timerInterval !== null) return; // already running
  _timerInterval = setInterval(() => {
    useGameStore.setState((s) => {
      if (s.status !== "active") return s;
      return { secondsLeft: Math.max(0, s.secondsLeft - 1) };
    });
  }, 1000);
}

function stopLocalTimer() {
  if (_timerInterval !== null) {
    clearInterval(_timerInterval);
    _timerInterval = null;
  }
}

// ── Address helpers ────────────────────────────────────────────────────────────
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const DRAW_ADDR = "0x000000000000000000000000000000000000dEaD";

function addrToColor(
  addr: string,
  whiteAddr: string,
  blackAddr: string,
): "white" | "black" | "draw" | null {
  if (!addr || addr === ZERO_ADDR) return null;
  if (addr.toLowerCase() === DRAW_ADDR.toLowerCase()) return "draw";
  if (whiteAddr && addr.toLowerCase() === whiteAddr.toLowerCase()) return "white";
  if (blackAddr && addr.toLowerCase() === blackAddr.toLowerCase()) return "black";
  return null;
}

// ── Store types ───────────────────────────────────────────────────────────────
interface GameStore {
  gameCode: string | null;
  playerColor: "white" | "black" | null;
  playerAddress: string | null;
  board: string[][];
  currentTurn: "white" | "black";
  status: string;
  inCheck?: boolean;
  winner?: string | null;
  endReason?: string | null;
  drawOffer?: string | null;
  turnStartedAt?: string | null;
  secondsLeft: number;
  timeControlSeconds: number;
  capturedWhite?: string[];
  capturedBlack?: string[];
  lastMove?: {
    from: [number, number];
    to: [number, number];
    piece: string;
  } | null;
  selectedSquare: [number, number] | null;
  // Escrow / wager info
  wagerAmount?: number | string | null;
  tokenAddress?: string | null;
  escrowStatus?: string | null;
  escrowCreateTx?: string | null;
  escrowJoinTx?: string | null;
  escrowResolveTx?: string | null;

  createGame: (
    walletAddress: string,
    wagerAmount?: string,
    timeControlSeconds?: number,
  ) => Promise<void>;
  joinGame: (code: string, color: "white" | "black", walletAddress: string) => Promise<void>;
  rejoinGame: (code: string) => Promise<void>;
  fetchGameState: () => Promise<void>;
  makeMove: (
    from: [number, number],
    to: [number, number],
    promotion?: string,
  ) => Promise<void>;
  selectSquare: (pos: [number, number] | null) => void;
  updateGameState: (data: GameState) => void;
  resignGame: () => Promise<void>;
  offerDraw: () => Promise<void>;
  acceptDraw: () => Promise<void>;
  leaveGame: () => void;
  reset: () => void;
}

// ── Reactivity subscription setup ─────────────────────────────────────────────
async function subscribeReactivity(gameCode: string) {
  await reactivityService.subscribeToGame(
    gameCode,
    (contractGame: ContractGame) => {
      const { timeControlSeconds } = useGameStore.getState();
      const winner = addrToColor(
        contractGame.winner,
        contractGame.playerWhite,
        contractGame.playerBlack,
      );
      const drawOffer = addrToColor(
        contractGame.drawOfferer,
        contractGame.playerWhite,
        contractGame.playerBlack,
      );
      const capturedWhite = getCapturedPieces(contractGame.board, "white");
      const capturedBlack = getCapturedPieces(contractGame.board, "black");

      useGameStore.setState({
        board: contractGame.board,
        currentTurn: contractGame.currentTurn,
        status: contractGame.status,
        inCheck: contractGame.inCheck,
        winner: winner ?? null,
        endReason: contractGame.endReason || null,
        drawOffer: drawOffer ?? null,
        capturedWhite,
        capturedBlack,
      });

      if (contractGame.status === "active" && contractGame.activeSince > 0) {
        const elapsed = Math.floor(Date.now() / 1000 - contractGame.activeSince);
        useGameStore.setState({
          secondsLeft: Math.max(0, timeControlSeconds - elapsed),
        });
        startLocalTimer();
      }

      if (contractGame.status === "finished") {
        stopLocalTimer();
      }
    },
    (err) => {
      console.warn("[Reactivity] subscription error:", err);
    },
  );
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      gameCode: null,
      playerColor: null,
      playerAddress: null,
      board: [],
      currentTurn: "white",
      status: "",
      inCheck: false,
      winner: null,
      endReason: null,
      drawOffer: null,
      turnStartedAt: null,
      secondsLeft: 600,
      timeControlSeconds: 600,
      capturedWhite: [],
      capturedBlack: [],
      lastMove: null,
      selectedSquare: null,
      wagerAmount: null,
      tokenAddress: null,
      escrowStatus: null,
      escrowCreateTx: null,
      escrowJoinTx: null,
      escrowResolveTx: null,

      createGame: async (
        walletAddress: string,
        wagerAmount?: string,
        timeControlSeconds?: number,
      ) => {
        const data = await api.createGame("chess", walletAddress, wagerAmount, timeControlSeconds);
        if (data.success) {
          await get().joinGame(data.data.game_code, "white", walletAddress);
        } else {
          throw new Error(data.error || "Failed to create game");
        }
      },

      joinGame: async (code: string, color: "white" | "black", walletAddress: string) => {
        const data = await api.joinGame(code, color, walletAddress);
        if (data.success) {
          set({ gameCode: code, playerColor: color, playerAddress: walletAddress });
          await get().fetchGameState();

          await subscribeReactivity(code);

          if (get().status === "active") {
            startLocalTimer();
          }
        } else {
          throw new Error(data.error);
        }
      },

      rejoinGame: async (code: string) => {
        const { playerColor } = get();
        if (!playerColor) return;

        const data = await api.getGame(code);
        if (data.success) {
          const tcs = data.data.time_control_seconds ?? 600;
          set({
            gameCode: code,
            board: data.data.board_state,
            currentTurn: data.data.current_turn,
            status: data.data.status,
            inCheck: data.data.in_check ?? false,
            winner: data.data.winner ?? null,
            drawOffer: data.data.draw_offer ?? null,
            turnStartedAt: data.data.turn_started_at ?? null,
            secondsLeft: tcs,
            timeControlSeconds: tcs,
            capturedWhite: data.data.captured_white ?? [],
            capturedBlack: data.data.captured_black ?? [],
            lastMove: data.data.last_move ?? null,
            wagerAmount: data.data.wager_amount ?? null,
            tokenAddress: data.data.token_address ?? null,
            escrowStatus: data.data.escrow_status ?? null,
            escrowCreateTx: data.data.escrow_create_tx ?? null,
            escrowJoinTx: data.data.escrow_join_tx ?? null,
            escrowResolveTx: data.data.escrow_resolve_tx ?? null,
          });

          await subscribeReactivity(code);

          if (data.data.status === "active") {
            startLocalTimer();
          }
        } else {
          throw new Error(data.error);
        }
      },

      fetchGameState: async () => {
        const { gameCode } = get();
        if (!gameCode) return;

        const data = await api.getGame(gameCode);
        if (data.success) {
          const tcs = data.data.time_control_seconds ?? 600;
          set({
            board: data.data.board_state,
            currentTurn: data.data.current_turn,
            status: data.data.status,
            inCheck: data.data.in_check ?? false,
            winner: data.data.winner ?? null,
            drawOffer: data.data.draw_offer ?? null,
            turnStartedAt: data.data.turn_started_at ?? null,
            secondsLeft: tcs,
            timeControlSeconds: tcs,
            capturedWhite: data.data.captured_white ?? [],
            capturedBlack: data.data.captured_black ?? [],
            lastMove: data.data.last_move ?? null,
            wagerAmount: data.data.wager_amount ?? null,
            tokenAddress: data.data.token_address ?? null,
            escrowStatus: data.data.escrow_status ?? null,
            escrowCreateTx: data.data.escrow_create_tx ?? null,
            escrowJoinTx: data.data.escrow_join_tx ?? null,
            escrowResolveTx: data.data.escrow_resolve_tx ?? null,
          });
        }
      },

      makeMove: async (
        from: [number, number],
        to: [number, number],
        promotion?: string,
      ) => {
        const { gameCode } = get();
        if (!gameCode) return;

        const data = await api.makeMove(gameCode, from, to, promotion);
        if (data.success) {
          set({
            board: data.data.board_state,
            currentTurn: data.data.current_turn,
            status: data.data.status,
            inCheck: data.data.in_check ?? false,
            winner: data.data.winner ?? null,
            drawOffer: data.data.draw_offer ?? null,
            turnStartedAt: data.data.turn_started_at ?? null,
            capturedWhite: data.data.captured_white ?? [],
            capturedBlack: data.data.captured_black ?? [],
            lastMove: data.data.last_move ?? null,
            selectedSquare: null,
          });
          if (data.data.status !== "active") {
            stopLocalTimer();
          }
        } else {
          throw new Error(data.error);
        }
      },

      updateGameState: (data: GameState) => {
        set({
          board: data.board_state,
          currentTurn: data.current_turn,
          status: data.status,
          inCheck: data.in_check ?? false,
          winner: data.winner ?? null,
          drawOffer: data.draw_offer ?? null,
          turnStartedAt: data.turn_started_at ?? null,
          capturedWhite: data.captured_white ?? [],
          capturedBlack: data.captured_black ?? [],
          lastMove: data.last_move ?? null,
          wagerAmount: data.wager_amount ?? null,
          tokenAddress: data.token_address ?? null,
          escrowStatus: data.escrow_status ?? null,
          escrowCreateTx: data.escrow_create_tx ?? null,
          escrowJoinTx: data.escrow_join_tx ?? null,
          escrowResolveTx: data.escrow_resolve_tx ?? null,
        });
      },

      selectSquare: (pos: [number, number] | null) =>
        set({ selectedSquare: pos }),

      resignGame: async () => {
        const { gameCode, playerColor } = get();
        if (!gameCode || !playerColor) return;
        const data = await api.resignGame(gameCode, playerColor);
        if (data.success) {
          stopLocalTimer();
          set({ status: data.data.status });
        }
      },

      offerDraw: async () => {
        const { gameCode, playerColor, playerAddress } = get();
        if (!gameCode || !playerColor) return;
        const data = await api.offerDraw(gameCode, playerColor, playerAddress ?? undefined);
        if (data.success) {
          set({ status: data.data.status, drawOffer: data.data.draw_offer ?? null });
        }
      },

      acceptDraw: async () => {
        const { gameCode } = get();
        if (!gameCode) return;
        const data = await api.acceptDraw(gameCode);
        if (data.success) {
          stopLocalTimer();
          set({ status: data.data.status });
        }
      },

      leaveGame: () => {
        stopLocalTimer();
        reactivityService.unsubscribeFromGame();
        set({
          gameCode: null,
          playerColor: null,
          playerAddress: null,
          board: [],
          currentTurn: "white",
          status: "",
          secondsLeft: 600,
          timeControlSeconds: 600,
          selectedSquare: null,
          wagerAmount: null,
          tokenAddress: null,
          escrowStatus: null,
          escrowCreateTx: null,
          escrowJoinTx: null,
          escrowResolveTx: null,
        });
      },

      reset: () => {
        get().leaveGame();
      },
    }),
    {
      name: "chesster-game",
      partialize: (state) => ({
        gameCode: state.gameCode,
        playerColor: state.playerColor,
      }),
    },
  ),
);

// ── Game notification hook ────────────────────────────────────────────────────
export const useGameNotifications = () => {
  const addToast = useToastStore((s) => s.addToast);
  const status = useGameStore((s) => s.status);
  const winner = useGameStore((s) => s.winner);
  const endReason = useGameStore((s) => s.endReason);
  const playerColor = useGameStore((s) => s.playerColor);
  const inCheck = useGameStore((s) => s.inCheck);
  const currentTurn = useGameStore((s) => s.currentTurn);
  const drawOffer = useGameStore((s) => s.drawOffer);
  const wagerAmount = useGameStore((s) => s.wagerAmount);
  const escrowStatus = useGameStore((s) => s.escrowStatus);
  const fetchGameState = useGameStore((s) => s.fetchGameState);

  useEffect(() => {
    if (status !== "finished") return;

    const won = winner === playerColor;
    const isDraw = winner === "draw";

    if (isDraw) {
      const msg =
        endReason === "stalemate"   ? "Draw by stalemate!" :
        endReason === "draw_agreed" ? "Draw agreed — well played!" :
        endReason === "time"        ? "Time's up — equal material, it's a draw!" :
        "Game ended in a draw!";
      addToast(msg, "info");
    } else if (won) {
      const msg =
        endReason === "checkmate"   ? "You won by checkmate!" :
        endReason === "resignation" ? "You won — opponent resigned!" :
        endReason === "time"        ? "Time's up — you had more material!" :
        "You won!";
      addToast(msg, "success");
    } else {
      const msg =
        endReason === "checkmate"   ? "You lost by checkmate." :
        endReason === "resignation" ? "You resigned." :
        endReason === "time"        ? "Time's up — opponent had more material." :
        "You lost.";
      addToast(msg, "error");
    }
  }, [status, winner, endReason, playerColor, addToast]);

  // Poll for escrow settlement every 3 s until settled or failed
  useEffect(() => {
    if (status !== "finished" || !wagerAmount) return;
    if (escrowStatus === "settled" || escrowStatus === "failed") return;
    const id = setInterval(fetchGameState, 3000);
    return () => clearInterval(id);
  }, [status, wagerAmount, escrowStatus, fetchGameState]);

  useEffect(() => {
    if (inCheck && currentTurn === playerColor && status === "active") {
      addToast("Your king is in check!", "error");
    }
  }, [inCheck, currentTurn, playerColor, status, addToast]);

  useEffect(() => {
    if (drawOffer && drawOffer !== playerColor && status === "active") {
      addToast("Opponent offered a draw", "info");
    }
  }, [drawOffer, playerColor, status, addToast]);
};
