/**
 * timerService.js
 *
 * Server-side shared countdown for each active game.
 * When the timer reaches zero it calls gameModel.endByTime(), which updates
 * Supabase and submits an endGame() transaction to the ChessGame contract on
 * Somnia. The Somnia Reactivity subscription on each client then delivers the
 * GameEnded event, eliminating the need to push timer-tick events via
 * Socket.IO.
 *
 * Clients run their own local countdown seeded from the `activeSince`
 * timestamp returned by the ChessGame contract (see gameStore.ts).
 */
class TimerService {
  constructor() {
    this.timers = new Map(); // gameCode → { interval }
  }

  /** No-op init kept for API compatibility with server.js */
  init() {}

  /**
   * Start the shared countdown for a game.
   * @param {string} gameCode
   * @param {number} totalSeconds – from time_control_seconds
   */
  startTimer(gameCode, totalSeconds) {
    this.clearTimer(gameCode);

    let secondsLeft = Math.max(0, totalSeconds);

    const interval = setInterval(async () => {
      secondsLeft = Math.max(0, secondsLeft - 1);

      if (secondsLeft <= 0) {
        this.clearTimer(gameCode);
        try {
          const gameModel = require("../models/gameModel");
          await gameModel.endByTime(gameCode);
        } catch (err) {
          console.error(`[TimerService] endByTime failed for ${gameCode}:`, err.message);
        }
      }
    }, 1000);

    this.timers.set(gameCode, { interval });
  }

  clearTimer(gameCode) {
    const entry = this.timers.get(gameCode);
    if (entry) {
      clearInterval(entry.interval);
      this.timers.delete(gameCode);
    }
  }
}

module.exports = new TimerService();
