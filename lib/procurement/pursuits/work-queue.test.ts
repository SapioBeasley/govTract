import assert from "node:assert/strict";
import test from "node:test";

import { prioritizePursuitSnapshotWork } from "./work-queue";

test("pending workspace snapshots outrank already-complete pursuits and auth-blocked retries", () => {
  const selected=prioritizePursuitSnapshotWork([
    {snapshotId:"saved-complete",bidWorkspaceId:null,status:"complete",updatedAt:1},
    {snapshotId:"workspace-pending",bidWorkspaceId:"workspace-1",status:"incomplete",updatedAt:3},
    {snapshotId:"workspace-blocked",bidWorkspaceId:"workspace-2",status:"blocked",updatedAt:2},
    {snapshotId:"saved-pending",bidWorkspaceId:null,status:"incomplete",updatedAt:1},
  ],3);
  assert.deepEqual(selected.map((item)=>item.snapshotId),
    ["workspace-pending","saved-pending","workspace-blocked"]);
  assert.equal(selected[0]?.bidWorkspaceId,"workspace-1");
  assert.deepEqual(prioritizePursuitSnapshotWork(selected,3),selected,"checkpoint rerun is deterministic");
  assert.deepEqual(prioritizePursuitSnapshotWork(selected,1).map((item)=>item.snapshotId),["workspace-pending"]);
});
