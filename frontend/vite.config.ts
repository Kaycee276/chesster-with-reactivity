import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

function stubMissingOptionalDeps(ids: string[]): Plugin {
	return {
		name: "stub-missing-optional-deps",
		resolveId(id) {
			if (ids.includes(id)) return id;
		},
		load(id) {
			if (ids.includes(id)) return "export default {}";
		},
	};
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		nodePolyfills(),
		react(),
		tailwindcss(),
		stubMissingOptionalDeps(["@base-org/account"]),
	],
	server: {
		port: 4008,
		// host: true,
	},
});
