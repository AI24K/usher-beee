import isEmpty from "lodash/isEmpty";
import Router from "next/router";

import {
	isProd,
	gaTrackingId,
	logrocketAppId,
	mixpanelAppId
} from "@/env-config";
import { Sentry } from "@/utils/handle-exception";
import { AppEvents, events } from "@/utils/events";

// Helper to ensure production
const mw =
	(fn: Function) =>
	(...params: any[]) => {
		if (
			// !isProd ||
			typeof window === "undefined"
		) {
			return false;
		}
		return fn(...params);
	};

const getLogRocket = () => import("logrocket").then((m) => m.default || m);
const getReactGA = () => import("react-ga").then((m) => m.default || m);
const getMixpanel = () =>
	import("mixpanel-browser").then((m) => m.default || m);

/**
 * Setup tracking
 */
export const setup = mw(async () => {
	// Setup Ga
	if (!isEmpty(gaTrackingId)) {
		const ReactGA = await getReactGA();
		ReactGA.initialize(gaTrackingId);
		ReactGA.pageview(window.location.pathname + window.location.search);
		Router.events.on("routeChangeComplete", (url) => {
			setTimeout(() => {
				ReactGA.pageview(url);
			}, 0);
		});
	}

	// Setup Log Rocket
	if (!isEmpty(logrocketAppId)) {
		const LogRocket = await getLogRocket();
		const setupLogRocketReact = await import("logrocket-react").then(
			(m) => m.default || m
		);
		LogRocket.init(logrocketAppId);
		setupLogRocketReact(LogRocket);
		LogRocket.getSessionURL((sessionURL) => {
			Sentry.configureScope((scope) => {
				scope.setExtra("sessionURL", sessionURL);
			});
		});
	}

	// Setup Mixpanel
	if (!isEmpty(mixpanelAppId)) {
		const mixpanel = await getMixpanel();
		mixpanel.init(mixpanelAppId);
		// Catch all tracking
		Object.values(AppEvents).forEach((appEvent) => {
			events.on(appEvent, (properties: Object) => {
				mixpanel.track(appEvent, properties);
			});
		});
	}

	return true;
});

/**
 * Accepts Callsesh user object
 *
 * @param   {Object}  user  Callsesh user object
 */
export const identifyUser = mw(async (id: string, properties: any) => {
	if (!id) {
		return null;
	}

	if (!isEmpty(gaTrackingId)) {
		// Identify for GA
		const ReactGA = await getReactGA();
		ReactGA.set({ userId: id });
	}

	if (!isEmpty(logrocketAppId)) {
		// Identify Log Rocket
		const LogRocket = await getLogRocket();
		LogRocket.identify(id, properties);
	}

	if (!isEmpty(mixpanelAppId)) {
		// Identify Mixpanel
		const mixpanel = await getMixpanel();
		mixpanel.identify(id);
	}

	return null;
});
