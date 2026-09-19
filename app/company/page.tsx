import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import {
  CompanyProfileForm,
  type CompanyProfileClientState,
} from "@/components/company-profile-form";
import { SectionShell } from "@/components/section-shell";
import { getDefaultCompanyProfile } from "@/lib/company/profile";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Company",
};

export default async function CompanyPage() {
  const profile = await getDefaultCompanyProfile();
  const initialProfile: CompanyProfileClientState | null = profile
    ? {
        ...profile,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      }
    : null;

  return (
    <SectionShell
      eyebrow="Profile"
      title="Company"
      description="Maintain factual contractor information used for bid preparation, AI-assisted drafting, and your own reference."
      icon={Building2}
    >
      <CompanyProfileForm initialProfile={initialProfile} />
    </SectionShell>
  );
}
