import type { NextApiRequest, NextApiResponse } from "next";
import { renewalMaintenanceUnavailable } from "../../renewal-maintenance";

// Invalid or oversized bodies must not replace the fixed maintenance response with a parser error.
export const config = { api: { bodyParser: false } };

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const response = renewalMaintenanceUnavailable();
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  return res.status(response.status).send(await response.text());
}
