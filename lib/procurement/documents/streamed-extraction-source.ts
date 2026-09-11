import { createHash } from "node:crypto";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class DocumentSourceSizeLimitError extends Error {
  constructor(
    readonly bytesRead: number,
    readonly maxSourceBytes: number,
  ) {
    super(`Document exceeded the source size bound of ${maxSourceBytes} bytes`);
    this.name = "DocumentSourceSizeLimitError";
  }
}

export type CollectedDocumentStream = {
  checksumSha256: string;
  bytesRead: number;
  buffer: Buffer | null;
  filePath: string | null;
  exceededBufferLimit: boolean;
  cleanup: () => Promise<void>;
};

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

export async function collectDocumentStreamForExtraction(input: {
  chunks: AsyncIterable<Uint8Array>;
  maxBufferBytes: number;
  maxSourceBytes: number;
  spoolToDisk: boolean;
  tempRoot?: string;
}): Promise<CollectedDocumentStream> {
  const maxBufferBytes = positiveInteger(input.maxBufferBytes, "maxBufferBytes");
  const maxSourceBytes = positiveInteger(input.maxSourceBytes, "maxSourceBytes");
  const hash = createHash("sha256");
  const memoryChunks: Buffer[] = [];
  let bytesRead = 0;
  let bufferable = true;
  let spoolDirectory: string | null = null;
  let filePath: string | null = null;
  let fileHandle: FileHandle | null = null;

  const cleanup = async () => {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
      fileHandle = null;
    }
    if (spoolDirectory) {
      await rm(spoolDirectory, { recursive: true, force: true });
      spoolDirectory = null;
    }
  };

  try {
    if (input.spoolToDisk) {
      spoolDirectory = await mkdtemp(join(input.tempRoot ?? tmpdir(), "govtract-extraction-"));
      filePath = join(spoolDirectory, "source.pdf");
      fileHandle = await open(filePath, "w");
    }

    for await (const value of input.chunks) {
      const chunk = Buffer.from(value);
      bytesRead += chunk.byteLength;
      if (bytesRead > maxSourceBytes) {
        throw new DocumentSourceSizeLimitError(bytesRead, maxSourceBytes);
      }

      hash.update(chunk);
      if (fileHandle) await fileHandle.write(chunk);

      if (bufferable) {
        if (bytesRead <= maxBufferBytes) {
          memoryChunks.push(chunk);
        } else {
          memoryChunks.length = 0;
          bufferable = false;
        }
      }
    }

    if (fileHandle) {
      await fileHandle.close();
      fileHandle = null;
    }

    return {
      checksumSha256: hash.digest("hex"),
      bytesRead,
      buffer: bufferable ? Buffer.concat(memoryChunks) : null,
      filePath,
      exceededBufferLimit: !bufferable,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
