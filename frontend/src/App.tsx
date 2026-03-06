import { AppKitProvider } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { defineChain } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";

import { BrowserRouter, Routes, Route } from "react-router-dom";
import GameLobby from "./components/GameLobby";
import GamePage from "./pages/GamePage";
import Toast from "./components/Toast";

const projectId = import.meta.env.VITE_PROJECT_ID;
if (!projectId) {
	throw new Error("VITE_PROJECT_ID is not set in .env");
}

const somniaTestnet = defineChain({
	id: 50312,
	caipNetworkId: "eip155:50312",
	chainNamespace: "eip155",
	name: "Somnia Testnet",
	nativeCurrency: { name: "Somnia Token", symbol: "STT", decimals: 18 },
	rpcUrls: {
		default: {
			http: ["https://dream-rpc.somnia.network/"],
			webSocket: ["wss://dream-rpc.somnia.network/ws"],
		},
	},
	blockExplorers: {
		default: {
			name: "Somnia Explorer",
			url: "https://shannon-explorer.somnia.network",
		},
	},
	testnet: true,
});

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
	somniaTestnet as AppKitNetwork,
];

const metadata = {
	name: "Chesster",
	description:
		"A decentralized chess game built on Somnia with on-chain Reactivity for real-time gameplay without Socket.IO.",
	url: "https://chesster-lovat.vercel.app",
	icons: ["https://chesster-lovat.vercel.app/favicon.ico"],
};

const ethersAdapter = new EthersAdapter();

const App = () => {
	return (
		<AppKitProvider
			adapters={[ethersAdapter]}
			networks={networks}
			projectId={projectId}
			metadata={metadata}
			enableWallets={true}
		>
			<BrowserRouter>
				<Toast />
				<Routes>
					<Route path="/" element={<GameLobby />} />
					<Route path="/:gameCode" element={<GamePage />} />
				</Routes>
			</BrowserRouter>
		</AppKitProvider>
	);
};

export default App;
