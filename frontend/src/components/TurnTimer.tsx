interface GameTimerProps {
	secondsLeft: number;
	totalSeconds: number;
}

function formatTime(s: number): string {
	const m = Math.floor(s / 60);
	const sec = Math.max(0, Math.ceil(s % 60));
	return `${m}:${sec.toString().padStart(2, "0")}`;
}

function getColor(s: number, total: number): string {
	if (s <= 15) return "#E24B4A";
	if (s <= 60) return "#EF9F27";
	if (s / total > 0.5) return "#1D9E75";
	return "#378ADD";
}

function getStatus(s: number, total: number): string {
	if (s <= 15) return "Almost out!";
	if (s <= 60) return "Running low";
	if (s / total > 0.5) return "On track";
	return "Use your time";
}

export default function GameTimer({
	secondsLeft,
	totalSeconds,
}: GameTimerProps) {
	const r = 11;
	const circ = 2 * Math.PI * r;
	const offset = circ * (1 - Math.max(0, secondsLeft) / totalSeconds);
	const color = getColor(secondsLeft, totalSeconds);
	const urgent = secondsLeft <= 60;
	const critical = secondsLeft <= 15;

	return (
		<div
			className={`inline-flex items-center gap-2.5  rounded-full px-3.5 py-1.5 pl-1.5
      ${critical ? "animate-pulse" : ""}`}
		>
			{/* Mini arc */}
			<svg
				width="28"
				height="28"
				viewBox="0 0 28 28"
				className={
					urgent && !critical ? "animate-[tick_1s_ease-in-out_infinite]" : ""
				}
			>
				<circle
					cx="14"
					cy="14"
					r={r}
					fill="none"
					stroke="#374151"
					strokeWidth="2.5"
				/>
				<circle
					cx="14"
					cy="14"
					r={r}
					fill="none"
					stroke={color}
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeDasharray={circ}
					strokeDashoffset={offset}
					transform="rotate(-90 14 14)"
					className="transition-all duration-1000"
				/>
			</svg>

			{/* Time */}
			<span
				className="font-mono text-sm font-medium tabular-nums transition-colors duration-400"
				style={{ color: urgent ? color : "white" }}
			>
				{formatTime(secondsLeft)}
			</span>

			{/* Divider */}
			<span className="w-px h-3 bg-white" />

			{/* Status */}
			<span className="text-[11px] text-(--text-secondary)">
				{getStatus(secondsLeft, totalSeconds)}
			</span>
		</div>
	);
}
