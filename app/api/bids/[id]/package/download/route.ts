import { buildApprovedBidPackage } from "@/lib/bids/package-persistence";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return Response.json({ error: { message: "Bid workspace id is invalid." } }, { status: 400 });
  }
  try {
    const download = await buildApprovedBidPackage(id);
    return new Response(new Uint8Array(download.bytes), {
      status: 200,
      headers: {
        "content-type": "application/x-tar",
        "content-disposition": `attachment; filename="${download.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bid package could not be downloaded.";
    return Response.json({ error: { message } }, { status: /not found/i.test(message) ? 404 : 409 });
  }
}
