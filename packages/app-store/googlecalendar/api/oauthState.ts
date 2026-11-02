import process from "node:process";
import { HttpError } from "@calcom/lib/http-error";
import type { NextApiRequest } from "next";
import { z } from "zod";
import { decodeOAuthState } from "../../_utils/oauth/decodeOAuthState";
import { encodeOAuthState } from "../../_utils/oauth/encodeOAuthState";

const redirectSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value));
const optionsSchema = z.object({
  returnTo: redirectSchema.optional(),
  onErrorReturnTo: redirectSchema.optional(),
  fromApp: z.boolean().optional(),
  installGoogleVideo: z.boolean().optional(),
  teamId: z.number().int().positive().optional(),
  defaultInstall: z.boolean().optional(),
});
const signedSchema = optionsSchema.extend({
  nonce: z.string().min(1).max(256),
  nonceHash: z.string().regex(/^[a-f0-9]{64}$/),
});

function parseState(raw: NextApiRequest["query"][string], signed: boolean) {
  if (raw === undefined && !signed) return {};
  try {
    if (typeof raw !== "string") throw new Error();
    return (signed ? signedSchema : optionsSchema).parse(JSON.parse(raw));
  } catch {
    throw new HttpError({ statusCode: 400, message: "Invalid Google OAuth state" });
  }
}

export function encodeGoogleOAuthState(req: NextApiRequest) {
  const options = parseState(req.query.state, false);
  if (!req.session?.user?.id || !process.env.NEXTAUTH_SECRET) {
    throw new HttpError({ statusCode: 500, message: "Google OAuth state signing unavailable" });
  }
  const stateRequest = Object.create(req) as NextApiRequest;
  stateRequest.query = { ...req.query, state: JSON.stringify(options) };
  const state = encodeOAuthState(stateRequest);
  if (!state) throw new HttpError({ statusCode: 500, message: "Google OAuth state signing unavailable" });
  return state;
}

export function decodeGoogleOAuthState(req: NextApiRequest) {
  parseState(req.query.state, true);
  const state = decodeOAuthState(req);
  if (!state) throw new HttpError({ statusCode: 400, message: "Invalid Google OAuth state" });
  return state;
}
