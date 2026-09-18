import { NextResponse } from "next/server";

import {
  CompanyProfileValidationError,
  getDefaultCompanyProfile,
  saveDefaultCompanyProfile,
  type CompanyProfile,
  type CompanyProfileInput,
} from "@/lib/company/profile";

export const runtime = "nodejs";

function publicProfile(profile: CompanyProfile | null) {
  if (!profile) return null;
  return {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function invalid(message: string) {
  return NextResponse.json(
    { error: { code: "invalid_company_profile", message } },
    { status: 400 },
  );
}

function stringOrNull(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new CompanyProfileValidationError(`${field} must be text.`);
  }
  return value;
}

function stringList(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new CompanyProfileValidationError(`${field} must be a list of text values.`);
  }
  return value as string[];
}

function numberOrNull(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number") {
    throw new CompanyProfileValidationError(`${field} must be a number or null.`);
  }
  return value;
}

function parseBody(value: unknown): CompanyProfileInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CompanyProfileValidationError("Request body must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  if (typeof body.name !== "string") {
    throw new CompanyProfileValidationError("Company name is required.");
  }

  return {
    name: body.name,
    legalName: stringOrNull(body.legalName, "Legal name"),
    description: stringOrNull(body.description, "Description"),
    uei: stringOrNull(body.uei, "UEI"),
    cageCode: stringOrNull(body.cageCode, "CAGE code"),
    websiteUrl: stringOrNull(body.websiteUrl, "Website"),
    productsServices: stringList(body.productsServices, "Products and services"),
    capabilities: stringList(body.capabilities, "Capabilities"),
    preferredIndustries: stringList(body.preferredIndustries, "Preferred industries"),
    preferredKeywords: stringList(body.preferredKeywords, "Preferred keywords"),
    excludedKeywords: stringList(body.excludedKeywords, "Excluded keywords"),
    serviceAreas: stringList(body.serviceAreas, "Service areas"),
    preferredContractMin: numberOrNull(body.preferredContractMin, "Minimum contract value"),
    preferredContractMax: numberOrNull(body.preferredContractMax, "Maximum contract value"),
    naicsCodes: stringList(body.naicsCodes, "NAICS codes"),
    certifications: stringList(body.certifications, "Certifications"),
    statuses: stringList(body.statuses, "Statuses"),
    licenses: stringList(body.licenses, "Licenses"),
    governmentRegistrations: stringList(body.governmentRegistrations, "Government registrations"),
    pastPerformance: stringList(body.pastPerformance, "Past performance"),
  };
}

export async function GET() {
  try {
    return NextResponse.json({ profile: publicProfile(await getDefaultCompanyProfile()) });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "company_profile_unavailable",
          message: "Company profile is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("Request body must be valid JSON.");
  }

  try {
    const profile = await saveDefaultCompanyProfile(parseBody(body));
    return NextResponse.json({ profile: publicProfile(profile) });
  } catch (error) {
    if (error instanceof CompanyProfileValidationError) {
      return invalid(error.message);
    }
    return NextResponse.json(
      {
        error: {
          code: "company_profile_save_failed",
          message: "Company profile could not be saved.",
        },
      },
      { status: 503 },
    );
  }
}
