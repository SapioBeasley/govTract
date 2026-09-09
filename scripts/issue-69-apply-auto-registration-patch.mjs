import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/beacon-documents.ts";
let source = await readFile(path, "utf8");

function replaceOnce(label, before, after) {
  if (!source.includes(before)) {
    throw new Error(`Patch anchor not found: ${label}`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  "registration imports",
  `import {
  buildBeaconCookieHeader,
  getBeaconSessionCookies,
  isBeaconPermissionResponse,
  isBeaconRegistrationRequiredResponse,
  parseBeaconSessionProbe,
} from "../lib/procurement/sources/beacon/session-transport";`,
  `import {
  buildBeaconPlanholderRegistrationRequest,
  parseBeaconPlanholderRegistrationResponse,
} from "../lib/procurement/sources/beacon/registration";
import {
  buildBeaconCookieHeader,
  getBeaconSessionCookies,
  isBeaconPermissionResponse,
  isBeaconRegistrationRequiredResponse,
  parseBeaconRegistrationProfile,
  parseBeaconSessionProbe,
  type BeaconRegistrationProfile,
} from "../lib/procurement/sources/beacon/session-transport";`,
);

replaceOnce(
  "auto register constant",
  `const MAX_ERROR_RATE = Number(process.env.BEACON_DOCUMENT_MAX_ERROR_RATE ?? "0.25");`,
  `const MAX_ERROR_RATE = Number(process.env.BEACON_DOCUMENT_MAX_ERROR_RATE ?? "0.25");
const AUTO_REGISTER = process.env.BEACON_AUTO_REGISTER !== "false";`,
);

replaceOnce(
  "registration failed error kind",
  `  | "registration_required"
  | "network"`,
  `  | "registration_required"
  | "registration_failed"
  | "network"`,
);

replaceOnce(
  "connection interface",
  `interface ReprocessSignal {
  opportunityId: string;
  sourceOpportunityId: string;
  documentId: string;
  sourceDocumentKey: string;
  versionNumber: number;
  change: string;
  isAmendment: boolean;
  amendmentLabel: string | null;
}
`,
  `interface ReprocessSignal {
  opportunityId: string;
  sourceOpportunityId: string;
  documentId: string;
  sourceDocumentKey: string;
  versionNumber: number;
  change: string;
  isAmendment: boolean;
  amendmentLabel: string | null;
}

interface BeaconConnection {
  cookieHeader: string;
  registrationProfile: BeaconRegistrationProfile | null;
}
`,
);

replaceOnce(
  "session profile return",
  `    if (!parsed.authenticatedSupplier) {
      await markNeedsReauth("authentication_failed");
      throw new DocumentRetrievalError(
        "Beacon source connection no longer has supplier access; reconnect Beacon in govTract.",
        "auth_required",
      );
    }
  } catch (error) {`,
  `    if (!parsed.authenticatedSupplier) {
      await markNeedsReauth("authentication_failed");
      throw new DocumentRetrievalError(
        "Beacon source connection no longer has supplier access; reconnect Beacon in govTract.",
        "auth_required",
      );
    }

    return parseBeaconRegistrationProfile(probe.body);
  } catch (error) {`,
);

replaceOnce(
  "connection loader name",
  `async function loadValidatedBeaconCookieHeader() {`,
  `async function loadValidatedBeaconConnection(): Promise<BeaconConnection> {`,
);

replaceOnce(
  "connection loader return",
  `  await validateBeaconSessionInBrowser(session);
  await markSourceConnectionValidated(PROVIDER);
  return cookieHeader;
}

async function fetchWithTimeout(`,
  `  const registrationProfile = await validateBeaconSessionInBrowser(session);
  await markSourceConnectionValidated(PROVIDER);
  return { cookieHeader, registrationProfile };
}

async function registerBeaconSolicitation(input: {
  sourceOpportunityId: string;
  connection: BeaconConnection;
}) {
  if (!AUTO_REGISTER) {
    throw new DocumentRetrievalError(
      "Beacon requires solicitation registration before document retrieval.",
      "registration_required",
    );
  }

  if (!input.connection.registrationProfile) {
    throw new DocumentRetrievalError(
      "Beacon supplier profile is incomplete for automatic solicitation registration.",
      "registration_failed",
    );
  }

  const request = buildBeaconPlanholderRegistrationRequest({
    solicitationId: input.sourceOpportunityId,
    profile: input.connection.registrationProfile,
    interest: "Bidder",
  });
  const response = await fetchWithTimeout(
    \`${BEACON_ORIGIN}/api/gql?operation=createPlanholder\`,
    {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
    { beaconCookieHeader: input.connection.cookieHeader },
  );
  const body = (await response.text()).slice(0, 5000);
  const result = parseBeaconPlanholderRegistrationResponse(response.status, body);

  if (!result.ok) {
    throw new DocumentRetrievalError(
      \`Beacon automatic solicitation registration failed (HTTP ${response.status}).\`,
      "registration_failed",
    );
  }
}

async function fetchWithTimeout(`,
);

replaceOnce(
  "retrieve signature",
  `async function retrieveDocument(
  row: DocumentRow,
  getBeaconCookieHeader: () => Promise<string>,
): Promise<RetrievedDocument> {`,
  `async function retrieveDocument(
  row: DocumentRow,
  getBeaconConnection: () => Promise<BeaconConnection>,
  ensureRegistration: (sourceOpportunityId: string) => Promise<void>,
): Promise<RetrievedDocument> {`,
);

replaceOnce(
  "document request and registration retry",
  `  const beaconCookieHeader = await getBeaconCookieHeader();
  let response: Response;
  let usedPresignedRedirect = false;

  try {
    const resolved = await resolveBeaconDownloadResponse({
      downloadUrl,
      sourceDocumentKey: row.sourceDocumentKey,
      beaconCookieHeader,
    });
    response = resolved.response;
    usedPresignedRedirect = resolved.usedPresignedRedirect;
  } catch (error) {
    if (error instanceof DocumentRetrievalError) throw error;
    throw new DocumentRetrievalError("Beacon document request failed", "network");
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    if (isBeaconRegistrationRequiredResponse(response.status, body)) {
      throw new DocumentRetrievalError(
        "Beacon requires solicitation registration before document retrieval.",
        "registration_required",
      );
    }
    if (isBeaconPermissionResponse(response.status, body)) {
      throw new DocumentRetrievalError(
        \`Beacon denied supplier document access (HTTP ${response.status}); reconnect Beacon in govTract.\`,
        "auth_required",
      );
    }
    throw new DocumentRetrievalError(
      \`Beacon document returned HTTP ${response.status}\`,
      "http",
    );
  }
`,
  `  const connection = await getBeaconConnection();
  let response: Response;
  let usedPresignedRedirect = false;
  let registrationRetried = false;

  while (true) {
    try {
      const resolved = await resolveBeaconDownloadResponse({
        downloadUrl,
        sourceDocumentKey: row.sourceDocumentKey,
        beaconCookieHeader: connection.cookieHeader,
      });
      response = resolved.response;
      usedPresignedRedirect = usedPresignedRedirect || resolved.usedPresignedRedirect;
    } catch (error) {
      if (error instanceof DocumentRetrievalError) throw error;
      throw new DocumentRetrievalError("Beacon document request failed", "network");
    }

    if (response.ok) break;

    const body = (await response.text()).slice(0, 1000);
    if (isBeaconRegistrationRequiredResponse(response.status, body)) {
      if (!AUTO_REGISTER) {
        throw new DocumentRetrievalError(
          "Beacon requires solicitation registration before document retrieval.",
          "registration_required",
        );
      }
      if (registrationRetried) {
        throw new DocumentRetrievalError(
          "Beacon still requires registration after automatic solicitation registration.",
          "registration_failed",
        );
      }
      await ensureRegistration(row.sourceOpportunityId);
      registrationRetried = true;
      continue;
    }
    if (isBeaconPermissionResponse(response.status, body)) {
      throw new DocumentRetrievalError(
        \`Beacon denied supplier document access (HTTP ${response.status}); reconnect Beacon in govTract.\`,
        "auth_required",
      );
    }
    throw new DocumentRetrievalError(
      \`Beacon document returned HTTP ${response.status}\`,
      "http",
    );
  }
`,
);

replaceOnce(
  "connection and registration locks",
  `  let beaconCookieHeaderPromise: Promise<string> | null = null;
  let sourceConnectionValidationAttempted = false;
  const getBeaconCookieHeader = () => {
    sourceConnectionValidationAttempted = true;
    beaconCookieHeaderPromise ??= loadValidatedBeaconCookieHeader();
    return beaconCookieHeaderPromise;
  };
`,
  `  let beaconConnectionPromise: Promise<BeaconConnection> | null = null;
  let sourceConnectionValidationAttempted = false;
  const getBeaconConnection = () => {
    sourceConnectionValidationAttempted = true;
    beaconConnectionPromise ??= loadValidatedBeaconConnection();
    return beaconConnectionPromise;
  };
  const registrationPromises = new Map<string, Promise<void>>();
  const autoRegisteredSourceOpportunities = new Set<string>();
  const ensureRegistration = (sourceOpportunityId: string) => {
    const existing = registrationPromises.get(sourceOpportunityId);
    if (existing) return existing;

    const promise = (async () => {
      const connection = await getBeaconConnection();
      await registerBeaconSolicitation({ sourceOpportunityId, connection });
      autoRegisteredSourceOpportunities.add(sourceOpportunityId);
      console.log(
        \`BEACON_PLANHOLDER_REGISTERED sourceOpportunity=${sourceOpportunityId} interest=Bidder emailDocument=false\`,
      );
    })();
    registrationPromises.set(sourceOpportunityId, promise);
    return promise;
  };
`,
);

replaceOnce(
  "retrieve call",
  `        return await retrieveDocument(row, getBeaconCookieHeader);`,
  `        return await retrieveDocument(row, getBeaconConnection, ensureRegistration);`,
);

replaceOnce(
  "summary auto registration",
  `    partialDocumentAccess: registrationRequiredOpportunities.size > 0,
    retrievalErrorCount,`,
  `    partialDocumentAccess: registrationRequiredOpportunities.size > 0,
    autoRegister: AUTO_REGISTER,
    autoRegisteredOpportunityCount: autoRegisteredSourceOpportunities.size,
    retrievalErrorCount,`,
);

await writeFile(path, source, "utf8");
console.log("Applied Beacon automatic registration patch");
