"use client";

import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { useState } from "react";

export type CompanyProfileClientState = {
  id: string;
  name: string;
  legalName: string | null;
  description: string | null;
  uei: string | null;
  cageCode: string | null;
  websiteUrl: string | null;
  productsServices: string[];
  capabilities: string[];
  preferredIndustries: string[];
  preferredKeywords: string[];
  excludedKeywords: string[];
  serviceAreas: string[];
  preferredContractMin: number | null;
  preferredContractMax: number | null;
  naicsCodes: string[];
  certifications: string[];
  statuses: string[];
  licenses: string[];
  governmentRegistrations: string[];
  pastPerformance: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  name: string;
  legalName: string;
  description: string;
  uei: string;
  cageCode: string;
  websiteUrl: string;
  productsServices: string;
  capabilities: string;
  preferredIndustries: string;
  preferredKeywords: string;
  excludedKeywords: string;
  serviceAreas: string;
  preferredContractMin: string;
  preferredContractMax: string;
  naicsCodes: string;
  certifications: string;
  statuses: string;
  licenses: string;
  governmentRegistrations: string;
  pastPerformance: string;
};

function lines(values: string[]) {
  return values.join("\n");
}

function parseLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function initialState(profile: CompanyProfileClientState | null): FormState {
  return {
    name: profile?.name ?? "",
    legalName: profile?.legalName ?? "",
    description: profile?.description ?? "",
    uei: profile?.uei ?? "",
    cageCode: profile?.cageCode ?? "",
    websiteUrl: profile?.websiteUrl ?? "",
    productsServices: lines(profile?.productsServices ?? []),
    capabilities: lines(profile?.capabilities ?? []),
    preferredIndustries: lines(profile?.preferredIndustries ?? []),
    preferredKeywords: lines(profile?.preferredKeywords ?? []),
    excludedKeywords: lines(profile?.excludedKeywords ?? []),
    serviceAreas: lines(profile?.serviceAreas ?? []),
    preferredContractMin: profile?.preferredContractMin?.toString() ?? "",
    preferredContractMax: profile?.preferredContractMax?.toString() ?? "",
    naicsCodes: lines(profile?.naicsCodes ?? []),
    certifications: lines(profile?.certifications ?? []),
    statuses: lines(profile?.statuses ?? []),
    licenses: lines(profile?.licenses ?? []),
    governmentRegistrations: lines(profile?.governmentRegistrations ?? []),
    pastPerformance: lines(profile?.pastPerformance ?? []),
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "url" | "number";
  hint?: string;
}) {
  return (
    <label className="min-w-0">
      <span className="text-sm font-semibold">{label}</span>
      {hint ? <span className="ml-2 text-xs text-[var(--muted-foreground)]">{hint}</span> : null}
      <input
        type={type}
        value={value}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "0.01" : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-sm outline-none transition focus:border-[var(--primary)]"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
}) {
  return (
    <label className="min-w-0">
      <span className="text-sm font-semibold">{label}</span>
      {hint ? <span className="ml-2 text-xs text-[var(--muted-foreground)]">{hint}</span> : null}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="mt-1.5 w-full min-w-0 resize-y rounded-lg border bg-white px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-[var(--primary)]"
      />
    </label>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

export function CompanyProfileForm({
  initialProfile,
}: {
  initialProfile: CompanyProfileClientState | null;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(initialProfile));
  const [profile, setProfile] = useState(initialProfile);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setPending(true);
    setMessage(null);
    setError(null);

    const minValue = form.preferredContractMin.trim()
      ? Number(form.preferredContractMin)
      : null;
    const maxValue = form.preferredContractMax.trim()
      ? Number(form.preferredContractMax)
      : null;

    if (
      (minValue !== null && !Number.isFinite(minValue)) ||
      (maxValue !== null && !Number.isFinite(maxValue))
    ) {
      setPending(false);
      setError("Preferred contract values must be valid numbers.");
      return;
    }

    try {
      const response = await fetch("/api/company-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          legalName: form.legalName || null,
          description: form.description || null,
          uei: form.uei || null,
          cageCode: form.cageCode || null,
          websiteUrl: form.websiteUrl || null,
          productsServices: parseLines(form.productsServices),
          capabilities: parseLines(form.capabilities),
          preferredIndustries: parseLines(form.preferredIndustries),
          preferredKeywords: parseLines(form.preferredKeywords),
          excludedKeywords: parseLines(form.excludedKeywords),
          serviceAreas: parseLines(form.serviceAreas),
          preferredContractMin: minValue,
          preferredContractMax: maxValue,
          naicsCodes: parseLines(form.naicsCodes),
          certifications: parseLines(form.certifications),
          statuses: parseLines(form.statuses),
          licenses: parseLines(form.licenses),
          governmentRegistrations: parseLines(form.governmentRegistrations),
          pastPerformance: parseLines(form.pastPerformance),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            profile?: CompanyProfileClientState;
            error?: { message?: string };
          }
        | null;

      if (!response.ok || !payload?.profile) {
        setError(payload?.error?.message ?? "Company profile could not be saved.");
        return;
      }

      setProfile(payload.profile);
      setForm(initialState(payload.profile));
      setMessage("Company profile saved.");
    } catch {
      setError("Company profile could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-2xl border bg-[var(--muted)]/35 p-4 text-sm leading-6 text-[var(--muted-foreground)]">
        This profile is the factual input for go/no-go evaluation and future bid drafting. Leave
        unknown qualifications blank rather than guessing; govTract will treat missing information
        as unknown.
      </div>

      <Section
        title="Company identity"
        description="Basic identifiers used to describe the contractor and verify government registrations."
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field
            label="Company name"
            value={form.name}
            onChange={(value) => set("name", value)}
            placeholder="Acme Services"
          />
          <Field
            label="Legal name"
            value={form.legalName}
            onChange={(value) => set("legalName", value)}
            placeholder="Acme Services LLC"
          />
          <Field
            label="Website"
            type="url"
            value={form.websiteUrl}
            onChange={(value) => set("websiteUrl", value)}
            placeholder="https://example.com"
          />
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="UEI" value={form.uei} onChange={(value) => set("uei", value)} />
            <Field
              label="CAGE code"
              value={form.cageCode}
              onChange={(value) => set("cageCode", value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <TextAreaField
            label="Company description"
            value={form.description}
            onChange={(value) => set("description", value)}
            placeholder="What the company does, who it serves, and the work it is equipped to perform."
            rows={4}
          />
        </div>
      </Section>

      <Section
        title="Products, services & capabilities"
        description="Use one item per line. Keep these factual because they will be compared directly against solicitation scope."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <TextAreaField
            label="Products / services"
            value={form.productsServices}
            onChange={(value) => set("productsServices", value)}
            placeholder={"Pump maintenance\nField inspection\nEquipment installation"}
          />
          <TextAreaField
            label="Capabilities"
            value={form.capabilities}
            onChange={(value) => set("capabilities", value)}
            placeholder={"24/7 response\nPreventive maintenance\nProject management"}
          />
        </div>
      </Section>

      <Section
        title="Target work"
        description="Define where and what you want to pursue. These preferences are separate from hard qualifications."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <TextAreaField
            label="Preferred industries"
            value={form.preferredIndustries}
            onChange={(value) => set("preferredIndustries", value)}
            placeholder={"Water utilities\nPublic works\nFacilities"}
          />
          <TextAreaField
            label="Service area"
            value={form.serviceAreas}
            onChange={(value) => set("serviceAreas", value)}
            placeholder={"Houston\nHarris County\nTexas"}
          />
          <TextAreaField
            label="Preferred keywords"
            value={form.preferredKeywords}
            onChange={(value) => set("preferredKeywords", value)}
            placeholder={"maintenance\npumps\ninspection"}
          />
          <TextAreaField
            label="Exclude / avoid keywords"
            value={form.excludedKeywords}
            onChange={(value) => set("excludedKeywords", value)}
            placeholder={"medical\naviation"}
          />
          <TextAreaField
            label="NAICS codes"
            value={form.naicsCodes}
            onChange={(value) => set("naicsCodes", value)}
            placeholder={"811310\n237110"}
            rows={3}
          />
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field
              label="Preferred contract minimum"
              type="number"
              value={form.preferredContractMin}
              onChange={(value) => set("preferredContractMin", value)}
              placeholder="25000"
            />
            <Field
              label="Preferred contract maximum"
              type="number"
              value={form.preferredContractMax}
              onChange={(value) => set("preferredContractMax", value)}
              placeholder="750000"
            />
          </div>
        </div>
      </Section>

      <Section
        title="Qualifications & registrations"
        description="Enter only current facts. These can become hard blockers when a solicitation requires them."
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <TextAreaField
            label="Certifications"
            value={form.certifications}
            onChange={(value) => set("certifications", value)}
            placeholder={"SBE\nMBE"}
          />
          <TextAreaField
            label="Statuses"
            value={form.statuses}
            onChange={(value) => set("statuses", value)}
            placeholder={"Texas HUB\nVeteran-owned"}
          />
          <TextAreaField
            label="Licenses"
            value={form.licenses}
            onChange={(value) => set("licenses", value)}
            placeholder={"Texas Electrical Contractor\nTrade license"}
          />
          <TextAreaField
            label="Government registrations"
            value={form.governmentRegistrations}
            onChange={(value) => set("governmentRegistrations", value)}
            placeholder={"SAM.gov active\nCity supplier registration"}
          />
        </div>
      </Section>

      <Section
        title="Past performance"
        description="Add your own relevant project or performance descriptions, one reference per line. Do not add inferred government history here."
      >
        <TextAreaField
          label="Past-performance references"
          value={form.pastPerformance}
          onChange={(value) => set("pastPerformance", value)}
          placeholder={"Maintained pumping equipment for a municipal water utility.\nCompleted emergency field repairs under a public-sector service contract."}
          rows={6}
        />
      </Section>

      <div className="sticky bottom-4 z-10 flex min-w-0 flex-col gap-2 rounded-2xl border bg-white/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">
          {error ? (
            <p className="break-words text-red-700 [overflow-wrap:anywhere]">{error}</p>
          ) : message ? (
            <p className="inline-flex items-center gap-2 text-[var(--muted-foreground)]">
              <CheckCircle2 className="size-4 shrink-0" />
              {message}
            </p>
          ) : profile ? (
            <p className="text-[var(--muted-foreground)]">
              Last saved {new Date(profile.updatedAt).toLocaleString()}
            </p>
          ) : (
            <p className="text-[var(--muted-foreground)]">Profile has not been saved yet.</p>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}
