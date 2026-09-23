/** Verified authoritative listing evidence, never a made-up document citation. */
export type ListingEvidence = {
  sourceRecordId: string;
  payloadHash: string;
  sourceRevisionId: string | null;
  field: "description" | "title" | "dueAt" | "location" | "agencyName" | "ebid.lineItems";
  excerpt: string;
};
export type AuthoritativeListingContext = {
  record: { id: string; payloadHash: string; sourceRevisionId: string | null; rawPayload: Record<string, unknown> };
  listing: {
    sourceRecordId: string; title: string; description: string | null; dueAt: Date | null;
    agencyName: string | null; location: Record<string, unknown>;
    fieldProvenance: Record<string, unknown>;
  };
};
function plain(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}
function normalize(value: string) {
  return plain(value).toLowerCase().normalize("NFKC").replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}
function rawStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(rawStrings);
  return Object.values(value).flatMap(rawStrings);
}
function authoritative(source: AuthoritativeListingContext, field: ListingEvidence["field"]) {
  const proof = source.listing.fieldProvenance[field];
  return source.record.id === source.listing.sourceRecordId &&
    /^[a-f0-9]{64}$/i.test(source.record.payloadHash) &&
    Boolean(proof && typeof proof === "object" && !Array.isArray(proof) &&
      (proof as Record<string, unknown>).authority === "authoritative" &&
      (proof as Record<string, unknown>).sourceRecordPk === source.record.id);
}
const STOP = new Set(["the","and","for","with","this","that","all","from","into","each","such",
  "will","shall","must","should","provide","requires","required","seeking","city","bid",
  "bids","bidder","offered","based","including","include","one","are","have",
  "per","its","was","who","which","after","before","not","be","by","at","to","of",
  "in","on","or","as","a","an","is","it","us","tx","texas"]);
function stem(value: string) {
  if (value === "licenses" || value === "license" || value === "licence") return "licens";
  if (value === "annually" || value === "annual") return "annual";
  if (value === "polls" || value === "polling") return "poll";
  if (value.length > 5 && value.endsWith("ies")) return value.slice(0,-3)+"y";
  if (value.length > 5 && value.endsWith("s")) return value.slice(0,-1);
  return value;
}
function tokens(value: string) {
  return normalize(value).split(" ").filter(Boolean).map(stem);
}
/** Brief quantitative findings have one semantic term, so the usual two-term
 * overlap rule cannot establish provenance. Require the *entire* finding to
 * be one numeric amount immediately followed by its unit in the raw listing.
 * Different quantities, units or additional commitments are never inferred. */
function exactShortQuantityClaim(text: string, source: string) {
  const claim = normalize(text);
  if (!/^\d+(?:\.\d+)? [\p{L}][\p{L}\p{N}]*$/u.test(claim)) return false;
  const available = normalize(source);
  return available.split(" ").some((token,index,all) =>
    index+1<all.length && token+" "+all[index+1]===claim);
}
function supportsClaim(text: string, source: string) {
  const claim = tokens(text), available = new Set(tokens(source));
  if (claim.some((t) => /^\d+$/.test(t) && !available.has(t))) return false;
  const meaningful = [...new Set(claim.filter((t) => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t)))];
  if (meaningful.length < 2) return exactShortQuantityClaim(text,source);
  const matched = meaningful.filter((t) => available.has(t)).length;
  return matched >= 2 && matched / meaningful.length >= 0.6;
}
/** Compare absolute UTC instants, never just the same calendar date or an assumed local time zone. */
function sameAuthoritativeUtcDeadline(text:string, expectedIso:string) {
  if (text.includes(expectedIso)) return true;
  const match = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z\b/i.exec(text);
  if (!match) return false;
  const month = ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(match[1]!.toLowerCase());
  const year=Number(match[3]),day=Number(match[2]),hour=Number(match[4]),
    minute=Number(match[5]),second=Number(match[6]),millisecond=Number((match[7]??"0").padEnd(3,"0"));
  const candidate=new Date(Date.UTC(year,month,day,hour,minute,second,millisecond));
  return candidate.getUTCFullYear()===year && candidate.getUTCMonth()===month &&
    candidate.getUTCDate()===day && candidate.getUTCHours()===hour &&
    candidate.getUTCMinutes()===minute && candidate.getUTCSeconds()===second &&
    candidate.toISOString()===expectedIso;
}
function fieldSource(source: AuthoritativeListingContext, field: ListingEvidence["field"]): string | null {
  const raw = rawStrings(source.record.rawPayload);
  const {listing} = source;
  if (field === "description") {
    const value = listing.description?.trim();
    return value && raw.some((item) => item.trim() === value) ? plain(value) : null;
  }
  if (field === "title" || field === "agencyName") {
    const value = listing[field]?.trim();
    return value && raw.includes(value) ? value : null;
  }
  if (field === "dueAt") {
    const value = listing.dueAt?.toISOString();
    return value && raw.includes(value) ? value : null;
  }
  const location = listing.location;
  const locality = typeof location.locality === "string" ? location.locality : null;
  const region = typeof location.region === "string" ? location.region : null;
  if (!locality || !region) return null;
  const all = tokens(raw.join(" "));
  if (!tokens(locality).every((token) => all.includes(token)) ||
    !tokens(region).every((token) => all.includes(token))) return null;
  return [listing.agencyName,locality,region,
    typeof location.country === "string" ? location.country : null].filter(Boolean).join(", ");
}
export function resolveAuthoritativeListingEvidence(input: {
  source: AuthoritativeListingContext; section: string; text: string;
}): ListingEvidence | null {
  const {source,section,text} = input;
  const fields: ListingEvidence["field"][] =
    section === "location" ? ["location"] :
    section === "schedule" && /\b(?:due|deadline|closing|submit bids|bids no later than)\b/i.test(text) ? ["dueAt"] :
    section === "scope" ? ["description","title"] : ["description"];
  for (const field of fields) {
    if (!authoritative(source,field)) continue;
    const sourceText = fieldSource(source,field);
    if (!sourceText) continue;
    const supported = field === "dueAt"
      ? sameAuthoritativeUtcDeadline(text,sourceText)
      : field === "location"
        ? Boolean(source.listing.location.locality && source.listing.location.region &&
          normalize(text).includes(normalize(String(source.listing.location.locality))) &&
          (normalize(text).includes(normalize(String(source.listing.location.region))) ||
            normalize(text).includes(" texas")) &&
          !/[0-9]/.test(text) && !/\b(?:fob|destination|purchase orders?|shipping|freight)\b/i.test(text))
        : supportsClaim(text,sourceText);
    if (!supported) continue;
    return {
      sourceRecordId:source.record.id,payloadHash:source.record.payloadHash,
      sourceRevisionId:source.record.sourceRevisionId,field,excerpt:sourceText.slice(0,3_000),
    };
  }
  return null;
}
/** Recovery requires a substantial *verbatim* clause from a verified extraction. */
export function findVerbatimRequirementPassage(content: string, requirement: string): string | null {
  if (!content.trim() || !requirement.trim()) return null;
  const sourceNumeric = new Set(tokens(content).filter((token) => /^\d+$/.test(token)));
  if (tokens(requirement).some((token) => /^\d+$/.test(token) && !sourceNumeric.has(token))) return null;
  const fragments = requirement.match(/\([^)]{30,}\)|[^.;:()]{35,}/g) ?? [];
  for (const fragment of fragments) {
    const quote = fragment.replace(/^[\s(]+|[\s).]+$/g,"").trim();
    if (quote.length < 35 || tokens(quote).length < 6) continue;
    const pattern = quote.replace(/[.*+?^$|()[\]{}\\]/g,"\\$&").replace(/\s+/g,"\\s+");
    const match = new RegExp(pattern,"i").exec(content);
    if (match) return content.slice(Math.max(0,match.index-170),Math.min(content.length,match.index+310)).trim();
  }

  // Agency terms sometimes spell the same defined delivery clause "F.O.B.".
  // Accept only this substantial, exact source clause (never a vague shipping
  // reference, a fabricated document segment, or a weaker FOB shipping-point term).
  const fobClause=/F\.?\s*O\.?\s*B\.?\s*destination\s+point\s+as\s+listed\s+on\s+(?:the\s+)?individual\s+Purchase\s+Orders/i;
  if (fobClause.test(requirement)) {
    const sourceClause=fobClause.exec(content);
    if (sourceClause) return content.slice(Math.max(0,sourceClause.index-170),
      Math.min(content.length,sourceClause.index+310)).trim();
  }
  return null;
}
