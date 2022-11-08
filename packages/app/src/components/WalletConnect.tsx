import ArConnectIcon from "@/assets/icon/arconnect.svg";
import CoinbaseWalletIcon from "@/assets/icon/coinbasewallet.svg";
import MetaMaskIcon from "@/assets/icon/metamask.svg";
import WalletConnectIcon from "@/assets/icon/walletconnect.svg";
import { useUser } from "@/hooks/";
import { Chains, Connections, Wallet } from "@/types";
import { ProviderLabel } from "@/utils/onboard";
import { UilLockOpenAlt } from "@iconscout/react-unicons";
import { Pane } from "evergreen-ui";
import React, { useCallback, useState } from "react";
import { WalletConnectButton } from "./WalletConnectButton";

export type Props = {
	hide?: Connections[];
	onConnect?: (connection: string) => void;
	loading?: boolean;
};

const WalletConnect: React.FC<Props> = ({
	hide = [],
	onConnect = () => {},
	loading: isPropLoading = false
}) => {
	const {
		isLoading: isUserLoading,
		actions: { connect }
	} = useUser();

	const [isConnecting, setConnecting] = useState(false);
	const isLoading = isUserLoading || isConnecting || isPropLoading;

	const signingMessage =
		"To create your Usher account, please click the 'Sign' button.";

	const connectWallet = useCallback(
		async (address: string, signature: string, connection: Connections) => {
			const wallet: Wallet & { signature: string } = {
				chain: Chains.ETHEREUM,
				connection,
				address,
				signature
			};

			// #region connectedWallets
			const previouslyConnectedWallets = JSON.parse(
				window.localStorage.getItem("connectedWallets") || "[]"
			) as (Wallet & { signature: string })[];
			previouslyConnectedWallets.push(wallet);
			window.localStorage.setItem(
				"connectedWallets",
				JSON.stringify(previouslyConnectedWallets)
			);
			// #endregion

			setConnecting(true);
			connect(connection)
				.then(() => {
					onConnect(connection); // used to close the sidesheet.
				})
				.finally(() => {
					setConnecting(false);
				});
		},
		[]
	);

	return (
		<Pane display="flex" flexDirection="column">
			{!hide.includes(Connections.ARCONNECT) && (
				<WalletConnectButton
					text="ArConnect"
					icon={ArConnectIcon}
					providerLabel={ProviderLabel.ArConnect}
					signingMessage={signingMessage}
					isConnecting={isLoading}
					onConnect={async (address: string, signature: string) =>
						connectWallet(address, signature, Connections.ARCONNECT)
					}
				/>
			)}
			{!hide.includes(Connections.METAMASK) && (
				<WalletConnectButton
					text="MetaMask"
					icon={MetaMaskIcon}
					providerLabel={ProviderLabel.MetaMask}
					signingMessage={signingMessage}
					isConnecting={isLoading}
					onConnect={async (address: string, signature: string) =>
						connectWallet(address, signature, Connections.METAMASK)
					}
				/>
			)}
			{!hide.includes(Connections.WALLETCONNECT) && (
				<WalletConnectButton
					text="WalletConnect"
					icon={WalletConnectIcon}
					providerLabel={ProviderLabel.WalletConnect}
					signingMessage={signingMessage}
					isConnecting={isLoading}
					onConnect={async (address: string, signature: string) =>
						connectWallet(address, signature, Connections.WALLETCONNECT)
					}
				/>
			)}
			{!hide.includes(Connections.COINBASEWALLET) && (
				<WalletConnectButton
					text="CoinbaseWallet"
					icon={CoinbaseWalletIcon}
					providerLabel={ProviderLabel.CoinbaseWallet}
					signingMessage={signingMessage}
					isConnecting={isLoading}
					onConnect={async (address: string, signature: string) =>
						connectWallet(address, signature, Connections.COINBASEWALLET)
					}
				/>
			)}
			{!hide.includes(Connections.MAGIC) && (
				<WalletConnectButton
					text="Email, SMS, and more"
					icon={<UilLockOpenAlt size="28" />}
					providerLabel={ProviderLabel.Magic}
					signingMessage={signingMessage}
					isConnecting={isLoading}
					onConnect={async (address: string, signature: string) =>
						connectWallet(address, signature, Connections.MAGIC)
					}
				/>
			)}
		</Pane>
	);
};

WalletConnect.defaultProps = {
	hide: []
};

export default WalletConnect;
