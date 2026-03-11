const { randomUUID }   = require("crypto");
const db               = require("../config/database");
const chessEngine      = require("../services/chessEngine");
const escrowService    = require("../services/escrowService");
const chessGameService = require("../services/chessGameService");

// Initialize escrow service (uses Somnia RPC via env vars)
escrowService.init();

// On-chain MatchStatus enum values
const ON_CHAIN_STATUS = { PENDING: 0, ACTIVE: 1, RESOLVED: 2, REFUNDED: 3 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseGame(row) {
	if (!row) return null;
	return {
		...row,
		board_state:    JSON.parse(row.board_state),
		last_move:      row.last_move ? JSON.parse(row.last_move) : null,
		captured_white: JSON.parse(row.captured_white || "[]"),
		captured_black: JSON.parse(row.captured_black || "[]"),
		player_white:   row.player_white === 1,
		player_black:   row.player_black === 1,
		in_check:       row.in_check === 1,
	};
}

function parseMove(row) {
	if (!row) return null;
	return {
		...row,
		from_position:    JSON.parse(row.from_position),
		to_position:      JSON.parse(row.to_position),
		board_state_after: JSON.parse(row.board_state_after),
		is_check:         row.is_check === 1,
		is_checkmate:     row.is_checkmate === 1,
	};
}

/** Run UPDATE then return the fresh row as a parsed game object. */
function updateAndFetch(fields, gameCode) {
	const now = new Date().toISOString();
	const keys = Object.keys(fields);
	const sets = keys.map((k) => `${k} = ?`).join(", ");
	const values = keys.map((k) => {
		const v = fields[k];
		if (v === null || v === undefined) return null;
		if (typeof v === "boolean") return v ? 1 : 0;
		if (typeof v === "object") return JSON.stringify(v);
		return v;
	});

	db.prepare(`UPDATE games SET ${sets}, updated_at = ? WHERE game_code = ?`)
		.run(...values, now, gameCode);

	const row = db.prepare("SELECT * FROM games WHERE game_code = ?").get(gameCode);
	return parseGame(row);
}

/** Simple escrow-only update (no return value needed). */
function setEscrowStatus(gameCode, status) {
	db.prepare("UPDATE games SET escrow_status = ? WHERE game_code = ?")
		.run(status, gameCode);
}

// ── Model ─────────────────────────────────────────────────────────────────────

class GameModel {
	async createGame(
		gameType = "chess",
		wagerAmount = null,
		playerWhiteAddress = null,
		timeControlSeconds = 600,
		gameCode = null,
	) {
		if (!gameCode) gameCode = this.generateGameCode();
		const initialBoard = chessEngine.initBoard();
		const id = randomUUID();

		db.prepare(`
      INSERT INTO games (
        id, game_code, game_type, board_state, current_turn, status,
        wager_amount, player_white_address, escrow_status, time_control_seconds
      ) VALUES (?, ?, ?, ?, 'white', 'waiting', ?, ?, ?, ?)
    `).run(
			id,
			gameCode,
			gameType,
			JSON.stringify(initialBoard),
			wagerAmount,
			playerWhiteAddress,
			wagerAmount ? "pending" : null,
			timeControlSeconds,
		);

		const row = db.prepare("SELECT * FROM games WHERE game_code = ?").get(gameCode);
		return parseGame(row);
	}

	async joinGame(gameCode, playerColor, playerAddress = null) {
		const row = db.prepare("SELECT * FROM games WHERE game_code = ?").get(gameCode);
		if (!row) throw new Error("Game not found");
		const game = parseGame(row);

		if (game.status !== "waiting" && game.status !== "active")
			throw new Error("Cannot join game");

		// Prevent the same wallet from joining as both players
		if (playerAddress) {
			const otherColorAddress =
				playerColor === "white"
					? game.player_black_address
					: game.player_white_address;
			if (otherColorAddress === playerAddress)
				throw new Error("You cannot play against yourself");
		}

		if (game.player_white === true && game.player_black === true)
			if (game[playerColor === "white" ? "player_white" : "player_black"] === true)
				throw new Error("Player color already taken");

		const updateField  = playerColor === "white" ? "player_white"         : "player_black";
		const addressField = playerColor === "white" ? "player_white_address" : "player_black_address";
		const otherField   = playerColor === "white" ? "player_black"         : "player_white";
		const bothPlayersJoined = game[otherField] === true;

		const now = new Date().toISOString();
		const fields = {
			[updateField]:  1,
			[addressField]: playerAddress,
			status: bothPlayersJoined ? "active" : "waiting",
			escrow_status: bothPlayersJoined && game.wager_amount ? "active" : game.escrow_status,
			...(bothPlayersJoined ? { turn_started_at: now, game_started_at: now } : {}),
		};

		return updateAndFetch(fields, gameCode);
	}

	async getGame(gameCode) {
		const row = db.prepare("SELECT * FROM games WHERE game_code = ?").get(gameCode);
		if (!row) return null;
		const game = parseGame(row);

		// Auto-cancel waiting games that have been open for over 1 hour.
		// Checked on every poll so the creator is notified promptly even if
		// no one visits the lobby to trigger getPendingGames().
		if (game.status === "waiting") {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
			if (game.created_at < oneHourAgo) {
				return updateAndFetch({ status: "cancelled" }, gameCode);
			}
		}

		// Retry escrow settlement if the game is finished but settlement never
		// completed (e.g. server restarted after game ended before _settleEscrow
		// finished). The on-chain check inside _settleEscrow is idempotent —
		// if already RESOLVED it just syncs the DB and returns.
		if (
			game.status === "finished" &&
			game.wager_amount &&
			game.escrow_status !== "settled" &&
			game.escrow_status !== "failed" &&
			game.escrow_status !== "refunded"
		) {
			this._settleEscrow(gameCode, game, game.winner).catch((err) => {
				console.error(`[Escrow] retry _settleEscrow for ${gameCode}:`, err.message);
			});
		}

		return game;
	}

	async getPendingGames() {
		const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

		const rows = db.prepare(`
      SELECT game_code, created_at, wager_amount, time_control_seconds, player_white_address
      FROM games
      WHERE status = 'waiting'
      ORDER BY created_at DESC
      LIMIT 30
    `).all();

		// Mark expired games as cancelled (non-blocking)
		const expired = rows.filter((g) => g.created_at < oneHourAgo);
		if (expired.length > 0) {
			const codes = expired.map((g) => g.game_code);
			const placeholders = codes.map(() => "?").join(", ");
			try {
				db.prepare(`UPDATE games SET status = 'cancelled' WHERE game_code IN (${placeholders})`)
					.run(...codes);
				console.log(`[GameModel] Cancelled ${codes.length} expired pending games`);
			} catch (err) {
				console.error(err);
			}
		}

		return rows.filter((g) => g.created_at >= oneHourAgo);
	}

	async endByTime(gameCode) {
		const game = await this.getGame(gameCode);
		if (!game || game.status !== "active") return game;

		const PIECE_VALUE = { q: 9, r: 5, b: 3, n: 3, p: 1 };
		let whiteScore = 0;
		let blackScore = 0;

		for (const row of game.board_state) {
			for (const cell of row) {
				if (cell === "." || cell.toLowerCase() === "k") continue;
				const val = PIECE_VALUE[cell.toLowerCase()] || 0;
				if (cell === cell.toUpperCase()) whiteScore += val;
				else blackScore += val;
			}
		}

		const winner =
			whiteScore > blackScore ? "white" : blackScore > whiteScore ? "black" : "draw";

		const data = updateAndFetch({ status: "finished", winner, end_reason: "time" }, gameCode);

		this._settleEscrow(gameCode, data, winner).catch((err) => {
			console.error(`[Escrow] _settleEscrow threw for ${gameCode}:`, err.message);
		});

		chessGameService.endGame(gameCode, data, winner, "time").catch(() => {});

		console.log(
			`[GameModel] ${gameCode} ended by time — white ${whiteScore} vs black ${blackScore} → ${winner}`,
		);
		return data;
	}

	async _settleEscrow(gameCode, dbGame, winner) {
		if (!dbGame.wager_amount) return;

		let onChain;
		try {
			onChain = await escrowService.getMatch(gameCode);
		} catch (err) {
			console.error(`[Escrow] getMatch failed for ${gameCode}:`, err.message);
			setEscrowStatus(gameCode, "failed");
			return;
		}

		const chainStatus = onChain.status;

		if (chainStatus === ON_CHAIN_STATUS.RESOLVED) {
			setEscrowStatus(gameCode, "settled");
			console.log(`[Escrow] ${gameCode} already RESOLVED on-chain — DB updated`);
			return;
		}
		if (chainStatus === ON_CHAIN_STATUS.REFUNDED) {
			setEscrowStatus(gameCode, "refunded");
			console.log(`[Escrow] ${gameCode} already REFUNDED on-chain — DB updated`);
			return;
		}

		if (onChain.createdAt === 0) {
			console.error(`[Escrow] ${gameCode} not found on-chain — player may not have deposited`);
			setEscrowStatus(gameCode, "failed");
			return;
		}

		if (chainStatus === ON_CHAIN_STATUS.PENDING) {
			console.error(`[Escrow] ${gameCode} is PENDING on-chain — player2 never deposited ETH`);
			setEscrowStatus(gameCode, "failed");
			return;
		}

		try {
			let receipt;
			if (winner === "draw") {
				receipt = await escrowService.resolveAsDraw(gameCode);
			} else {
				// Use the on-chain player addresses (from getMatch above) rather than
				// the DB addresses. The contract's resolveMatch checks
				// `winner == m.player1 || winner == m.player2`, so using the exact
				// addresses already stored on-chain eliminates any mismatch revert.
				// player1 = createMatch caller = white, player2 = joinMatch caller = black.
				const winnerAddress = winner === "white" ? onChain.player1 : onChain.player2;

				if (!winnerAddress || winnerAddress === "0x0000000000000000000000000000000000000000") {
					console.error(`[Escrow] ${gameCode} — no on-chain address for winner="${winner}"`);
					setEscrowStatus(gameCode, "failed");
					return;
				}

				receipt = await escrowService.resolveWithWinner(gameCode, winnerAddress);
			}

			db.prepare(
				"UPDATE games SET escrow_resolve_tx = ?, escrow_status = ? WHERE game_code = ?",
			).run(receipt.hash, "settled", gameCode);

			console.log(`[Escrow] ${gameCode} settled — tx: ${receipt.hash}`);
		} catch (resolveErr) {
			console.error(`[Escrow] resolveMatch FAILED for ${gameCode}:`, resolveErr.message);
			setEscrowStatus(gameCode, "failed");
		}
	}

	async makeMove(gameCode, from, to, promotion = null) {
		const game = await this.getGame(gameCode);

		if (game.status !== "active") throw new Error("Game not active");

		const validation = chessEngine.isValidMove(
			game.board_state,
			from,
			to,
			game.current_turn,
			game.last_move,
		);
		if (!validation.valid) throw new Error(validation.reason || "Invalid move");

		const piece = game.board_state[from[0]][from[1]];
		const isPromotion = piece.toLowerCase() === "p" && (to[0] === 0 || to[0] === 7);

		if (isPromotion && !promotion) throw new Error("Promotion piece required");

		const newBoard = chessEngine.makeMove(
			game.board_state,
			from,
			to,
			promotion,
			validation.enPassant,
		);
		const nextTurn = game.current_turn === "white" ? "black" : "white";

		// Track captured pieces
		const newCapturedWhite = [...(game.captured_white || [])];
		const newCapturedBlack = [...(game.captured_black || [])];

		const targetPiece = game.board_state[to[0]][to[1]];
		if (targetPiece !== ".") {
			if (targetPiece === targetPiece.toUpperCase()) newCapturedWhite.push(targetPiece);
			else newCapturedBlack.push(targetPiece);
		}

		if (validation.enPassant) {
			const epRow = game.current_turn === "white" ? to[0] + 1 : to[0] - 1;
			const epPiece = game.board_state[epRow][to[1]];
			if (epPiece !== ".") {
				if (epPiece === epPiece.toUpperCase()) newCapturedWhite.push(epPiece);
				else newCapturedBlack.push(epPiece);
			}
		}

		const opponentKing = nextTurn === "white" ? "K" : "k";
		const kingCaptured = !newBoard.some((row) => row.includes(opponentKing));

		const isCheck =
			kingCaptured ? false : chessEngine.isKingInCheck(newBoard, nextTurn);
		const isCheckmate =
			kingCaptured ? false : chessEngine.isCheckmate(newBoard, nextTurn, { from, to, piece });
		const isStalemate =
			kingCaptured ? false : chessEngine.isStalemate(newBoard, nextTurn, { from, to, piece });

		let newStatus = game.status;
		let winner    = null;
		let endReason = null;

		if (kingCaptured || isCheckmate) {
			newStatus = "finished";
			winner    = game.current_turn;
			endReason = "checkmate";
		} else if (isStalemate) {
			newStatus = "finished";
			winner    = "draw";
			endReason = "stalemate";
		}

		const updatedGame = updateAndFetch(
			{
				board_state:    newBoard,
				current_turn:   nextTurn,
				last_move:      { from, to, piece },
				in_check:       isCheck,
				status:         newStatus,
				winner,
				end_reason:     endReason,
				captured_white: newCapturedWhite,
				captured_black: newCapturedBlack,
				turn_started_at: new Date().toISOString(),
				draw_offer:     null,
			},
			gameCode,
		);

		if (newStatus === "finished") {
			this._settleEscrow(gameCode, updatedGame, winner).catch((err) => {
				console.error(`[Escrow] _settleEscrow threw for ${gameCode}:`, err.message);
			});
			chessGameService.endGame(gameCode, updatedGame, winner, endReason || "").catch(() => {});
		}

		// Insert move record
		db.prepare(`
      INSERT INTO moves (
        id, game_id, move_number, player, from_position, to_position,
        piece, board_state_after, is_check, is_checkmate, promotion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
			randomUUID(),
			game.id,
			game.move_count + 1,
			game.current_turn,
			JSON.stringify(from),
			JSON.stringify(to),
			piece,
			JSON.stringify(newBoard),
			isCheck ? 1 : 0,
			isCheckmate ? 1 : 0,
			promotion,
		);

		db.prepare("UPDATE games SET move_count = move_count + 1 WHERE game_code = ?")
			.run(gameCode);

		return updatedGame;
	}

	async resignGame(gameCode, playerColor) {
		const winner = playerColor === "white" ? "black" : "white";
		const data = updateAndFetch(
			{ status: "finished", winner, end_reason: "resignation" },
			gameCode,
		);

		this._settleEscrow(gameCode, data, winner).catch((err) => {
			console.error(`[Escrow] _settleEscrow threw for ${gameCode}:`, err.message);
		});
		chessGameService.endGame(gameCode, data, winner, "resignation").catch(() => {});

		return data;
	}

	async offerDraw(gameCode, playerColor) {
		return updateAndFetch({ draw_offer: playerColor }, gameCode);
	}

	async acceptDraw(gameCode) {
		const existing = await this.getGame(gameCode);
		if (!existing) throw new Error("Game not found");
		if (existing.status !== "active") throw new Error("Game is not active");
		if (!existing.draw_offer) throw new Error("No draw offer pending");

		const data = updateAndFetch(
			{ status: "finished", winner: "draw", draw_offer: null, end_reason: "draw_agreed" },
			gameCode,
		);

		if (!data) throw new Error("Game could not be updated — it may have already ended");

		this._settleEscrow(gameCode, data, "draw").catch((err) => {
			console.error(`[Escrow] _settleEscrow threw for ${gameCode}:`, err.message);
		});
		chessGameService.endGame(gameCode, data, "draw", "draw_agreed").catch(() => {});

		return data;
	}

	async forfeitTurn(gameCode) {
		const game = await this.getGame(gameCode);
		if (!game || game.status !== "active") return game;

		const nextTurn = game.current_turn === "white" ? "black" : "white";
		return updateAndFetch(
			{ current_turn: nextTurn, turn_started_at: new Date().toISOString() },
			gameCode,
		);
	}

	async getMoves(gameCode) {
		const game = await this.getGame(gameCode);
		const rows = db
			.prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY move_number ASC")
			.all(game.id);
		return rows.map(parseMove);
	}

	generateGameCode() {
		return Math.random().toString(36).substring(2, 8).toUpperCase();
	}
}

module.exports = new GameModel();
