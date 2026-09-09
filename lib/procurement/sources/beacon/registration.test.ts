import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBeaconPlanholderRegistrationRequest,
  parseBeaconPlanholderRegistrationResponse,
} from "./registration";

test("builds automatic registration from the connected Beacon supplier profile", () => {
  const request = buildBeaconPlanholderRegistrationRequest({
    solicitationId: "11111111-1111-4111-8111-111111111111",
    profile: {
      name: "Test Person",
      email: "test@example.com",
      phone: "5551112222",
      position: "Estimator",
      regionId: "ustx",
      companyName: "Example Contractor",
      companyRegionId: "ustx",
      specialDesignations: ["example-designation"],
    },
  });

  assert.equal(request.operationName, "createPlanholder");
  assert.equal(request.variables.planholder.solicitationId, "11111111-1111-4111-8111-111111111111");
  assert.equal(request.variables.planholder.options.emailDocument, false);
  assert.equal(request.variables.planholder.contact.interest, "Bidder");
  assert.equal(request.variables.planholder.contact.company.name, "Example Contractor");
  assert.deepEqual(request.variables.planholder.contact.company.specialDesignations, [
    "example-designation",
  ]);
});

test("accepts only a successful createPlanholder response with a supplier", () => {
  assert.deepEqual(
    parseBeaconPlanholderRegistrationResponse(
      200,
      JSON.stringify({ data: { createPlanholder: { supplier: { id: "supplier-id" } } } }),
    ),
    { status: 200, ok: true, graphqlErrorCount: 0, supplierPresent: true },
  );

  assert.equal(
    parseBeaconPlanholderRegistrationResponse(
      200,
      JSON.stringify({ errors: [{ message: "registration failed" }], data: null }),
    ).ok,
    false,
  );
  assert.equal(parseBeaconPlanholderRegistrationResponse(500, "not json").ok, false);
});
