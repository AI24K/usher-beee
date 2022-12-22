import { getAppDID } from "@/server/did";
import { useRouteHandler } from "@/server/middleware";
import { getArangoClient } from "@/utils/arango-client";
import { getArweaveClient } from "@/utils/arweave-client";
import { ceramic } from "@/utils/ceramic-client";
import { TileLoader } from "@glazed/tile-loader";
import {
	Advertiser,
	AdvertiserDoc,
	advertiserDocSchema,
	Campaign,
	CampaignDetails,
	CampaignDetailsDoc,
	campaignDetailsDocSchema,
	CampaignDoc,
	campaignDocSchema
} from "@usher.so/campaigns";
import { Chains } from "@usher.so/shared";
import { aql } from "arangojs";
import camelcaseKeys from "camelcase-keys";
import { ethers } from "ethers";
import { Base64 } from "js-base64";
import { fromString } from "uint8arrays";

type CampaignlWallet = {
	address: string;
	key: string;
};

const handler = useRouteHandler();
const arango = getArangoClient();
const arweave = getArweaveClient();

/**
 * Loads an origin campaign from Arweave
 * @param id
 * @returns
 */
async function getOriginCampaing(id: string): Promise<CampaignDoc> {
	const data = (await arweave.transactions.getData(id, {
		decode: true,
		string: true
	})) as string;

	const json = JSON.parse(data);

	return campaignDocSchema.parseAsync(json);
}

/**
 * Loads an Owner of the origin campaign from Arweave
 * @param id
 * @returns
 */
async function getOriginCampaingOwner(id: string): Promise<string> {
	const transaction = await arweave.transactions.get(id);
	return transaction.owner_address;
}

/**
 * Loads a campaign from Arango database
 * @param chain
 * @param id
 * @returns
 */
async function loadCampaignByOrigin(origin: string): Promise<Campaign> {
	const dataCursor = await arango.query(aql`
		FOR campaign IN Campaigns
			FILTER campaign.origin == ${origin}
			RETURN UNSET(campaign, "_key", "_id", "_rev", "_internal")
	`);
	const [campaign] = await dataCursor.all();
	return campaign;
}

/**
 * Inserts a campaign to Arango database
 * @param campaign
 */
async function insertCampaing(
	campaign: Campaign & { _internal: CampaignlWallet }
) {
	const doc = {
		_key: [campaign.chain, campaign.id].join(":"),
		...campaign
	};

	const cursor = await arango.query(aql`
		INSERT ${doc}
		IN Campaigns OPTIONS { waitForSync: true }
	`);

	await cursor.all();
}

/**
 * Updates a campaing in Arango database
 * @param campaign
 */
async function updateCampaing(campaign: Campaign) {
	const doc = {
		_key: [campaign.chain, campaign.id].join(":")
	};

	const cursor = await arango.query(aql`
		UPDATE ${doc}
		WITH {
			details: ${campaign.details},
			advertiser: ${campaign.advertiser}
		}
		IN Campaigns OPTIONS { waitForSync: true }
	`);

	await cursor.all();
}

/**
 * Reads campaign's advertiser from Ceramic stream
 * @param streamId
 * @returns
 */
async function getCampaignAdvertiser(streamId: string): Promise<Advertiser> {
	try {
		const loader = new TileLoader({ ceramic });
		const stream = await loader.load<AdvertiserDoc>(streamId);
		const advertiserDoc = stream.content;

		// Validate the received details
		await advertiserDocSchema.parseAsync(advertiserDoc);

		const advertiser = camelcaseKeys(advertiserDoc);
		return advertiser;
	} catch {
		// TODO: Hande errors
		throw new Error("Unable to get Advertiser");
	}
}

/**
 * Reads campaign's details from Ceramic stream
 * @param streamId
 * @returns
 */
async function getCampaignDetails(streamId: string): Promise<CampaignDetails> {
	try {
		const loader = new TileLoader({ ceramic });
		const stream = await loader.load<CampaignDetailsDoc>(streamId);
		const detailsDoc = stream.content;

		// Validate the received details
		await campaignDetailsDocSchema.parseAsync(detailsDoc);

		const details = camelcaseKeys(detailsDoc);
		return details;
	} catch {
		// TODO: Hande errors
		throw new Error("Unable to get Campaign Details");
	}
}

/**
 * Creates a wallet for a chain, with a private key encrypted by the app's DID
 * @param chain
 * @returns
 */
async function createWallet(chain: Chains): Promise<CampaignlWallet> {
	let address: string;
	let key: string;

	if (chain === Chains.ARWEAVE) {
		const jwk = await arweave.wallets.generate();
		address = await arweave.wallets.getAddress(jwk);
		key = JSON.stringify(jwk);
	} else {
		// chain === Chains.ETHEREUMM
		const wallet = ethers.Wallet.createRandom();
		address = wallet.address;
		key = wallet.privateKey;
	}

	const did = await getAppDID();
	const jwe = await did.createJWE(fromString(JSON.stringify(key)), [did.id]);
	key = Base64.encode(JSON.stringify(jwe));

	return {
		address,
		key
	};
}

handler.router.get(async (req, res) => {
	const { id } = req.query;

	if (typeof id !== "string") {
		return res.status(400).json({
			success: false
		});
	}

	const originCampaign = await getOriginCampaing(id);
	const { chain } = originCampaign;
	const indexedCampaign = await loadCampaignByOrigin(id);

	const details = await getCampaignDetails(originCampaign.details);
	const advertiser = await getCampaignAdvertiser(originCampaign.advertiser);

	if (!indexedCampaign) {
		const owner = await getOriginCampaingOwner(id);
		const internalWallet = await createWallet(chain);
		const campaign = {
			id: internalWallet.address,
			chain,
			owner,
			origin: id,
			disableVerification: originCampaign.disable_verification,
			events: originCampaign.events,
			reward: originCampaign.reward,
			details,
			advertiser,
			_internal: {
				address: internalWallet.address,
				key: internalWallet.key
			}
		} as Campaign & { _internal: CampaignlWallet };
		await insertCampaing(campaign);
	} else {
		const campaign: Campaign = {
			id: indexedCampaign.id,
			chain: indexedCampaign.chain,
			details,
			advertiser
		} as Campaign;
		await updateCampaing(campaign);
	}

	const resultCampaign = await loadCampaignByOrigin(id);

	return res.json({
		success: true,
		campaign: resultCampaign
	});
});

export default handler.handle();
