import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import {
	useAppKitAccount,
	useAppKitProvider,
	AppKitButton,
} from "@reown/appkit/react";
import { ethers } from "ethers";
import ChessBoard from "../components/ChessBoard";
import { friendlyError } from "../utils/errorMessages";

const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS || "";
const ESCROW_ETH_ABI = [
	"function joinMatch(bytes32 gameCode) external payable",
];

interface GameInfo {
	wager_amount?: number | null;
	token_address?: string | null;
	status?: string;
	player_white?: boolean;
	player_black?: boolean;
}

type JoinStep = "idle" | "depositing" | "joining";

function Spinner({ size = 16 }: { size?: number }) {
	return (
		<svg
			className="animate-spin shrink-0"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
		>
			<circle
				className="opacity-25"
				cx="12"
				cy="12"
				r="10"
				stroke="currentColor"
				strokeWidth="4"
			/>
			<path
				className="opacity-75"
				fill="currentColor"
				d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
			/>
		</svg>
	);
}

export default function GamePage() {
	const { gameCode } = useParams<{ gameCode: string }>();
	const navigate = useNavigate();
	const {
		rejoinGame,
		gameCode: storedGameCode,
		playerColor,
		joinGame,
	} = useGameStore();
	const { addToast } = useToastStore();
	const { address, isConnected } = useAppKitAccount();
	const { walletProvider } = useAppKitProvider("eip155");

	const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
	const [fetchingInfo, setFetchingInfo] = useState(true);
	const [joinStep, setJoinStep] = useState<JoinStep>("idle");

	useEffect(() => {
		if (!gameCode) {
			navigate("/");
			return;
		}

		if (storedGameCode === gameCode && playerColor) {
			rejoinGame(gameCode);
			return;
		}

		const fetchInfo = async () => {
			setFetchingInfo(true);
			try {
				const BACKEND_URL =
					import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";
				const res = await fetch(`${BACKEND_URL}api/games/${gameCode}`);
				const json = await res.json();
				if (json.success) setGameInfo(json.data);
			} catch {
				// silently fail
			} finally {
				setFetchingInfo(false);
			}
		};
		fetchInfo();
	}, [gameCode, storedGameCode, playerColor, rejoinGame, navigate]);

	const hasWager = !!(gameInfo?.wager_amount);
	const wagerAmount = gameInfo?.wager_amount;
	const potentialWinnings = wagerAmount
		? (parseFloat(String(wagerAmount)) * 2 * 0.95).toFixed(6)
		: null;

	const depositAndJoin = async () => {
		if (!gameCode || !address) return;

		if (hasWager && wagerAmount) {
			if (!ESCROW_ADDRESS) {
				addToast("Escrow contract not configured", "error");
				return;
			}
			setJoinStep("depositing");
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const provider = new ethers.BrowserProvider(walletProvider as any);
				const signer = await provider.getSigner();
				const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ETH_ABI, signer);
				const tx = await contract.joinMatch(ethers.id(gameCode), {
					value: ethers.parseEther(String(wagerAmount)),
				});
				await tx.wait();
			} catch (err: unknown) {
				setJoinStep("idle");
				addToast(friendlyError(err, "Deposit failed."), "error");
				return;
			}
		}

		setJoinStep("joining");
		try {
			await joinGame(gameCode, "black", address);
		} catch (err: unknown) {
			setJoinStep("idle");
			addToast(friendlyError(err), "error");
		}
	};

	// Already a player → show board
	if (storedGameCode === gameCode && playerColor) {
		return <ChessBoard />;
	}

	if (fetchingInfo) {
		return (
			<div className="flex flex-col items-center justify-center h-svh overflow-hidden gap-4 bg-(--bg)">
				<Spinner size={28} />
				<p className="text-sm text-(--text-secondary)">Loading game…</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center h-svh overflow-hidden gap-6 bg-(--bg) p-4">
			<div className="absolute top-4 right-4">
				<AppKitButton />
			</div>

			<div className="w-full max-w-sm flex flex-col gap-5">
				{/* Header */}
				<div className="text-center flex flex-col gap-1">
					<p className="text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
						Game
					</p>
					<h2 className="text-4xl font-bold font-mono tracking-widest">
						{gameCode}
					</h2>
				</div>

				{/* Stake info card */}
				{hasWager && (
					<div className="bg-(--bg-secondary) border border-yellow-500/30 rounded-2xl p-4 flex flex-col gap-3">
						<div className="flex items-center gap-2">
							<div className="w-6 h-6 rounded-full bg-yellow-500/15 flex items-center justify-center text-sm">
								🔒
							</div>
							<span className="text-sm font-semibold text-yellow-400">
								Wagered Game
							</span>
						</div>

						<div className="grid grid-cols-2 gap-2">
							<div className="bg-(--bg) rounded-xl p-3 flex flex-col gap-0.5">
								<p className="text-xs text-(--text-tertiary)">Your stake</p>
								<p className="text-lg font-bold">
									{wagerAmount}{" "}
									<span className="text-sm font-semibold text-(--text-secondary)">
										STT
									</span>
								</p>
							</div>
							<div className="bg-(--bg) rounded-xl p-3 flex flex-col gap-0.5">
								<p className="text-xs text-(--text-tertiary)">Win up to</p>
								<p className="text-lg font-bold text-green-400">
									{potentialWinnings}{" "}
									<span className="text-sm font-semibold">STT</span>
								</p>
							</div>
						</div>

						<div className="flex flex-col gap-0.5 text-xs text-(--text-tertiary)">
							<p>
								• Total pot: {(parseFloat(String(wagerAmount)) * 2).toString()} STT
							</p>
							<p>• Winner takes the pot</p>
							<p>• Draws refund both players in full</p>
						</div>
					</div>
				)}

				{/* Free game info */}
				{!hasWager && gameInfo && (
					<div className="bg-(--bg-secondary) border border-(--border) rounded-2xl p-4 text-center">
						<p className="text-sm text-(--text-secondary)">
							Free game · No wager
						</p>
					</div>
				)}

				{/* Action */}
				{!isConnected ? (
					<div className="flex flex-col items-center gap-3">
						<p className="text-sm text-(--text-secondary) text-center">
							Connect your wallet to join this game
						</p>
						<AppKitButton />
					</div>
				) : (
					<button
						onClick={depositAndJoin}
						disabled={joinStep !== "idle"}
						className="w-full py-4 text-base font-bold rounded-2xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg bg-(--accent-dark) hover:bg-(--accent-primary)"
					>
						{joinStep === "depositing" ? (
							<>
								<Spinner size={16} /> Confirm in wallet…
							</>
						) : joinStep === "joining" ? (
							<>
								<Spinner size={16} /> Joining game…
							</>
						) : hasWager ? (
							"Send STT & Play as Black"
						) : (
							"Play as Black"
						)}
					</button>
				)}

				{/* Step indicator for wagered join */}
				{hasWager && joinStep !== "idle" && (
					<div className="flex items-center justify-center gap-3 text-xs">
						<div
							className={`flex items-center gap-1 ${joinStep === "depositing" ? "text-(--accent-primary) font-semibold" : "text-green-500"}`}
						>
							{joinStep === "depositing" ? (
								<Spinner size={10} />
							) : (
								<span>✓</span>
							)}
							Deposit STT
						</div>
						<div className="w-6 h-px bg-(--border)" />
						<div
							className={`flex items-center gap-1 ${joinStep === "joining" ? "text-(--accent-primary) font-semibold" : "text-(--text-tertiary)"}`}
						>
							{joinStep === "joining" && <Spinner size={10} />}
							Join
						</div>
					</div>
				)}

				<button
					onClick={() => navigate("/")}
					className="text-sm text-(--text-tertiary) hover:text-(--text) transition-colors text-center"
				>
					← Back to lobby
				</button>
			</div>
		</div>
	);
}
