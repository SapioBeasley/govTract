/** Source-pinned typed basket specifications: never infer a load from a nearby unlabeled weight. */
export type ModelFact = {
  persons: 1 | 2; modelId: string | null; ratedLoadLb: number | null;
  testWeightLb: number | null; productWeightLb: number | null; quantity: number | null;
};
export type ModelFacts = { models: ModelFact[]; issues: string[] };
type Field = "ratedLoadLb" | "testWeightLb" | "productWeightLb" | "quantity";
type Person = 1 | 2;
const keys: Field[] = ["ratedLoadLb", "testWeightLb", "productWeightLb", "quantity"];
const labels: Record<Field, string> = {
  ratedLoadLb: "working load", testWeightLb: "test weight",
  productWeightLb: "product weight", quantity: "quantity",
};
const patterns: Record<Field, RegExp[]> = {
  ratedLoadLb: [
    /\b(?:working[\s-]+load(?:[\s-]+limit)?|rated(?:[\s-]+(?:working[\s-]+)?(?:load|capacity|for|at))?|capacity)\s*:?\s*(\d[\d,]*)\s*(?:lb|lbs|pounds)\b/gi,
    /\b(\d[\d,]*)\s*(?:lb|lbs|pounds)\s*(?:working[\s-]+load(?:[\s-]+limit)?|rated(?:[\s-]+(?:working[\s-]+)?(?:load|capacity))?|capacity)\b/gi,
  ],
  testWeightLb: [
    /\b(?:test(?:ing)?|proof)[\s-]+(?:weight|load)(?:[\s-]+weighing)?\s*:?\s*(\d[\d,]*)\s*(?:lb|lbs|pounds)\b/gi,
    /\b(\d[\d,]*)\s*(?:lb|lbs|pounds)\s*(?:test(?:ing)?|proof)[\s-]+(?:weight|load)\b/gi,
  ],
  productWeightLb: [
    /\b(?:product|basket|unit)[\s-]+weight\s*:?\s*(\d[\d,]*)\s*(?:lb|lbs|pounds)\b/gi,
    /\b(\d[\d,]*)\s*(?:lb|lbs|pounds)\s*(?:product|basket|unit)[\s-]+weight\b/gi,
  ],
  quantity: [/\b(?:quantity|qty)\s*[:#]?\s*(\d+)\b/gi],
};
const personPattern = /\b(?:1|one|single|2|two)[\s-]+(?:person|persons|people|man|basket)\b/gi;
const modelIdPattern = /\bmodel\s*#?\s*:?\s*([a-z][a-z0-9-]{3,})\b/gi;
const lbPattern = /\b\d[\d,]*\s*(?:lb|lbs|pounds)\b/gi;
function person(label: string): Person { return /^(?:1|one|single)\b/i.test(label) ? 1 : 2; }
function empty() { return Object.fromEntries(keys.map((k) => [k, new Set<number>()])) as Record<Field, Set<number>>; }
function readings(text: string) {
  const found = empty(), covered: Array<[number, number]> = [];
  for (const field of keys) for (const pattern of patterns[field]) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]!.replaceAll(",", ""));
      if (Number.isSafeInteger(value) && value > 0) found[field].add(value);
      covered.push([match.index!, match.index! + match[0].length]);
    }
  }
  const untyped: number[] = [];
  for (const match of text.matchAll(lbPattern)) {
    if (!covered.some(([a, b]) => match.index! >= a && match.index! < b)) {
      untyped.push(Number(match[0].match(/\d[\d,]*/)?.[0]?.replaceAll(",", "")));
    }
  }
  return { found, untyped };
}
function parse(sourceEvidence: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(sourceEvidence); } catch { return []; }
  if (!parsed || typeof parsed !== "object") return [];
  const data = parsed as { documents?: Array<{ versionId?: string; filename?: string }>;
    passages?: Array<{ excerpt?: string; documentVersionId?: string }> };
  const filenames = new Map((Array.isArray(data.documents) ? data.documents : [])
    .filter((d) => typeof d.versionId === "string" && typeof d.filename === "string")
    .map((d) => [d.versionId!, d.filename!] as const));
  return (Array.isArray(data.passages) ? data.passages : [])
    .filter((p) => typeof p.excerpt === "string" && Boolean(p.excerpt.trim()))
    .map((p) => ({ text: p.excerpt!, filename: filenames.get(p.documentVersionId ?? "") ?? null,
      version: p.documentVersionId ?? null }));
}
function anchors(text: string, alias: Map<string, Person>) {
  const all = [...text.matchAll(personPattern)].map((m) =>
    ({ model: person(m[0]), start: m.index! }));
  for (const [id, model] of alias) {
    // Source model IDs are restricted to letters, digits and dashes.
    const pattern = new RegExp("\\b" + id + "\\b", "gi");
    for (const match of text.matchAll(pattern)) all.push({ model, start: match.index! });
  }
  all.sort((a, b) => a.start - b.start);
  // Combine adjacent person and model-ID names for the same model.
  return all.filter((a, i) => i === 0 || a.model !== all[i - 1]!.model);
}
function scoped(text: string, fallback: Person | null, alias: Map<string, Person>) {
  const found = anchors(text, alias);
  if (!found.length) return fallback ? [{ model: fallback, text }] : [];
  return found.map((a, i) => ({ model: a.model,
    text: text.slice(i === 0 ? 0 : a.start, found[i + 1]?.start ?? text.length) }));
}
function filenameModel(filename: string | null): Person | null {
  if (!filename) return null;
  const ids = [...filename.matchAll(personPattern)].map((m) => person(m[0]));
  return new Set(ids).size === 1 ? ids[0]! : null;
}

/** A model fact is present only when its typed value is uniquely supported by pinned evidence. */
export function derivePinnedModelFacts(sourceEvidence: string): ModelFacts {
  const passages = parse(sourceEvidence), issues: string[] = [];
  const alias = new Map<string, Person>(), identities = new Map<Person, Set<string>>();
  const sourceValues = new Map<Person, Record<Field, Set<number>>>();
  for (const passage of passages) {
    const named = [...new Set([...passage.text.matchAll(personPattern)].map((m) => person(m[0])))];
    const model = named.length === 1 ? named[0]! : filenameModel(passage.filename);
    const ids = [...passage.text.matchAll(modelIdPattern)].map((m) => m[1]!.toUpperCase());
    if (model && new Set(ids).size === 1) {
      const id = ids[0]!;
      if (alias.has(id) && alias.get(id) !== model) {
        issues.push("Conflicting model identity " + id + "; clarify source model mapping.");
      }
      alias.set(id, model);
      if (!identities.has(model)) identities.set(model, new Set());
      identities.get(model)!.add(id);
    }
  }
  for (const passage of passages) {
    const explicit = [...passage.text.matchAll(personPattern)].map((m) => person(m[0]));
    const implicit = explicit.length ? null : filenameModel(passage.filename);
    const fragments = scoped(passage.text, implicit, alias);
    if (!fragments.length) {
      if (readings(passage.text).untyped.length || keys.some((k) => readings(passage.text).found[k].size)) {
        issues.push("Unassigned pinned model weight in " + (passage.filename ?? passage.version ?? "source excerpt") +
          "; clarify model and weight type before drafting.");
      }
      continue;
    }
    for (const fragment of fragments) {
      if (!sourceValues.has(fragment.model)) sourceValues.set(fragment.model, empty());
      const read = readings(fragment.text);
      for (const key of keys) for (const value of read.found[key]) sourceValues.get(fragment.model)![key].add(value);
      if (read.untyped.length) issues.push("Ambiguous untyped " + read.untyped.join(" / ") +
        " lb value in " + fragment.model + "-person pinned source; clarify the weight type.");
    }
  }
  const models: ModelFact[] = [...sourceValues].sort(([a], [b]) => a - b).map(([persons, values]) => {
    for (const field of keys) if (values[field].size > 1) {
      issues.push("Conflicting pinned " + labels[field] + " for " + persons +
        "-person model; clarify source variants before drafting.");
    }
    const ids = identities.get(persons);
    if (ids && ids.size > 1) issues.push("Conflicting pinned model IDs for " + persons + "-person basket.");
    const value = (field: Field) => values[field].size === 1 ? [...values[field]][0]! : null;
    return { persons, modelId: ids?.size === 1 ? [...ids][0]! : null,
      ratedLoadLb: value("ratedLoadLb"), testWeightLb: value("testWeightLb"),
      productWeightLb: value("productWeightLb"), quantity: value("quantity") };
  });
  return { models, issues: [...new Set(issues)] };
}

/** Recheck each typed offered/buyer statement against its own model; omit no supported field. */
export function inspectModelContent(content: string, sourceEvidence: string): string[] {
  const facts = derivePinnedModelFacts(sourceEvidence);
  const issues = [...facts.issues];
  if (!facts.models.length) return issues;
  const alias = new Map(facts.models.flatMap((m) => m.modelId ? [[m.modelId, m.persons] as const] : []));
  const fragments = scoped(content, null, alias);
  for (const expected of facts.models) {
    const matches = fragments.filter((f) => f.model === expected.persons);
    for (const field of keys) {
      const expectedValue = expected[field];
      if (expectedValue === null) continue;
      const found = new Set(matches.flatMap((m) => [...readings(m.text).found[field]]));
      const suffix = field === "quantity" ? "" : " lb";
      if (!found.size) {
        issues.push("State separate " + expected.persons + "-person " + labels[field] + " (" + expectedValue +
          suffix + ") from pinned evidence; do not borrow another model's value.");
      } else if ([...found].some((v) => v !== expectedValue)) {
        issues.push("Incorrect " + expected.persons + "-person " + labels[field] + ": stated " +
          [...found].join(" / ") + suffix + "; pinned source specifies " + expectedValue + suffix + ".");
      }
    }
    for (const match of matches) {
      const untyped = readings(match.text).untyped;
      if (untyped.length) issues.push("Ambiguous " + expected.persons + "-person drafted " +
        untyped.join(" / ") + " lb value; identify working load versus test or product weight.");
    }
  }
  if (/\band\/or\b/i.test(content) && /\b(?:lb|lbs|pounds|model|basket)\b/i.test(content)) {
    issues.push("Ambiguous and/or model or weight option; separate each model's working load and test weight.");
  }
  return [...new Set(issues)];
}

/** A single sentence with a contradictory typed value must be redacted, not merely warned about later. */
export function hasUnsafeModelAssertion(sentence: string, sourceEvidence: string) {
  const facts = derivePinnedModelFacts(sourceEvidence);
  const errors = inspectModelContent(sentence, sourceEvidence);
  return errors.some((issue) => /^(?:Incorrect|Ambiguous \d-person drafted|Ambiguous and\/or)/i.test(issue)) ||
    facts.issues.length > 0 && /\b(?:\d[\d,]*\s*(?:lb|lbs|pounds)|working load|test weight)\b/i.test(sentence);
}
