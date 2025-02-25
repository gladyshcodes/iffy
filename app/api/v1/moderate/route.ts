import { NextRequest, NextResponse } from "next/server";

import { moderateAdapter, ModerateRequestData } from "./schema";
import * as schema from "@/db/schema";
import { validateApiKey } from "@/services/api-keys";
import { createModeration, moderate } from "@/services/moderations";
import { createOrUpdateRecord } from "@/services/records";
import { createOrUpdateUser } from "@/services/users";
import { parseRequestDataWithSchema } from "@/app/api/parse";
import * as subscriptionsService from "@/services/subscriptions";

export async function POST(req: NextRequest) {
  const { data, error } = await parseRequestDataWithSchema(req, ModerateRequestData, moderateAdapter);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: { message: "Invalid API key" } }, { status: 401 });
  }
  const apiKey = authHeader.split(" ")[1];
  const clerkOrganizationId = await validateApiKey(apiKey);
  if (!clerkOrganizationId) {
    return NextResponse.json({ error: { message: "Invalid API key" } }, { status: 401 });
  }

  const subscription = await subscriptionsService.getTrialSubscription(clerkOrganizationId);
  if (!subscription) {
    return NextResponse.json({ error: { message: "Subscription not found" } }, { status: 403 });
  }

  await subscriptionsService.decrementTrialModerations(subscription.id);

  let user: typeof schema.users.$inferSelect | undefined;
  if (data.user) {
    user = await createOrUpdateUser({
      clerkOrganizationId,
      clientId: data.user.clientId,
      clientUrl: data.user.clientUrl,
      email: data.user.email,
      name: data.user.name,
      username: data.user.username,
      protected: data.user.protected,
      stripeAccountId: data.user.stripeAccountId,
      metadata: data.user.metadata,
    });
  }

  const content = typeof data.content === "string" ? { text: data.content } : data.content;

  const record = await createOrUpdateRecord({
    clerkOrganizationId,
    clientId: data.clientId,
    name: data.name,
    entity: data.entity,
    text: content.text,
    imageUrls: content.imageUrls,
    clientUrl: data.clientUrl,
    userId: user?.id,
    metadata: data.metadata,
  });

  const result = await moderate({
    clerkOrganizationId,
    recordId: record.id,
  });

  const moderation = await createModeration({
    clerkOrganizationId,
    recordId: record.id,
    ...result,
    via: "AI",
  });

  return NextResponse.json(
    {
      status: result.status,
      id: record.id,
      moderation: moderation.id,
      ...(user ? { user: user.id } : {}),
      message: "Success",
      // TODO(s3ththompson): deprecate
      flagged: result.status === "Flagged",
      categoryIds: result.ruleIds,
    },
    { status: 200 },
  );
}
