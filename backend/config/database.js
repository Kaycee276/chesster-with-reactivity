const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const DB_PATH =
  process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "chesster.db");

const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    game_code TEXT UNIQUE NOT NULL,
    game_type TEXT DEFAULT 'chess',
    board_state TEXT NOT NULL,
    current_turn TEXT NOT NULL,
    status TEXT DEFAULT 'waiting',
    player_white INTEGER DEFAULT 0,
    player_black INTEGER DEFAULT 0,
    player_white_address TEXT,
    player_black_address TEXT,
    move_count INTEGER DEFAULT 0,
    winner TEXT,
    end_reason TEXT,
    in_check INTEGER DEFAULT 0,
    last_move TEXT,
    draw_offer TEXT,
    captured_white TEXT DEFAULT '[]',
    captured_black TEXT DEFAULT '[]',
    wager_amount REAL,
    token_address TEXT,
    escrow_status TEXT,
    escrow_create_tx TEXT,
    escrow_join_tx TEXT,
    escrow_resolve_tx TEXT,
    time_control_seconds INTEGER DEFAULT 600,
    turn_started_at TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_games_code ON games(game_code);

  CREATE TABLE IF NOT EXISTS moves (
    id TEXT PRIMARY KEY,
    game_id TEXT REFERENCES games(id) ON DELETE CASCADE,
    move_number INTEGER NOT NULL,
    player TEXT NOT NULL,
    from_position TEXT NOT NULL,
    to_position TEXT NOT NULL,
    piece TEXT NOT NULL,
    board_state_after TEXT NOT NULL,
    is_check INTEGER DEFAULT 0,
    is_checkmate INTEGER DEFAULT 0,
    promotion TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_moves_game ON moves(game_id, move_number);
`);

module.exports = db;
