import assert from "node:assert/strict";
import test from "node:test";

import { isBeaconPlanholderRegistrationResponse } from "./session-transport";

test("planholder permission responses trigger solicitation registration before auth failure", () => {
  assert.equal(
    isBeaconPlanholderRegistrationResponse(
      403,
      JSON.stringify({ message: "Planholder permission denied" }),
    ),
    true,
  );
  assert.equal(
    isBeaconPlanholderRegistrationResponse(
      400,
      JSON.stringify({ message: "Register before requesting these files" }),
    ),
    true,
  );
  assert.equal(
    isBeaconPlanholderRegistrationResponse(403, JSON.stringify({ message: "Unauthorized" })),
    false,
  );
});
