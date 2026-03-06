const gameModel        = require("../models/gameModel");
const timerService     = require("../services/timerService");
const chessGameService = require("../services/chessGameService");

class GameController {
  async createGame(req, res) {
    try {
      const { gameType, wagerAmount, playerWhiteAddress, timeControlSeconds } = req.body;
      const game = await gameModel.createGame(
        gameType,
        wagerAmount,
        playerWhiteAddress,
        timeControlSeconds || 600,
      );
      // On-chain game creation is deferred until both players join (activateGame).
      res.status(201).json({ success: true, data: game });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async joinGame(req, res) {
    try {
      const { gameCode }                = req.params;
      const { playerColor, playerAddress } = req.body;
      const game = await gameModel.joinGame(gameCode, playerColor, playerAddress);

      // When both players are confirmed, register the game on Somnia and start
      // the server-side timer. activateGame is awaited (~0.5 s on Somnia) so
      // the contract is ready before the first move arrives.
      if (game.status === "active") {
        timerService.startTimer(gameCode, game.time_control_seconds || 600);

        if (game.player_white_address && playerAddress) {
          try {
            await chessGameService.activateGame(
              gameCode,
              game.player_white_address,
              playerAddress,
            );
          } catch {
            // Gracefully degrade: game continues via Supabase even if Somnia
            // activation fails. Reactivity updates won't work for this game.
          }
        }
      }

      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getGame(req, res) {
    try {
      const game = await gameModel.getGame(req.params.gameCode);
      res.json({ success: true, data: game });
    } catch (error) {
      res.status(404).json({ success: false, error: error.message });
    }
  }

  async getPendingGames(req, res) {
    try {
      const games = await gameModel.getPendingGames();
      res.json({ success: true, data: games });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async makeMove(req, res) {
    try {
      const { gameCode }           = req.params;
      const { from, to, promotion } = req.body;

      const game = await gameModel.makeMove(gameCode, from, to, promotion);

      // Push updated board to Somnia (fire-and-forget).
      // The Reactivity subscription on each client delivers the MoveMade event.
      chessGameService.recordMove(
        gameCode, from, to, game.board_state, game.in_check,
      ).catch(() => {});

      if (game.status !== "active") {
        timerService.clearTimer(gameCode);
        // endGame is handled inside gameModel._settleEscrow / endByTime
      }

      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getMoves(req, res) {
    try {
      const moves = await gameModel.getMoves(req.params.gameCode);
      res.json({ success: true, data: moves });
    } catch (error) {
      res.status(404).json({ success: false, error: error.message });
    }
  }

  async resignGame(req, res) {
    try {
      const { gameCode }   = req.params;
      const { playerColor } = req.body;
      const game = await gameModel.resignGame(gameCode, playerColor);

      timerService.clearTimer(gameCode);

      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async offerDraw(req, res) {
    try {
      const { gameCode }   = req.params;
      const { playerColor, playerAddress } = req.body;
      const game = await gameModel.offerDraw(gameCode, playerColor);

      // Broadcast draw offer via Somnia Reactivity so the opponent sees it.
      if (playerAddress) {
        chessGameService.recordDrawOffer(gameCode, playerAddress).catch(() => {});
      }

      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async acceptDraw(req, res) {
    try {
      const { gameCode } = req.params;
      const game = await gameModel.acceptDraw(gameCode);

      timerService.clearTimer(gameCode);

      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
}

module.exports = new GameController();
