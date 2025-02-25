import db from "@/db";
import { organizations } from "@/db/tables";
import * as stripeService from "@/services/stripe";

interface CreateOrganisationParams {
  clerkOrgId: string;
  name: string;
}

export async function createOrganisation({ clerkOrgId, name }: CreateOrganisationParams) {
  let stripeCustomer;
  let organization;

  try {
    stripeCustomer = await stripeService.createCustomer({
      clerkOrgId,
      name,
    });
  } catch (error) {
    console.error("Failed to create Stripe customer:", error);
    throw error;
  }

  try {
    [organization] = await db
      .insert(organizations)
      .values({
        clerkOrgId,
        stripeCustomerId: stripeCustomer.id,
      })
      .returning();

    if (!organization) {
      throw new Error("Failed to create organization");
    }

    await stripeService.createFreeSubscription(stripeCustomer.id, organization.id);

    return organization;
  } catch (error) {
    console.error("Failed to create organization in DB:", error);
    if (stripeCustomer?.id) {
      try {
        await stripeService.deleteCustomer(stripeCustomer.id);
      } catch (deleteError) {
        console.error("Failed to delete Stripe customer during rollback:", deleteError);
      }
    }
    throw error;
  }
}
