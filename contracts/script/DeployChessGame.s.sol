// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import "../src/ChessGame.sol";
import "../src/ChessterEscrow.sol";

/**
 * Deploy both ChessGame (state machine) and ChessterEscrow (wager escrow)
 * to Somnia Testnet (Shannon, chain ID 50312).
 *
 * Usage:
 *   forge script script/DeployChessGame.s.sol \
 *     --rpc-url https://dream-rpc.somnia.network \
 *     --broadcast \
 *     --private-key $COORDINATOR_PRIVATE_KEY
 */
contract DeployChessGame is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("COORDINATOR_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        ChessGame   chessGame = new ChessGame();
        ChessterEscrow escrow = new ChessterEscrow();

        console.log("ChessGame deployed at:     ", address(chessGame));
        console.log("ChessterEscrow deployed at:", address(escrow));
        console.log("Coordinator (deployer):    ", vm.addr(deployerKey));

        vm.stopBroadcast();
    }
}
