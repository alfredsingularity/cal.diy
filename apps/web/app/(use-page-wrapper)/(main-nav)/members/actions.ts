"use server";

import { requireUserId } from "@calcom/web/app/cache/requireUserId";
import { revalidateTag } from "next/cache";

export async function revalidateAttributesList() {
  await requireUserId();
  revalidateTag("viewer.attributes.list", "max");
}
