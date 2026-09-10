export type OpportunityIdentityMatchMethod =
  | "same_source_record"
  | "agency_solicitation"
  | "strong_composite";

export type OpportunityIdentitySignal =
  | "same_source_record"
  | "agency"
  | "solicitation_number"
  | "title"
  | "published_date"
  | "issue_date"
  | "due_date"
  | "location"
  | "document_fingerprint";

export interface OpportunitySourceIdentity {
  source: string;
  sourceRecordId: string;
}

export interface OpportunityIdentityInput {
  source: string;
  sourceRecordId: string;
  agencyKey?: string | null;
  solicitationNumber?: string | null;
  title: string;
  publishedAt?: Date | null;
  issueAt?: Date | null;
  dueAt?: Date | null;
  location?: Record<string, unknown> | null;
  documentFingerprints?: readonly string[];
}

export interface OpportunityIdentityCandidate {
  opportunityId: string;
  sourceRecords: readonly OpportunitySourceIdentity[];
  agencyKey?: string | null;
  solicitationNumber?: string | null;
  title: string;
  publishedAt?: Date | null;
  issueAt?: Date | null;
  dueAt?: Date | null;
  location?: Record<string, unknown> | null;
  documentFingerprints?: readonly string[];
}

export interface OpportunityIdentityEvidence {
  score: number;
  signals: OpportunityIdentitySignal[];
  titleSimilarity?: number;
  matchedDocumentFingerprints?: string[];
  conflicts?: string[];
}

export interface ScoredOpportunityIdentityCandidate {
  opportunityId: string;
  method: OpportunityIdentityMatchMethod;
  confidence: number;
  evidence: OpportunityIdentityEvidence;
}

export type OpportunityIdentityDecision =
  | ({ kind: "match" } & ScoredOpportunityIdentityCandidate)
  | { kind: "ambiguous"; candidates: ScoredOpportunityIdentityCandidate[] }
  | { kind: "new"; candidates: ScoredOpportunityIdentityCandidate[] };

const HOUR_MS = 60 * 60 * 1000;
const TITLE_STOP_WORDS = new Set(["a", "an", "and", "for", "of", "the", "to"]);

function normalizeSource(value: string) {
  return value.trim().toLowerCase();
}

function normalizeRecordId(value: string) {
  return value.trim().toLowerCase();
}

function normalizeCompact(value?: string | null) {
  if (!value) return "";
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeSolicitationIdentity(value?: string | null) {
  return normalizeCompact(value);
}

function normalizeAgencyIdentity(value?: string | null) {
  return normalizeCompact(value);
}

function titleTokens(value: string) {
  return new Set(
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((token) => token && !TITLE_STOP_WORDS.has(token)),
  );
}

export function opportunityTitleSimilarity(left: string, right: string) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function datesNear(left?: Date | null, right?: Date | null, hours = 36) {
  if (!left || !right) return false;
  return Math.abs(left.getTime() - right.getTime()) <= hours * HOUR_MS;
}

function normalizedLocationPart(
  location: Record<string, unknown> | null | undefined,
  keys: string[],
) {
  if (!location) return "";
  for (const key of keys) {
    const value = location[key];
    if (typeof value === "string" && value.trim()) return normalizeCompact(value);
  }
  return "";
}

function locationsMatch(
  left?: Record<string, unknown> | null,
  right?: Record<string, unknown> | null,
) {
  const leftPostal = normalizedLocationPart(left, ["postalCode", "postal_code", "zip"]);
  const rightPostal = normalizedLocationPart(right, ["postalCode", "postal_code", "zip"]);
  const leftCountry = normalizedLocationPart(left, ["country", "countryCode", "country_code"]);
  const rightCountry = normalizedLocationPart(right, ["country", "countryCode", "country_code"]);

  if (
    leftPostal &&
    rightPostal &&
    leftPostal === rightPostal &&
    (!leftCountry || !rightCountry || leftCountry === rightCountry)
  ) {
    return true;
  }

  const leftLocality = normalizedLocationPart(left, ["locality", "city"]);
  const rightLocality = normalizedLocationPart(right, ["locality", "city"]);
  const leftRegion = normalizedLocationPart(left, ["region", "state", "stateCode", "state_code"]);
  const rightRegion = normalizedLocationPart(right, ["region", "state", "stateCode", "state_code"]);

  return Boolean(
    leftLocality &&
      rightLocality &&
      leftRegion &&
      rightRegion &&
      leftLocality === rightLocality &&
      leftRegion === rightRegion &&
      (!leftCountry || !rightCountry || leftCountry === rightCountry),
  );
}

function normalizeDocumentFingerprints(values?: readonly string[]) {
  return new Set(
    (values ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[a-f0-9]{64}$/.test(value)),
  );
}

function matchedDocumentFingerprints(
  incoming?: readonly string[],
  candidate?: readonly string[],
) {
  const incomingSet = normalizeDocumentFingerprints(incoming);
  const candidateSet = normalizeDocumentFingerprints(candidate);
  return [...incomingSet].filter((fingerprint) => candidateSet.has(fingerprint)).sort();
}

function exactSourceRecordMatch(
  incoming: OpportunityIdentityInput,
  candidate: OpportunityIdentityCandidate,
) {
  const source = normalizeSource(incoming.source);
  const sourceRecordId = normalizeRecordId(incoming.sourceRecordId);
  return candidate.sourceRecords.some(
    (record) =>
      normalizeSource(record.source) === source &&
      normalizeRecordId(record.sourceRecordId) === sourceRecordId,
  );
}

function exactAgencySolicitationMatch(
  incoming: OpportunityIdentityInput,
  candidate: OpportunityIdentityCandidate,
) {
  const incomingAgency = normalizeAgencyIdentity(incoming.agencyKey);
  const candidateAgency = normalizeAgencyIdentity(candidate.agencyKey);
  const incomingSolicitation = normalizeSolicitationIdentity(incoming.solicitationNumber);
  const candidateSolicitation = normalizeSolicitationIdentity(candidate.solicitationNumber);

  return Boolean(
    incomingAgency &&
      candidateAgency &&
      incomingSolicitation &&
      candidateSolicitation &&
      incomingAgency === candidateAgency &&
      incomingSolicitation === candidateSolicitation,
  );
}

function deterministicCandidate(
  candidate: OpportunityIdentityCandidate,
  method: "same_source_record" | "agency_solicitation",
): ScoredOpportunityIdentityCandidate {
  const sameSource = method === "same_source_record";
  return {
    opportunityId: candidate.opportunityId,
    method,
    confidence: sameSource ? 100 : 99,
    evidence: {
      score: sameSource ? 100 : 99,
      signals: sameSource
        ? ["same_source_record"]
        : ["agency", "solicitation_number"],
    },
  };
}

interface CompositeScore extends ScoredOpportunityIdentityCandidate {
  autoEligible: boolean;
  hardConflict: boolean;
}

function compositeScore(
  incoming: OpportunityIdentityInput,
  candidate: OpportunityIdentityCandidate,
): CompositeScore {
  const signals: OpportunityIdentitySignal[] = [];
  const conflicts: string[] = [];
  let score = 0;

  const incomingSolicitation = normalizeSolicitationIdentity(incoming.solicitationNumber);
  const candidateSolicitation = normalizeSolicitationIdentity(candidate.solicitationNumber);
  if (
    incomingSolicitation &&
    candidateSolicitation &&
    incomingSolicitation !== candidateSolicitation
  ) {
    conflicts.push("solicitation_number_conflict");
  }

  const incomingAgency = normalizeAgencyIdentity(incoming.agencyKey);
  const candidateAgency = normalizeAgencyIdentity(candidate.agencyKey);
  if (incomingAgency && candidateAgency && incomingAgency === candidateAgency) {
    score += 15;
    signals.push("agency");
  }

  const titleSimilarity = opportunityTitleSimilarity(incoming.title, candidate.title);
  if (titleSimilarity >= 0.9) {
    score += 35;
    signals.push("title");
  } else if (titleSimilarity >= 0.8) {
    score += 28;
    signals.push("title");
  } else if (titleSimilarity >= 0.7) {
    score += 20;
    signals.push("title");
  }

  if (datesNear(incoming.publishedAt, candidate.publishedAt)) {
    score += 8;
    signals.push("published_date");
  }
  if (datesNear(incoming.issueAt, candidate.issueAt)) {
    score += 10;
    signals.push("issue_date");
  }
  if (datesNear(incoming.dueAt, candidate.dueAt)) {
    score += 20;
    signals.push("due_date");
  }
  if (locationsMatch(incoming.location, candidate.location)) {
    score += 15;
    signals.push("location");
  }

  const matchedFingerprints = matchedDocumentFingerprints(
    incoming.documentFingerprints,
    candidate.documentFingerprints,
  );
  if (matchedFingerprints.length > 0) {
    score += 45;
    signals.push("document_fingerprint");
  }

  const hardConflict = conflicts.length > 0;
  const hasDocumentEvidence = signals.includes("document_fingerprint");
  const autoEligible =
    !hardConflict &&
    score >= 75 &&
    ((hasDocumentEvidence && signals.length >= 2) || signals.length >= 4);

  return {
    opportunityId: candidate.opportunityId,
    method: "strong_composite",
    confidence: Math.min(95, score),
    autoEligible,
    hardConflict,
    evidence: {
      score,
      signals,
      ...(signals.includes("title")
        ? { titleSimilarity: Number(titleSimilarity.toFixed(4)) }
        : {}),
      ...(matchedFingerprints.length > 0
        ? { matchedDocumentFingerprints: matchedFingerprints }
        : {}),
      ...(conflicts.length > 0 ? { conflicts } : {}),
    },
  };
}

function publicScore(score: CompositeScore): ScoredOpportunityIdentityCandidate {
  return {
    opportunityId: score.opportunityId,
    method: score.method,
    confidence: score.confidence,
    evidence: score.evidence,
  };
}

function ambiguous(
  candidates: ScoredOpportunityIdentityCandidate[],
): OpportunityIdentityDecision {
  return {
    kind: "ambiguous",
    candidates: candidates.slice(0, 5),
  };
}

export function resolveOpportunityIdentity(input: {
  incoming: OpportunityIdentityInput;
  candidates: readonly OpportunityIdentityCandidate[];
}): OpportunityIdentityDecision {
  const exactSourceMatches = input.candidates.filter((candidate) =>
    exactSourceRecordMatch(input.incoming, candidate),
  );
  if (exactSourceMatches.length === 1) {
    return {
      kind: "match",
      ...deterministicCandidate(exactSourceMatches[0], "same_source_record"),
    };
  }
  if (exactSourceMatches.length > 1) {
    return ambiguous(
      exactSourceMatches.map((candidate) =>
        deterministicCandidate(candidate, "same_source_record"),
      ),
    );
  }

  const exactSolicitationMatches = input.candidates.filter((candidate) =>
    exactAgencySolicitationMatch(input.incoming, candidate),
  );
  if (exactSolicitationMatches.length === 1) {
    return {
      kind: "match",
      ...deterministicCandidate(exactSolicitationMatches[0], "agency_solicitation"),
    };
  }
  if (exactSolicitationMatches.length > 1) {
    return ambiguous(
      exactSolicitationMatches.map((candidate) =>
        deterministicCandidate(candidate, "agency_solicitation"),
      ),
    );
  }

  const scored = input.candidates
    .map((candidate) => compositeScore(input.incoming, candidate))
    .sort(
      (left, right) =>
        right.evidence.score - left.evidence.score ||
        left.opportunityId.localeCompare(right.opportunityId),
    );
  const eligible = scored.filter((candidate) => candidate.autoEligible);

  if (eligible.length === 1) {
    const winner = eligible[0];
    const runnerUp = scored.find(
      (candidate) => candidate.opportunityId !== winner.opportunityId && !candidate.hardConflict,
    );
    if (
      runnerUp &&
      runnerUp.evidence.score >= 55 &&
      winner.evidence.score - runnerUp.evidence.score < 10
    ) {
      return ambiguous([publicScore(winner), publicScore(runnerUp)]);
    }

    return {
      kind: "match",
      ...publicScore(winner),
    };
  }

  if (eligible.length > 1) {
    return ambiguous(eligible.map(publicScore));
  }

  const plausible = scored.filter(
    (candidate) => !candidate.hardConflict && candidate.evidence.score >= 55,
  );
  if (plausible.length > 0) {
    return ambiguous(plausible.map(publicScore));
  }

  return {
    kind: "new",
    candidates: scored
      .filter((candidate) => candidate.evidence.score > 0)
      .slice(0, 5)
      .map(publicScore),
  };
}
