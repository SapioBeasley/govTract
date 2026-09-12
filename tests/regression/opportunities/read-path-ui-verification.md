# Opportunity read-path UI verification

Issue #91 primarily adds deterministic data-layer and route regression coverage. The current repository does not include a component/browser test harness for the opportunity pages, so this deterministic manual check covers graceful partial-data rendering until that harness exists.

## Preconditions

1. Use a local development database with migrations applied.
2. Seed or retain at least one opportunity that has classifications and documents.
3. Ensure one visible opportunity has no AI solicitation-understanding output and no derived intelligence records.
4. Ensure its document set includes representative `pending`, `extracted`, `failed`, `unsupported`, and `stale` extraction states where practical.

## Verification

1. Start the application locally and open `/opportunities?market=all`.
2. Confirm the feed renders without horizontal overflow and shows only active opportunities by default.
3. Exercise search and filters for agency/source, geography, deadline, posted date, status, opportunity type, NAICS, and federal/local level; confirm empty result sets render normally rather than throwing.
4. Open the opportunity that has no AI/intelligence output. Confirm the detail page still renders its title, solicitation metadata, classifications, source evidence, and document section without an exception or loading loop.
5. Confirm inactive documents are not shown and the visible document metadata corresponds to the latest stored version.
6. For a pending extraction, confirm the UI presents a non-error pending state.
7. For a successful extraction, confirm extracted segments are readable and loading additional segments does not duplicate earlier content.
8. For a failed extraction, confirm the user-facing message is generic and contains no source credential, API key, session value, signed URL, or storage token.
9. For unsupported and stale documents, confirm those states render without breaking the rest of the detail page.
10. Navigate directly to a missing opportunity UUID and to a mismatched opportunity/document extraction URL; confirm the application returns its normal not-found behavior rather than exposing persistence details.

## Expected result

Opportunity discovery and detail rendering remain usable with partial data. Missing AI/intelligence data, incomplete document extraction, unsupported files, and archived/inactive document records do not prevent the page from rendering or expose source-sensitive information.
