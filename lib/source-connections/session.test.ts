import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserSessionEnvelope,
  decryptBrowserSession,
  encryptBrowserSession,
  getBrowserSessionExpiry,
} from "./session";

const key = Buffer.alloc(32, 7).toString("base64");
const otherKey = Buffer.alloc(32, 9).toString("base64");

function beaconSession() {
  return createBrowserSessionEnvelope([
    {
      name: "_bs",
      value: "secret-cookie-value",
      domain: ".www.beaconbid.com",
      path: "/",
      expires: 1_820_540_269,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

test("browser session round-trips through authenticated encryption", () => {
  const session = beaconSession();
  const encrypted = encryptBrowserSession(session, key);

  assert.notEqual(encrypted.includes("secret-cookie-value"), true);
  assert.deepEqual(decryptBrowserSession(encrypted, key), session);
});

test("encrypting the same session twice produces different ciphertext", () => {
  const session = beaconSession();

  assert.notEqual(
    encryptBrowserSession(session, key),
    encryptBrowserSession(session, key),
  );
});

test("wrong encryption key cannot decrypt a stored session", () => {
  const encrypted = encryptBrowserSession(beaconSession(), key);

  assert.throws(() => decryptBrowserSession(encrypted, otherKey));
});

test("tampered encrypted session fails authentication", () => {
  const encrypted = JSON.parse(
    encryptBrowserSession(beaconSession(), key),
  ) as Record<string, string | number>;
  const ciphertext = String(encrypted.ciphertext);
  encrypted.ciphertext = `${ciphertext.slice(0, -2)}AA`;

  assert.throws(() => decryptBrowserSession(JSON.stringify(encrypted), key));
});

test("session expiry uses the earliest persistent cookie expiry", () => {
  const session = createBrowserSessionEnvelope([
    {
      name: "first",
      value: "a",
      domain: ".example.test",
      path: "/",
      expires: 2_000_000_000,
    },
    {
      name: "second",
      value: "b",
      domain: ".example.test",
      path: "/",
      expires: 1_900_000_000,
    },
  ]);

  assert.equal(
    getBrowserSessionExpiry(session)?.toISOString(),
    new Date(1_900_000_000 * 1000).toISOString(),
  );
});

test("session cookies without expiry return null expiry", () => {
  const session = createBrowserSessionEnvelope([
    {
      name: "session",
      value: "value",
      domain: ".example.test",
      path: "/",
    },
  ]);

  assert.equal(getBrowserSessionExpiry(session), null);
});

test("encryption key must decode to exactly 32 bytes", () => {
  assert.throws(
    () => encryptBrowserSession(beaconSession(), Buffer.alloc(16).toString("base64")),
    /exactly 32 bytes/,
  );
});
