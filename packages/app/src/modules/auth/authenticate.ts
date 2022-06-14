import { DID } from "dids";
import * as uint8arrays from "uint8arrays";
import Arweave from "arweave";
import { Base64 } from "js-base64";
import { JWKInterface } from "arweave/node/lib/wallet";
import PQueue from "p-queue";
import ono from "@jsdevtools/ono";

import getMagicClient from "@/utils/magic-client";
import getArweaveClient from "@/utils/arweave-client";
import {
	Chains,
	Wallet,
	Connections,
	CampaignReference,
	Profile
} from "@/types";
import WalletAuth from "./wallet";
import OwnerAuth from "./owner";

const arweave = getArweaveClient();
const queue = new PQueue({ concurrency: 1 });

class Authenticate {
	protected auths: WalletAuth[] = [];

	protected owner: OwnerAuth | null = null;

	private static instance: Authenticate | null;

	private add(auth: WalletAuth) {
		this.auths.push(auth);
	}

	private exists(o: DID | WalletAuth) {
		return !!this.auths.find(
			(auth) => auth.did.id === (o instanceof DID ? o.id : o.did.id)
		);
	}

	public getAuth(address: string) {
		const auth = this.auths.find((a) => a.address === address);
		if (auth) {
			return auth;
		}
		throw new Error(`No Auth found for wallet ${address}`);
	}

	public getWallets(): Wallet[] {
		return this.auths.map((auth) => {
			return auth.wallet;
		});
	}

	public getAll() {
		return this.auths;
	}

	public getOwner() {
		return this.owner;
	}

	public getPartnerships() {
		if (!this.owner) {
			return [];
		}
		return this.owner.partnerships;
	}

	public addPartnership(p: CampaignReference) {
		if (!this.owner) {
			throw ono("No owner loaded to add partnerships to");
		}
		return this.owner.addPartnership(p);
	}

	public getProfile() {
		if (!this.owner) {
			return null;
		}
		return this.owner.profile;
	}

	public updateProfile(p: Profile) {
		if (!this.owner) {
			throw ono("No owner loaded to update profile");
		}
		return this.owner.updateProfile(p);
	}

	/**
	 * Deterministically produce a secret for DID production
	 */
	public async withArweave(
		walletAddress: string,
		provider:
			| typeof window.arweaveWallet
			| {
					signature: (
						data: Uint8Array,
						algorithm: RsaPssParams
					) => Promise<Uint8Array>;
			  },
		connection: Connections
	): Promise<WalletAuth> {
		const arr = uint8arrays.fromString(walletAddress);
		const sig = await provider.signature(arr, {
			name: "RSA-PSS",
			saltLength: 0 // This ensures that no additional salt is produced and added to the message signed.
		});

		const str = Base64.fromUint8Array(sig);
		const entropy = uint8arrays.fromString(str);

		const auth = new WalletAuth();
		await auth.connect(walletAddress, entropy, Chains.ARWEAVE, connection);
		const { did } = auth;

		// If wallet DID does not exist, push and activate it
		if (!this.exists(did)) {
			this.add(auth);
		}

		await this.loadOwnerForAuth(auth);

		return auth;
	}

	/**
	 * Authenticate with Magic -- assumes that user is authenticated
	 *
	 * Create a DID for Magic Eth wallet.
	 * If no existing Magic wallet exists, create a JWK wallet and encrypt with Eth Signer
	 * Push the encrypted JWK wallet to Ceramic under a "MagicWallets" stream
	 */
	public async withMagic(): Promise<WalletAuth[]> {
		const { ethProvider } = getMagicClient();

		const signer = ethProvider.getSigner();
		const address = await signer.getAddress();
		const sig = await signer.signMessage(address);
		const enc = Base64.encode(sig);
		const entropy = uint8arrays.fromString(enc);

		const ethAuth = new WalletAuth();
		await ethAuth.connect(address, entropy, Chains.ETHEREUM, Connections.MAGIC);
		const { did } = ethAuth;

		// If wallet DID does not exist, push and activate it
		if (!this.exists(ethAuth.did)) {
			this.add(ethAuth);
		}

		// Check if Arweave wallet exists for the DID
		// For reference, see https://developers.ceramic.network/tools/glaze/example/#5-runtime-usage
		const magicWallets = await ethAuth.getMagicWallets();
		let arweaveKey = {};
		let arweaveAddress = "";
		if (!(magicWallets || {}).arweave) {
			// Create Arweave Jwk
			const key = await arweave.wallets.generate();
			const arAddress = await arweave.wallets.jwkToAddress(key);
			// Encrypt the wallet.
			const buf = uint8arrays.fromString(JSON.stringify(key));
			const jwe = await did.createJWE(buf, [did.id]);
			const encData = Arweave.utils.stringToB64Url(JSON.stringify(jwe));
			ethAuth.addMagicWallet({
				arweave: {
					address: arAddress,
					data: encData,
					created_at: Date.now()
				}
			});
			arweaveKey = key;
			arweaveAddress = arAddress;
		} else {
			const { data } = magicWallets.arweave;
			const jwk = await this.processMagicArweaveJwk(ethAuth.did, data);
			arweaveAddress = await arweave.wallets.jwkToAddress(jwk);
			arweaveKey = jwk;
		}

		const arAuth = await this.withArweave(
			arweaveAddress,
			Authenticate.nativeArweaveProvider(arweaveKey),
			Connections.MAGIC
		);

		await this.loadOwnerForAuth(ethAuth);
		await this.loadOwnerForAuth(arAuth);

		return [ethAuth, arAuth];
	}

	/**
	 * Get JWK associated to Magic Wallet
	 *
	 * @return  {JWKInterface}
	 */
	public async getMagicArweaveJwk() {
		const ethAuth = this.auths.find(
			(a) =>
				a.wallet.connection === Connections.MAGIC &&
				a.wallet.chain === Chains.ETHEREUM
		);
		if (!ethAuth) {
			throw new Error("Genisis Magic Wallet not Connected");
		}
		const magicWallets = await ethAuth.getMagicWallets();
		if (!(magicWallets || {}).arweave) {
			throw new Error("Magic Arweave Wallet not Connected");
		}
		const { data } = magicWallets.arweave;
		const jwk = await this.processMagicArweaveJwk(ethAuth.did, data);
		return jwk;
	}

	private async processMagicArweaveJwk(
		genisisDid: DID,
		data: string
	): Promise<JWKInterface> {
		const str = Arweave.utils.b64UrlToString(data);
		const enc = JSON.parse(str);
		const dec = await genisisDid.decryptJWE(enc);
		const keyStr = uint8arrays.toString(dec);
		const jwk = JSON.parse(keyStr);
		return jwk as JWKInterface;
	}

	/**
	 * Manage Owner formation for connected wallet
	 * What we could see here:
	 * 1. Wallet connects and creates owner
	 * 2. 2nd Wallet connects immediatley after and Merges its Owner into the Created Owner.
	 * * This method must be executed sequentially, rather than in parallel to prevent conflicts or missed data dependencies
	 * * ie. Auth 1 creates wallet, but before it's finished Auth 2 connects it's wallet, and doesn't see that there is an owner loaded.
	 * * To solve for this, we're creating a micro queue for this process.
	 *
	 * @param   {WalletAuth}  auth  Authentication of a Wallet DID
	 *
	 * @return  {void}
	 */
	private async loadOwnerForAuth(auth: WalletAuth) {
		const setOwner = (owner: OwnerAuth) => {
			this.owner = owner;
		};
		const getOwner = () => this.owner;

		await queue.add(async () => {
			let loadedOwner = null;
			const shareableOwnerId = await auth.getShareableOwnerId();
			if (shareableOwnerId) {
				// Authenticate the shareable owner
				// The reason for this is to determine whether this auth owner has undergone any migrations.
				loadedOwner = new OwnerAuth();
				const usedId = await loadedOwner.connect(shareableOwnerId, auth.did);
				if (usedId !== shareableOwnerId) {
					// Update the shareable owner id for this wallet
					await auth.setShareableOwnerId(usedId);
				}
			}

			const owner = getOwner();
			if (loadedOwner) {
				if (owner) {
					// Is there an existing owner?
					if (owner.id !== loadedOwner.id) {
						// If the owners are different
						// Start the migration of loadedOwner into this.owner
						if (owner.authorities.length === 0) {
							throw ono(`No authorities for owner: ${owner.id}`);
						}
						const ownerAuthority = this.auths.find((a) =>
							owner.authorities.includes(a.did.id)
						);
						if (!ownerAuthority) {
							throw ono(`No authenticated Wallet DID for owner`, {
								ownerId: owner.id,
								wallets: this.auths.map((a) => a.did.id)
							});
						}
						await owner.merge(ownerAuthority.did, loadedOwner);
					}
					// If the owners are the same, then we've verified that the owners are the same.
				} else {
					// Set this.owner to loadedOwner
					setOwner(loadedOwner);
				}
			} else if (owner) {
				// If loaded owner is not fetched and this.owner exists, set the auth's owner to this.owner.
				await auth.setShareableOwnerId(owner.id);
			} else {
				// Create new owner for this authentication.
				// If loaded owner is not fetched and this.owner does NOT exists, create a new Shareable owner.
				// Create a new shareableOwner if none already loaded and none fetched.
				const newOwner = new OwnerAuth();
				await newOwner.create(auth);
				setOwner(newOwner);
			}
		});
	}

	private static nativeArweaveProvider(jwk: Object) {
		return {
			// We're reimplementing the signature mechanism to allow for 0 salt length -- as the ArweaveJS forces 32
			async signature(data: Uint8Array, algorithm: RsaPssParams) {
				// For reference, see https://github.com/ArweaveTeam/arweave-js/blob/master/src/common/lib/crypto/webcrypto-driver.ts#L110
				const k = await crypto.subtle.importKey(
					"jwk",
					jwk,
					{
						name: "RSA-PSS",
						hash: {
							name: "SHA-256"
						}
					},
					false,
					["sign"]
				);
				// For reference, see: https://github.com/ArweaveTeam/arweave-js/blob/master/src/common/lib/crypto/webcrypto-driver.ts#L48
				const sig = await crypto.subtle.sign(algorithm, k, data);
				return new Uint8Array(sig);
			}
		};
	}

	public static getInstance() {
		if (!this.instance) {
			this.instance = new Authenticate();
		}
		return this.instance;
	}
}

export default Authenticate;
