import assert from "node:assert/strict";
import test from "node:test";
import {
  beaconOpportunityAdapter,
  normalizeBeaconSolicitation,
  toBeaconSourceRecord,
} from "./normalize";

test("normalizes live Beacon rich fields without losing source semantics", () => {
  const normalized = normalizeBeaconSolicitation({
    agencySlug: "city-of-houston",
    canonicalStatus: "open",
    canonicalUrl:
      "https://www.beaconbid.com/solicitations/city-of-houston/b28b6380-37b4-4c13-9dd8-54ec71013c91/traffic-signal",
    row: {
      id: "B28B6380-37B4-4C13-9DD8-54EC71013C91",
      revisionId: "5bb686ad-bc53-49e7-a067-06cb256742fb",
      refnum: "INF-2026-0367",
      title: '12" Traffic Signal',
      status: "approved",
      type: "informal",
      modifiedAt: "2026-09-08T01:02:03.000Z",
      description: { html: "<p>The City of Houston is seeking traffic signals.</p>" },
      categories: [
        {
          code: "55088",
          name: "Traffic Signals and Equipment, Electric Systems",
          type: "nigp",
        },
      ],
      documents: [
        {
          key: "agency/example/InformalGeneralTerms.docx",
          name: "Informal General Terms.docx",
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes: 106520,
          bucket: "documents.beaconbid.com",
          detail: "Documentation",
        },
      ],
      departments: [{ name: "Houston Public Works" }],
      agency: { name: "City of Houston" },
    },
  });

  assert.equal(normalized.sourceRecordId, "b28b6380-37b4-4c13-9dd8-54ec71013c91");
  assert.equal(normalized.description, "<p>The City of Houston is seeking traffic signals.</p>");
  assert.equal(normalized.status, "open");
  assert.equal(normalized.sourceStatus, "approved");
  assert.deepEqual(normalized.departments, ["Houston Public Works"]);
  assert.deepEqual(normalized.categories, [
    "Traffic Signals and Equipment, Electric Systems",
  ]);

  assert.equal(normalized.documents?.[0]?.sourceDocumentKey, "agency/example/InformalGeneralTerms.docx");
  assert.equal(normalized.documents?.[0]?.fileSizeBytes, 106520);
  assert.equal(
    normalized.documents?.[0]?.mimeType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(normalized.documents?.[0]?.url, null);
  assert.equal(normalized.documents?.[0]?.isAmendment, false);
  assert.equal(
    normalized.documents?.[0]?.sourceMetadata.bucket,
    "documents.beaconbid.com",
  );

  assert.equal(normalized.classifications?.[0]?.sourceClassificationKey, "nigp:55088");
  assert.equal(normalized.classifications?.[0]?.scheme, "nigp");
  assert.equal(normalized.classifications?.[0]?.code, "55088");
});

test("still accepts plain string descriptions and numeric-string byte counts", () => {
  const normalized = normalizeBeaconSolicitation({
    agencySlug: "example-agency",
    canonicalStatus: "open",
    canonicalUrl: "https://example.invalid/opportunity/1",
    row: {
      id: "source-1",
      title: "Example",
      description: "Plain description",
      documents: [
        {
          key: "document-key",
          name: "file.pdf",
          type: "application/pdf",
          bytes: "42",
        },
      ],
    },
  });

  assert.equal(normalized.description, "Plain description");
  assert.equal(normalized.documents?.[0]?.fileSizeBytes, 42);
});

test("Beacon exposes the shared source-adapter identity, authority, and normalization contract", () => {
  const row = {
    id: "SOURCE-ABC",
    revisionId: "revision-7",
    title: "Adapter fixture",
    status: "approved",
    agency: { name: "City of Houston" },
  };
  const canonicalUrl = "https://www.beaconbid.com/solicitations/city-of-houston/source-abc/adapter-fixture";

  assert.equal(beaconOpportunityAdapter.source, "beacon");
  assert.equal(beaconOpportunityAdapter.authority, "authoritative");
  assert.deepEqual(beaconOpportunityAdapter.identify(row), {
    sourceRecordId: "source-abc",
    sourceRevisionId: "revision-7",
  });

  const throughAdapterSource = beaconOpportunityAdapter.toSourceRecord(row, {
    canonicalUrl,
  });
  assert.deepEqual(
    throughAdapterSource,
    toBeaconSourceRecord({ row, canonicalUrl }),
  );

  const throughAdapterOpportunity = beaconOpportunityAdapter.normalizeOpportunity(row, {
    canonicalUrl,
    agency: "city-of-houston",
    canonicalStatus: "open",
  });
  assert.deepEqual(
    throughAdapterOpportunity,
    normalizeBeaconSolicitation({
      row,
      canonicalUrl,
      agencySlug: "city-of-houston",
      canonicalStatus: "open",
    }),
  );
});


test("Beacon original form attachments in eBid questions join the source package with stable keys, not just top-level documents", () => {
  const fixture = {
    id:"beacon-ebid-fixture",title:"Source listing with mandatory original form",
    documents:[{key:"agency/solicitation/terms.docx",name:"Terms.docx",bytes:1024}],
    ebid:{eforms:[{
      name:"Submission Requirements",type:"questionnaire_form",
      questions:[{required:true,type:"document-upload",prompt:"Upload completed Signature Page",
        attachments:[{key:"agency/form-attachment/signature.docx",
          name:"Informal Signature Page.docx",type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes:18000,bucket:"documents.beaconbid.com"}]}],
    }]},
  };
  const input={row:fixture,agencySlug:"city-of-houston",canonicalStatus:"open",
    canonicalUrl:"https://www.beaconbid.com/solicitations/city-of-houston/beacon-ebid-fixture/source"};
  const normalized=normalizeBeaconSolicitation(input);
  assert.deepEqual(normalized.documents?.map((document)=>document.sourceDocumentKey),
    ["agency/solicitation/terms.docx","agency/form-attachment/signature.docx"]);
  const form=normalized.documents?.[1];
  assert.equal(form?.name,"Informal Signature Page.docx");
  assert.equal(form?.url,null);
  assert.equal(form?.sourceMetadata.requiredOriginalForm,true);
  assert.equal(form?.sourceMetadata.formName,"Submission Requirements");
  assert.deepEqual(normalizeBeaconSolicitation(input).documents,normalized.documents);
});
