// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title ChessGame
 * @dev On-chain chess game state machine deployed on Somnia.
 *      Stores board state and emits events consumed by Somnia Reactivity
 *      subscriptions so both players receive move updates without polling.
 *
 *      The coordinator (backend) is the only writer:
 *        - createGame  / joinGame     – register players
 *        - recordMove                 – update board after each validated move
 *        - recordDrawOffer            – signal a pending draw offer
 *        - endGame                    – mark game finished (handles payout via
 *                                       ChessterEscrow if wager was placed)
 *
 *      Board encoding: 64 ASCII bytes, row-major (row 0 = black's back rank).
 *        Uppercase = white pieces (K Q R B N P)
 *        Lowercase = black pieces (k q r b n p)
 *        '.' (0x2e)  = empty square
 */
contract ChessGame {
    address public coordinator;

    enum Status { WAITING, ACTIVE, FINISHED }

    struct Game {
        address playerWhite;
        address playerBlack;
        bytes   boardState;    // 64 ASCII bytes, row-major 8×8
        uint8   currentTurn;   // 0 = white, 1 = black
        Status  status;
        bool    inCheck;
        address winner;        // address(0xdead) = draw, player addr = winner
        address drawOfferer;   // address(0) = no pending draw offer
        uint64  activeSince;   // block.timestamp when second player joined
        string  endReason;     // "checkmate" | "resignation" | "stalemate" | "time" | "draw_agreed"
    }

    mapping(bytes32 => Game) public games;

    // Canonical draw sentinel – same value used in ChessterEscrow
    address public constant DRAW = address(0x000000000000000000000000000000000000dEaD);

    // ── Initial board (64 ASCII bytes) ────────────────────────────────────────
    // Row 0: r n b q k b n r   (black back rank)
    // Row 1: p p p p p p p p   (black pawns)
    // Row 2-5: . . . . . . . . (empty)
    // Row 6: P P P P P P P P   (white pawns)
    // Row 7: R N B Q K B N R   (white back rank)
    bytes private constant INITIAL_BOARD =
        hex"726e62716b626e72"   // rnbqkbnr
        hex"7070707070707070"   // pppppppp
        hex"2e2e2e2e2e2e2e2e"   // ........
        hex"2e2e2e2e2e2e2e2e"   // ........
        hex"2e2e2e2e2e2e2e2e"   // ........
        hex"2e2e2e2e2e2e2e2e"   // ........
        hex"5050505050505050"   // PPPPPPPP
        hex"524e42514b424e52";  // RNBQKBNR

    // ── Events (subscribed to via Somnia Reactivity SDK) ─────────────────────
    event GameCreated (bytes32 indexed gameCode, address indexed playerWhite);
    event PlayerJoined(bytes32 indexed gameCode, address indexed playerBlack);
    event MoveMade    (bytes32 indexed gameCode, uint8 fromRow, uint8 fromCol,
                       uint8 toRow, uint8 toCol, bool inCheck);
    event DrawOffered (bytes32 indexed gameCode, address indexed offerer);
    event GameEnded   (bytes32 indexed gameCode, address indexed winner, string reason);

    modifier onlyCoordinator() {
        require(msg.sender == coordinator, "only coordinator");
        _;
    }

    constructor() {
        coordinator = msg.sender;
    }

    // ── Coordinator write functions ───────────────────────────────────────────

    /// @notice Register a new game. Called by the backend when both players
    ///         are confirmed (game becomes active in the database).
    function createGame(bytes32 gameCode, address playerWhite) external onlyCoordinator {
        require(games[gameCode].playerWhite == address(0), "game exists");
        require(playerWhite != address(0), "zero address");

        games[gameCode] = Game({
            playerWhite:  playerWhite,
            playerBlack:  address(0),
            boardState:   INITIAL_BOARD,
            currentTurn:  0,
            status:       Status.WAITING,
            inCheck:      false,
            winner:       address(0),
            drawOfferer:  address(0),
            activeSince:  0,
            endReason:    ""
        });

        emit GameCreated(gameCode, playerWhite);
    }

    /// @notice Register the second player and start the game.
    function joinGame(bytes32 gameCode, address playerBlack) external onlyCoordinator {
        Game storage g = games[gameCode];
        require(g.playerWhite != address(0), "game not found");
        require(g.status == Status.WAITING,  "not waiting");
        require(playerBlack != g.playerWhite, "same player");

        g.playerBlack = playerBlack;
        g.status      = Status.ACTIVE;
        g.activeSince = uint64(block.timestamp);

        emit PlayerJoined(gameCode, playerBlack);
    }

    /// @notice Store the new board state after a validated move.
    /// @param newBoardState 64 ASCII bytes representing the updated board.
    function recordMove(
        bytes32 gameCode,
        uint8   fromRow,
        uint8   fromCol,
        uint8   toRow,
        uint8   toCol,
        bytes calldata newBoardState,
        bool    inCheck
    ) external onlyCoordinator {
        Game storage g = games[gameCode];
        require(g.status == Status.ACTIVE, "not active");
        require(newBoardState.length == 64, "invalid board");

        g.boardState   = newBoardState;
        g.currentTurn  = g.currentTurn == 0 ? 1 : 0;
        g.inCheck      = inCheck;
        g.drawOfferer  = address(0); // clear any pending draw offer on move

        emit MoveMade(gameCode, fromRow, fromCol, toRow, toCol, inCheck);
    }

    /// @notice Record a draw offer from one of the players.
    function recordDrawOffer(bytes32 gameCode, address offerer) external onlyCoordinator {
        Game storage g = games[gameCode];
        require(g.status == Status.ACTIVE, "not active");

        g.drawOfferer = offerer;
        emit DrawOffered(gameCode, offerer);
    }

    /// @notice Mark the game finished.
    /// @param winner Player address for a win, DRAW constant for a draw,
    ///               or address(0) to record without payout info.
    function endGame(
        bytes32 gameCode,
        address winner,
        string calldata reason
    ) external onlyCoordinator {
        Game storage g = games[gameCode];
        require(g.status != Status.FINISHED, "already finished");

        g.status    = Status.FINISHED;
        g.winner    = winner;
        g.endReason = reason;

        emit GameEnded(gameCode, winner, reason);
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    function getGame(bytes32 gameCode) external view returns (Game memory) {
        return games[gameCode];
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setCoordinator(address newCoordinator) external onlyCoordinator {
        require(newCoordinator != address(0), "zero address");
        coordinator = newCoordinator;
    }
}
