import assert from "node:assert/strict";
import test from "node:test";

import { BeaconAuthError, parseBeaconMagicLink } from "./auth";

const valid =
  "https://www.beaconbid.com/login#token=identity-login.v2.example-token&eid=94a5bcc6-3042-4417-862c-3ee49004afcd";

test("accepts the expected Beacon v2 magic-link shape", () => {
  const url = parseBeaconMagicLink(valid);
  assert.equal(url.hostname, "www.beaconbid.com");
  assert.equal(url.pathname, "/login");
});

test("accepts the apex Beacon host", () => {
  const url = parseBeaconMagicLink(
    valid.replace("www.beaconbid.com", "beaconbid.com"),
  );
  assert.equal(url.hostname, "beaconbid.com");
});

for (const [label, value] of [
  ["http", valid.replace("https://", "http://")],
  ["foreign host", valid.replace("www.beaconbid.com", "example.com")],
  ["credentials in authority", valid.replace("https://", "https://user:pass@")],
  ["wrong path", valid.replace("/login", "/other")],
  ["query string", valid.replace("/login#", "/login?next=/admin#")],
  ["old token version", valid.replace("identity-login.v2.", "identity-login.v1.")],
  ["missing eid", valid.replace(/&eid=.*/, "")],
  ["extra fragment field", `${valid}&next=other`],
] as const) {
  test(`rejects ${label}`, () => {
    assert.throws(
      () => parseBeaconMagicLink(value),
      (error: unknown) =>
        error instanceof BeaconAuthError && error.code === "invalid_magic_link",
    );
  });
}
