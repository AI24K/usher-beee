/**
 * User provider
 * Uses 3id to authorise access to Affiliate Streams.
 * Network is required to track all affiliates in their own Stream
 * https://developers.ceramic.network/reference/accounts/3id-did/
 */

import React, {
	createContext,
	useCallback,
	useEffect,
	useMemo,
	useState
} from "react";
import useLocalStorage from "use-local-storage";
import produce from "immer";
import allSettled from "promise.allsettled";

import useArConnect from "@/hooks/use-arconnect";
import {
	User,
	IUserContext,
	Wallet,
	Connections,
	Profile,
	Partnership
} from "@/types";
import delay from "@/utils/delay";
import handleException, {
	setUser as setErrorTrackingUser
} from "@/utils/handle-exception";
import { identifyUser } from "@/utils/signals";
import Authenticate from "@/modules/auth";
// import * as api from "@/api";

import LogoImage from "@/assets/logo/Logo-Icon.svg";

type Props = {
	children: React.ReactNode;
};

const defaultValues: User = {
	wallets: [],
	partnerships: [],
	verifications: {
		personhood: false,
		captcha: false
	},
	profile: {
		email: ""
	}
};

export const UserContext = createContext<IUserContext>({
	user: defaultValues,
	loading: false,
	async getUser() {
		return defaultValues;
	},
	async connect() {
		return defaultValues;
	},
	async disconnect() {
		// ...
	},
	setCaptcha() {
		// ...
	},
	setProfile() {
		// ...
	},
	switchWallet() {
		// ...
	}
});

const auth = Authenticate.getInstance();

const UserContextProvider: React.FC<Props> = ({ children }) => {
	const [user, setUser] = useState<User>(defaultValues);
	const [loading, setLoading] = useState(true);
	const [isUserFetched, setUserFetched] = useState(false);
	const [savedConnections, setSavedConnections] = useLocalStorage<
		Connections[]
	>("saved-connections", []);
	const [getArConnect, isArConnectLoading] = useArConnect();
	const walletsLoading = isArConnectLoading;

	const saveUser = useCallback((saved: User) => {
		setUser(saved);
		setErrorTrackingUser(saved);
		identifyUser(saved);
	}, []);

	const removeUser = useCallback(() => {
		setUser(defaultValues);
		setErrorTrackingUser(null);
		identifyUser(null);
	}, []);

	const getUser = useCallback(
		async (type: Connections) => {
			// Fetch Currently authenticated User by referring to their connected wallets.
			let wallets: Wallet[] = [];
			switch (type) {
				case Connections.ARCONNECT: {
					const arconnect = getArConnect();
					if (arconnect !== null) {
						try {
							const arweaveWalletAddress = await arconnect.getActiveAddress();
							console.log(arweaveWalletAddress);
							const { did } = await auth.withArweave(
								arweaveWalletAddress,
								arconnect,
								type
							);
							console.log(did);
							wallets = auth.getWallets();
						} catch (e) {
							console.error(e);
							if (e instanceof Error) {
								handleException(e, null);
							}
						}
					}
					break;
				}
				case Connections.MAGIC: {
					// Authorise Magic Wallet here...
					break;
				}
				default: {
					break;
				}
			}

			if (wallets.length === 0) {
				return defaultValues;
			}

			// Authenticated
			// const { success: captcha } = await api.captcha().get(id);
			// const personhood = await checkPersonhood(did.id);
			// Fetch inactive wallets -- filter the existing wallet.
			// Fetch Partnerships relative to this connection
			const partnerships: Partnership[] = [];

			const newUser = produce(user, (draft) => {
				draft.wallets = wallets;
				draft.partnerships = [...user.partnerships, ...partnerships];
				draft.verifications = { captcha: false, personhood: false };
			});

			saveUser(newUser);
			setSavedConnections(
				produce(savedConnections, (draft) => {
					draft.push(type);
				})
			);

			return newUser;
		},
		[user]
	);

	const connect = useCallback(async (type: Connections) => {
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
					return getUser(type);
				}
				break;
			}
			default: {
				break;
			}
		}

		return defaultValues;
	}, []);

	const disconnect = useCallback(
		async (type: Connections) => {
			if (!walletsLoading) {
				switch (type) {
					case Connections.ARCONNECT: {
						const arconnect = getArConnect();
						if (arconnect !== null) {
							await arconnect.disconnect();
							await delay(500);
						}
						break;
					}
					case Connections.MAGIC: {
						// Open Magic Link Dialog Here...
						break;
					}
					default: {
						break;
					}
				}

				const newSavedConnections = savedConnections.filter(
					(connection) => connection !== type
				);
				setSavedConnections(newSavedConnections);
			}

			removeUser();
		},
		[walletsLoading, savedConnections]
	);

	const switchWallet = useCallback(
		(address: string) => {
			auth.activate(address);
			const wallets = auth.getWallets();
			const nextUser = produce(user, (draft) => {
				draft.wallets = wallets;
			});
			saveUser(nextUser);
		},
		[user]
	);

	const setCaptcha = useCallback(
		(value: boolean) => {
			setUser(
				produce(user, (draft) => {
					draft.verifications.captcha = value;
				})
			);
		},
		[user]
	);

	const setProfile = useCallback(
		(profile: Profile) => {
			setUser(
				produce(user, (draft) => {
					draft.profile = profile;
				})
			);
		},
		[user]
	);

	useEffect(() => {
		if (!walletsLoading) {
			if (
				user.wallets.length === 0 &&
				!isUserFetched &&
				savedConnections.length
			) {
				setLoading(true);
				// (async () => {
				// 	for (let i = 0; i < savedConnections.length; i++) {
				// 		await getUser(savedConnections[i]);
				// 	}
				// 	setLoading(false);
				// })();
				allSettled(
					savedConnections.map((connection) => getUser(connection))
				).finally(() => {
					setLoading(false);
				});
				setUserFetched(true);
			} else {
				setLoading(false);
			}
		}
		return () => {};
	}, [user, isUserFetched, walletsLoading, savedConnections]);

	const value = useMemo(
		() => ({
			user,
			loading: loading || walletsLoading,
			getUser,
			connect,
			disconnect,
			setCaptcha,
			setProfile,
			switchWallet
		}),
		[user, loading]
	);

	return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export default UserContextProvider;
