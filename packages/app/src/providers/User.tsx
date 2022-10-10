/**
 * User provider
 */

import React, {
	createContext,
	useCallback,
	useEffect,
	useMemo,
	useState
} from "react";
import produce from "immer";
import allSettled from "promise.allsettled";
import once from "lodash/once";
import { toaster } from "evergreen-ui";
import isEqual from "lodash/isEqual";
import { parseCookies, destroyCookie } from "nookies";
import { Base64 } from "js-base64";

import getArConnect from "@/utils/arconnect";
import getMetaMask from "@/utils/metamask";
import useArConnect from "@/hooks/use-arconnect";
import useMetaMask from "@/hooks/use-metamask";
import {
	User,
	IUserContext,
	Wallet,
	Connections,
	Profile,
	CampaignReference
} from "@/types";
import delay from "@/utils/delay";
import handleException from "@/utils/handle-exception";
import Authenticate from "@/modules/auth";
import { getMagicClient } from "@/utils/magic-client";
import * as api from "@/api";
import { events, AppEvents } from "@/utils/events";
import pascalCase from "@/utils/pascal-case";
import LogoImage from "@/assets/logo/Logo-Icon.svg";

type Props = {
	children: React.ReactNode;
};

const defaultValues: User = {
	wallets: [],
	partnerships: [],
	verifications: {
		personhood: null,
		captcha: false
	},
	profile: {
		email: ""
	}
};

export const UserContext = createContext<IUserContext>({
	user: defaultValues,
	loading: false,
	async connect() {
		// ...
	},
	async disconnect() {
		// ...
	},
	setCaptcha() {
		// ...
	},
	setPersonhood() {
		// ...
	},
	setProfile() {
		// ...
	},
	addPartnership() {
		// ...
	}
});

const authInstance = Authenticate.getInstance();

// Only fetch user on page load
let isUserFetched = false;
export const userFetched = () => isUserFetched;

const onWalletsError = (connection: Connections) => {
	toaster.warning(`Could not authenticate with ${pascalCase(connection)}`);
};

// Returns wallets that have been authenticated. Uses the provided connection to authenticate a new connection.
const getWallets = async (type: Connections): Promise<Wallet[]> => {
	// Fetch Currently authenticated User by referring to their connected wallets.
	let wallets: Wallet[] = [];
	try {
		switch (type) {
			case Connections.ARCONNECT: {
				const arconnect = getArConnect();
				if (arconnect) {
					const arweaveWalletAddress = await arconnect
						.getActiveAddress()
						.catch((e) => console.trace(e));
					if (arweaveWalletAddress) {
						await authInstance.withArweave(
							arweaveWalletAddress,
							type,
							arconnect
						);
						wallets = authInstance.getWallets();
					}
				}
				break;
			}
			case Connections.MAGIC: {
				// Produce the user with Magic here...
				const { magic } = getMagicClient();
				const isLoggedIn = await magic.user.isLoggedIn();
				if (isLoggedIn) {
					await authInstance.withMagic();
					// Magic will produce and authenticate multiple wallets for each blockchain it supports -- ie. Eth & Arweave
					wallets = authInstance.getWallets();
				}
				break;
			}
			case Connections.METAMASK: {
				const metamask = getMetaMask();
				if (metamask) {
					const metamaskWalletAddress = await metamask
						.listAccounts()
						.catch((e) => console.trace(e));

					if (metamaskWalletAddress && metamaskWalletAddress.length != 0) {
						await authInstance.withEthereum(
							metamaskWalletAddress[0],
							type,
							metamask
						);
						wallets = authInstance.getWallets();
					}
				}
				break;
			}
			default: {
				break;
			}
		}
	} catch (e) {
		onWalletsError(type);
		handleException(e);
	}

	return wallets;
};

// Connect a new wallet and return new wallets array
// For magic wallet connection -- redirect to magic/login
const connectWallet = async (type: Connections): Promise<Wallet[]> => {
	switch (type) {
		case Connections.ARCONNECT: {
			const arconnect = getArConnect();
			if (arconnect !== null) {
				const permissions = ["ACCESS_ADDRESS", "SIGNATURE"];
				// @ts-ignore
				await arconnect.connect(permissions, {
					name: "Usher",
					logo: LogoImage
				});

				await delay(1000);
				return getWallets(type);
			}
			break;
		}
		case Connections.MAGIC: {
			const { magic } = getMagicClient();
			const isLoggedIn = await magic.user.isLoggedIn();
			if (isLoggedIn) {
				// Will only be reached if the user is authorised.
				return getWallets(type);
			}
			// Redirect to magic login page
			window.location.href = "/magic/login"; //* Important to use window.location.href for a full page reload.
			break;
		}
		case Connections.METAMASK: {
			const metamask = getMetaMask();
			if (metamask !== null) {
				const accounts = await metamask.send("eth_requestAccounts", []);

				// @ts-ignore
				// await metamask.connect(permissions, {
				// 	name: "Usher",
				// 	logo: LogoImage
				// });

				await delay(1000);
				return getWallets(type);
			}
			break;
		}
		default: {
			break;
		}
	}

	return [];
};

const disconnectWallet = async (type: Connections) => {
	switch (type) {
		case Connections.ARCONNECT: {
			const arconnect = getArConnect();
			if (arconnect !== null) {
				await arconnect.disconnect();
				await delay(500);
			}

			// Reload the screen when a user disconnects their wallet
			window.location.reload();
			break;
		}
		case Connections.MAGIC: {
			// Open Magic Link Dialog Here...
			window.location.href = "/magic/logout";
			break;
		}
		default: {
			break;
		}
	}
};

const UserContextProvider: React.FC<Props> = ({ children }) => {
	const [user, setUser] = useState<User>(defaultValues);
	const [loading, setLoading] = useState(false);
	const [, isArConnectLoading] = useArConnect();
	const [, isMetaMaskLoading] = useMetaMask();
	const [walletsLoading, setWalletsLoading] = useState(false);

	useEffect(() => {
		setWalletsLoading(isArConnectLoading || isMetaMaskLoading);
	}, [isArConnectLoading, isMetaMaskLoading]);

	const saveUser = useCallback((saved: User) => {
		console.log("SAVED USER", saved);
		setUser(saved);
		events.emit(AppEvents.SAVE_USER, { user: saved });
	}, []);

	const saveWallets = useCallback(
		(saved: Wallet[]) => {
			const newUser = produce(user, (draft) => {
				draft.wallets = saved;
			});
			saveUser(newUser);
		},
		[user]
	);

	const setCaptcha = useCallback(
		(value: boolean) => {
			events.emit(AppEvents.CAPTCHA, { value });
			setUser(
				produce(user, (draft) => {
					draft.verifications.captcha = value;
				})
			);
		},
		[user]
	);

	const setPersonhood = useCallback(
		(value: number | boolean) => {
			events.emit(AppEvents.PERSONHOOD, { value });
			setUser(
				produce(user, (draft) => {
					draft.verifications.personhood = value;
				})
			);
		},
		[user]
	);

	const setProfile = useCallback(
		async (profile: Profile) => {
			// Save profile
			const authToken = await authInstance.getAuthToken();
			await api.profile(authToken).post(profile);
			events.emit(AppEvents.PROFILE_SAVE, { profile });

			const newUser = produce(user, (draft) => {
				draft.profile = profile;
			});

			saveUser(newUser);
		},
		[user]
	);

	const addPartnership = useCallback(
		async (partnership: CampaignReference) => {
			const partnerships = await authInstance.addPartnership(partnership);
			events.emit(AppEvents.START_PARTNERSHIP, { partnership });

			const newUser = produce(user, (draft) => {
				draft.partnerships = [...partnerships];
			});

			saveUser(newUser);
		},
		[user]
	);

	const loadUserWithWallets = useCallback(async (withWallets: Wallet[]) => {
		// get partnerships
		const partnerships = authInstance.getPartnerships();

		// Load verifications and profile
		const authToken = await authInstance.getAuthToken();
		const [captcha, personhood, profileData] = await allSettled<
			[
				{ success: boolean },
				{ success: boolean; createdAt?: number },
				{ success: boolean; profile: Profile }
			]
		>([
			api.captcha(authToken).get(),
			api.personhood(authToken).get(),
			api.profile(authToken).get()
		]);
		console.log("User Data loaded.");
		let profile: Profile =
			profileData.status === "fulfilled" && profileData.value.success
				? profileData.value.profile
				: { email: "" };

		// Handle Magic Auth Profile Update
		const cookies = parseCookies();
		const magicConnectToken = cookies.__usher_magic_connect;
		if (magicConnectToken && !profile.email) {
			try {
				const response = JSON.parse(Base64.decode(magicConnectToken));
				// Do something with the email -- response.userMetadata.email
				const newProfile = {
					...(profile || {}),
					email: response.userMetadata.email
				};
				await setProfile(newProfile);
				profile = newProfile;
				console.log("Magic Profile Updated!");
			} catch (e) {
				handleException(e);
			}
		}
		// Destroy the cookie on success
		destroyCookie(null, "__usher_magic_connect", {
			maxAge: 24 * 60 * 60, // 1 days
			path: "/"
		});

		const newUser = produce(user, (draft) => {
			draft.wallets = withWallets;
			draft.partnerships = partnerships;
			if (profile) {
				draft.profile = profile;
			}
			draft.verifications = {
				personhood:
					personhood.status === "fulfilled" && personhood.value.success
						? personhood.value.createdAt || true
						: false,
				captcha: captcha.status === "fulfilled" && captcha.value.success
			};
		});

		saveUser(newUser);
	}, []);

	// Only called once on page load
	const loadUser = useCallback(
		once(async () => {
			console.log("Loading user ...");
			const res = await allSettled<Wallet[]>(
				Object.values(Connections).map((value) =>
					getWallets(value).then((fetched) => {
						saveWallets(fetched);
						return fetched;
					})
				)
			);

			const fetchedWallets: Wallet[] = [];
			for (let i = res.length - 1; i >= 0; i -= 1) {
				if (res[i].status === "fulfilled") {
					// @ts-ignore
					const { value = [] } = res[i];
					value.forEach((v: Wallet) => {
						if (!fetchedWallets.find((w) => isEqual(w, v))) {
							fetchedWallets.push(v);
						}
					});
				}
			}

			console.log("Wallets loaded. Fetching verifications ...", fetchedWallets);

			if (fetchedWallets.length > 0) {
				await loadUserWithWallets(fetchedWallets);
			}
		}),
		[]
	);

	const connect = useCallback(async (type: Connections) => {
		const newWallets = await connectWallet(type);
		await loadUserWithWallets(newWallets); // loading user data on every new login as partnerships/profiles are not fetched after owners are merged
		events.emit(AppEvents.CONNECT, { wallets: newWallets });
	}, []);

	const { wallets } = user;
	useEffect(() => {
		if (!walletsLoading && !isUserFetched && !loading && wallets.length === 0) {
			isUserFetched = true;
			setLoading(true);
			loadUser().finally(() => {
				setLoading(false);
			});
		}
		return () => {};
	}, [wallets, loading, walletsLoading]);

	const value = useMemo(
		() => ({
			user,
			loading: loading || walletsLoading,
			connect,
			disconnect: disconnectWallet,
			setCaptcha,
			setPersonhood,
			setProfile,
			addPartnership
		}),
		[user, loading, walletsLoading]
	);

	return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export default UserContextProvider;
