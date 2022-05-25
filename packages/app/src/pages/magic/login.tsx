import { useEffect } from "react";
import Script from "next/script";
import { useRouter } from "next/router";

import { magicPublicKey } from "@/env-config";
import Preloader from "@/components/Preloader";

const MagicLogin = () => {
	const router = useRouter();
	useEffect(() => {
		// Ensure that the page is refreshed when router completes a url change
		const handleRefresh = () => {
			window.location.reload();
		};
		router.events.on("routeChangeComplete", handleRefresh);
		return () => {
			router.events.off("routeChangeComplete", handleRefresh);
		};
	}, []);

	return (
		<>
			<Preloader message="Loading Magic..." />
			<Script
				src="https://auth.magic.link/pnp/login"
				data-magic-publishable-api-key={magicPublicKey}
				data-redirect-uri="/magic/callback"
			/>
		</>
	);
};

export default MagicLogin;
