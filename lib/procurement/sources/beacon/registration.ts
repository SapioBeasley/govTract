import type { BeaconRegistrationProfile } from "./session-transport";

export type BeaconRegistrationInterest = "Bidder" | "Watcher" | "Other";

export const CREATE_PLANHOLDER_QUERY = `mutation createPlanholder($planholder: CreateSolicitationRegistrationInput!) {
  createPlanholder(planholder: $planholder) {
    supplier { id __typename }
    __typename
  }
}`;

export function buildBeaconPlanholderRegistrationRequest(input: {
  solicitationId: string;
  profile: BeaconRegistrationProfile;
  interest?: BeaconRegistrationInterest;
}) {
  return {
    operationName: "createPlanholder",
    variables: {
      planholder: {
        options: { emailDocument: false },
        solicitationId: input.solicitationId,
        contact: {
          interest: input.interest ?? "Bidder",
          position: input.profile.position,
          name: input.profile.name,
          email: input.profile.email,
          phone: input.profile.phone,
          regionId: input.profile.regionId,
          company: {
            name: input.profile.companyName,
            specialDesignations: input.profile.specialDesignations,
            location: { regionId: input.profile.companyRegionId },
          },
        },
      },
    },
    query: CREATE_PLANHOLDER_QUERY,
  };
}

export function parseBeaconPlanholderRegistrationResponse(status: number, body: string) {
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(body);
    parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }

  const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
  const data =
    parsed?.data && typeof parsed.data === "object"
      ? (parsed.data as Record<string, unknown>)
      : null;
  const createPlanholder =
    data?.createPlanholder && typeof data.createPlanholder === "object"
      ? (data.createPlanholder as Record<string, unknown>)
      : null;
  const supplier =
    createPlanholder?.supplier && typeof createPlanholder.supplier === "object"
      ? (createPlanholder.supplier as Record<string, unknown>)
      : null;

  return {
    status,
    ok:
      status >= 200 &&
      status < 300 &&
      errors.length === 0 &&
      typeof supplier?.id === "string" &&
      supplier.id.length > 0,
    graphqlErrorCount: errors.length,
    supplierPresent: typeof supplier?.id === "string" && supplier.id.length > 0,
  };
}
