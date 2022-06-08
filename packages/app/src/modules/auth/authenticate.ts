import { DID } from "dids";
import * as uint8arrays from "uint8arrays";
import { Sha256 } from "@aws-crypto/sha256-browser";
import Arweave from "arweave";
import { JWKInterface } from "arweave/node/lib/wallet";

import getMagicClient from "@/utils/magic-client";
import getArweaveClient from "@/utils/arweave-client";
import { Chains, Wallet, Connections, Partnership } from "@/types";
import Auth from "./authentication";

const arweave = getArweaveClient();
const CERAMIC_PARTNERSHIPS_KEY = "partnerships";
const CERAMIC_PROFILES_KEY = "profiles";
const NETWORK_DID = "did:key:z6MkwVNrdkjiAzEFoWVq9J1R28gyUpA3Md7Bdx8DaABhQzVX";

class Authenticate {
	protected auths: Auth[] = [];

	protected owner: Auth | null = null;

	protected partnerships: Partnership[] = [];

	private static instance: Authenticate | null;

	private add(auth: Auth) {
		this.auths.push(auth);
	}

	private exists(o: DID | Auth) {
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

	public getPartnerships() {
		return this.partnerships;
	}

	public getOwner() {
		return this.owner;
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
	): Promise<Auth> {
		const arr = uint8arrays.fromString(walletAddress);
		const sig = await provider.signature(arr, {
			name: "RSA-PSS",
			saltLength: 0 // This ensures that no additional salt is produced and added to the message signed.
		});

		const hash = new Sha256();
		hash.update(uint8arrays.toString(sig));
		const entropy = await hash.digest();

		const auth = new Auth();
		await auth.connect(walletAddress, entropy, Chains.ARWEAVE, connection);
		const { did } = auth;

		// If wallet DID does not exist, push and activate it
		if (!this.exists(did)) {
			this.add(auth);
		}

		return auth;
	}

	/**
	 * Authenticate with Magic -- assumes that user is authenticated
	 *
	 * Create a DID for Magic Eth wallet.
	 * If no existing Magic wallet exists, create a JWK wallet and encrypt with Eth Signer
	 * Push the encrypted JWK wallet to Ceramic under a "MagicWallets" stream
	 */
	public async withMagic(): Promise<Auth[]> {
		const { ethProvider } = getMagicClient();

		const signer = ethProvider.getSigner();
		const address = await signer.getAddress();
		const sig = await signer.signMessage(address);
		const hash = new Sha256();
		hash.update(sig);
		const entropy = await hash.digest();

		const ethAuth = new Auth();
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
			const enc = await did.createJWE(buf, [did.id]);
			const encData = Arweave.utils.stringToB64Url(JSON.stringify(enc));
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
			const jwk = this.processMagicArweaveJwk(ethAuth.did, data);
			arweaveAddress = await arweave.wallets.jwkToAddress(jwk);
			arweaveKey = jwk;
		}

		const arAuth = await this.withArweave(
			arweaveAddress,
			Authenticate.nativeArweaveProvider(arweaveKey),
			Connections.MAGIC
		);

		return [ethAuth, arAuth];
	}

	/**
	 * Add Campaign to Partnerships and load new index
	 * 1. Creates a new partnership stream
	 * 2. Adds partnership stream to the ShareableOwner DID Data Store
	 *
	 * @param   {Partnership}  partnership  new partnership to add
	 *
	 * @return  {[type]}                    [return description]
	 */
	public async addPartnership(partnership: Partnership) {
		this.partnerships.push(partnership);
		await this.store.set(CERAMIC_PARTNERSHIP_KEY, {
			set
		});
		const defId = this.store.getDefinitionID(CERAMIC_PARTNERSHIP_KEY);
		const recordId = await this.store.getRecordID(defId);
		if (!recordId) {
			throw new Error(
				`Cannot get Parterships ID at Definition ${defId} for DID ${this._did.id}`
			);
		}
		const setId = ceramicUtils.urlToId(recordId);
		this._partnerships = set.map((c, i) => ({
			id: [setId, i].join("/"),
			campaign: c
		}));
		return this._partnerships;
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
