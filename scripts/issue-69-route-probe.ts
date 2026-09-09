import { closeDb } from "../lib/db/client";
import { resolveBeaconDocumentDownloadUrl } from "../lib/procurement/sources/beacon/documents";
import { buildBeaconCookieHeader } from "../lib/procurement/sources/beacon/session-transport";
import { loadSourceConnectionSession } from "../lib/source-connections/repository";

const sourceOpportunityId = "4bc0ff91-dee7-4859-823e-345b29dde1e5";
const sourceDocumentKey =
  "agency/281287c2-49c0-439e-81d7-315d13b0b4fb/solicitation/1788896991406_1d5d7e67-a41b-4643-9d52-4f98d97115e7/PR10359426DiaphramPumps.pdf";
const userAgent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 govTract/0.1 beacon-documents";

async function main() {
  const session = await loadSourceConnectionSession("beacon");
  const cookie = buildBeaconCookieHeader(session);
  const url = resolveBeaconDocumentDownloadUrl({ sourceOpportunityId, sourceDocumentKey });
  if (!url) throw new Error("Could not build Beacon document route");

  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      accept: "*/*",
      cookie,
      "user-agent": userAgent,
    },
  });

  let code: string | number | null = null;
  let responseKeys: string[] = [];
  if (!(response.status >= 300 && response.status < 400)) {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const rawCode = parsed.code;
      if (typeof rawCode === "string" || typeof rawCode === "number") code = rawCode;
      responseKeys = Object.keys(parsed).filter((key) => !/token|cookie|url|location|signature/i.test(key));
    } catch {
      // Never print the response body.
    }
  } else {
    await response.body?.cancel();
  }

  console.log(
    "BEACON_ROUTE_CODE_PROBE",
    JSON.stringify({ status: response.status, code, responseKeys }),
  );
}

main()
  .catch(() => {
    console.error("Beacon route code probe failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
