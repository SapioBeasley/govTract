import assert from "node:assert/strict";
import test from "node:test";

import { assessManualSnapshotRefresh } from "./manual-refresh";
import type { PursuitSnapshot } from "./snapshot";

const mb = 1024 * 1024;
function snapshot(status: string, documents: Array<{status:string;source?:string;id?:string;checksumSha256?:string|null;sourceBinaryArtifactId?:string|null}>): PursuitSnapshot {
  return {
    id:"snapshot-1",opportunityId:"opportunity-1",bidWorkspaceId:"workspace-1",savedOpportunityId:null,
    supersedesSnapshotId:null,documentSetFingerprint:"immutable-fingerprint-1",status,
    totalDocumentCount:documents.length,storedDocumentCount:documents.filter((d)=>d.status==="stored").length,
    blockedDocumentCount:documents.filter((d)=>d.status==="blocked").length,
    failedDocumentCount:documents.filter((d)=>d.status==="failed").length,completedAt:null,
    createdAt:new Date(),updatedAt:new Date(),
    documents:documents.map((d,i)=>({
      id:d.id??"document-"+i,opportunityDocumentId:"opportunity-document-"+i,
      opportunityDocumentVersionId:"version-"+i,sourceBinaryArtifactId:d.sourceBinaryArtifactId??null,
      source:d.source??"beacon",sourceOpportunityId:"source-1",sourceDocumentKey:"document-"+i,
      filename:"Document "+i+".pdf",mimeType:"application/pdf",checksumSha256:d.checksumSha256??"a".repeat(64),
      status:d.status,failureCode:null,retrievedAt:null,
    })),
  };
}

test("new bid workspaces can explicitly retrieve an incomplete immutable two-document package", () => {
  const result=assessManualSnapshotRefresh({
    snapshot:snapshot("incomplete",[{status:"pending"},{status:"pending"}]),
    expectedFileSizes:[100_000,200_000],
  });
  assert.deepEqual(result,{state:"ready",pendingDocuments:2});
});

test("repeating source refresh after all files are stored is a no-op; no duplicate source download", () => {
  const result=assessManualSnapshotRefresh({
    snapshot:snapshot("complete",[{status:"stored",sourceBinaryArtifactId:"artifact-1"}]),
    expectedFileSizes:[150_000],
  });
  assert.equal(result.state,"already_complete");
});

test("unsupported sources and oversized or absent authoritative packages are rejected before fetch", () => {
  const unsupported=assessManualSnapshotRefresh({
    snapshot:snapshot("incomplete",[{status:"pending",source:"sam.gov"}]),
    expectedFileSizes:[10_000],
  });
  assert.equal(unsupported.state,"blocked");
  assert.match(unsupported.reason??"",/source|unsupported/i);

  for (const sizes of [[21*mb],Array.from({length:6},()=>1)]) {
    const docs=snapshot("incomplete",sizes.map(()=>({status:"pending"})));
    const result=assessManualSnapshotRefresh({snapshot:docs,expectedFileSizes:sizes});
    assert.equal(result.state,"blocked");
  }
  assert.equal(assessManualSnapshotRefresh({
    snapshot:snapshot("incomplete",[]),expectedFileSizes:[],
  }).state,"blocked");
});

test("a terminally failed or blocked document is not silently treated as successfully retained", () => {
  const result=assessManualSnapshotRefresh({
    snapshot:snapshot("blocked",[{status:"blocked"},{status:"stored",sourceBinaryArtifactId:"artifact-1"}]),
    expectedFileSizes:[20_000,20_000],
  });
  assert.equal(result.state,"ready", "explicit source recovery can retry a previously failed retrieval");
  assert.equal(result.pendingDocuments,1);
  const corrupt=assessManualSnapshotRefresh({
    snapshot:snapshot("complete",[{status:"stored"}]),expectedFileSizes:[100],
  });
  assert.equal(corrupt.state,"ready","stored without an artifact cannot be treated as retained");
});
