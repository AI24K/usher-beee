import { AuthApiRequest } from "@/types";
import { useRouteHandler } from "@/server/middleware";
import withAuth from "@/server/middleware/auth";

const handler = useRouteHandler<AuthApiRequest>();

/**
 * GET: Stub endpoint used to index DIDs passed as authorisation
 */
handler.router.use(withAuth).get(async (req, res) => {
	return res.json({
		success: true
	});
});

export default handler.handle();
