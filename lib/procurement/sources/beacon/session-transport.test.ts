import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserSessionEnvelope } from "@/lib/source-connections/session";
import {
  buildBeaconCookieHeader,
  getBeaconSessionCookies,
  isBeaconPermissionResponse,
  isBeaconRegistrationRequiredResponse,
  parseBeaconRegistrationProfile,
  parseBeaconSessionProbe,
} from "./session-transport";

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

function session(cookies: BrowserSessionEnvelope["cookies"]): BrowserSessionEnvelope {
  return { version: 1, cookies };
}

test("builds a Beacon Cookie header only from current Beacon-domain cookies", () => {
  const value = session([
    {
      name: "_bs",
      value: "secret-session-value",
      domain: ".www.beaconbid.com",
      path: "/",
      expires: future,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "beacon_pref",
      value: "abc",
      domain: "beaconbid.com",
      path: "/",
      expires: future,
    },
    {
      name: "expired",
      value: "old",
      domain: "www.beaconbid.com",
      path: "/",
      expires: past,
    },
    {
      name: "unrelated",
      value: "nope",
      domain: "example.com",
      path: "/",
      expires: future,
    },
  ]);

  assert.equal(
    buildBeaconCookieHeader(value),
    "_bs=secret-session-value; beacon_pref=abc",
  );
  assert.equal(getBeaconSessionCookies(value).length, 2);
});

test("requires the reusable Beacon authentication cookie", () => {
  assert.throws(
    () =>
      buildBeaconCookieHeader(
        session([
          {
            name: "other",
            value: "abc",
            domain: "www.beaconbid.com",
            path: "/",
            expires: future,
          },
        ]),
      ),
    /reusable authentication cookie/,
  );
});

test("rejects unsafe cookie header values", () => {
  assert.throws(
    () =>
      buildBeaconCookieHeader(
        session([
          {
            name: "_bs",
            value: "good\r\nInjected: yes",
            domain: "www.beaconbid.com",
            path: "/",
            expires: future,
          },
        ]),
      ),
    /invalid cookie/,
  );
});

test("recognizes solicitation document registration requirements separately from auth", () => {
  const body = JSON.stringify({
    statusCode: 400,
    error: "Bad Request",
    message: "Register before requesting these files",
  });
  assert.equal(isBeaconRegistrationRequiredResponse(400, body), true);
  assert.equal(isBeaconRegistrationRequiredResponse(401, body), false);
  assert.equal(isBeaconPermissionResponse(400, body), false);
});

test("recognizes Beacon code 103 and permission responses", () => {
  assert.equal(isBeaconPermissionResponse(400, JSON.stringify({ code: 103 })), true);
  assert.equal(isBeaconPermissionResponse(400, JSON.stringify({ code: "103" })), true);
  assert.equal(
    isBeaconPermissionResponse(403, JSON.stringify({ message: "Planholder permission denied" })),
    true,
  );
  assert.equal(isBeaconPermissionResponse(500, JSON.stringify({ code: 103 })), false);
});

test("parses the connected supplier profile needed for automatic planholder registration", () => {
  const body = JSON.stringify({
    role: "supplier",
    contact: {
      name: "Test Person",
      email: "test@example.com",
      phone: "5551112222",
      position: "Estimator",
      location: { regionId: "ustx" },
    },
    company: {
      name: "Example Contractor",
      specialDesignations: ["example-designation", 42],
      location: { regionId: "ustx" },
    },
  });

  assert.deepEqual(parseBeaconRegistrationProfile(body), {
    name: "Test Person",
    email: "test@example.com",
    phone: "5551112222",
    position: "Estimator",
    regionId: "ustx",
    companyName: "Example Contractor",
    companyRegionId: "ustx",
    specialDesignations: ["example-designation"],
  });
});

test("does not fabricate an incomplete registration profile", () => {
  assert.equal(
    parseBeaconRegistrationProfile(
      JSON.stringify({
        role: "supplier",
        contact: { name: "Test Person", email: "test@example.com" },
        company: { name: "Example Contractor" },
      }),
    ),
    null,
  );
});

test("requires an exact supplier session", () => {
  assert.deepEqual(parseBeaconSessionProbe(200, JSON.stringify({ role: "supplier" })), {
    status: 200,
    role: "supplier",
    authenticatedSupplier: true,
  });
  assert.equal(
    parseBeaconSessionProbe(200, JSON.stringify({ role: "guest" })).authenticatedSupplier,
    false,
  );
  assert.equal(parseBeaconSessionProbe(401, "not json").authenticatedSupplier, false);
});
