type ZipEntry = { name: string; content: Uint8Array };

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

function u32(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function concat(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export function buildZip(entries: ZipEntry[]) {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/\\/g, "/"));
    const crc = crc32(entry.content);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(entry.content.length), u32(entry.content.length), u16(name.length), u16(0),
      name, entry.content,
    ]);
    locals.push(local);
    centrals.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(entry.content.length), u32(entry.content.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }

  const central = concat(centrals);
  return concat([
    ...locals,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
}

export function buildBidPackage(input: {
  title: string;
  content: string;
  manifest: Record<string, unknown>;
}) {
  const readme = [
    input.title,
    "",
    "This archive contains the saved govTract response artifact and package manifest.",
    "Supporting items marked as externally supplied are not fabricated or copied into the archive unless govTract actually stores them.",
    "Submit only through the authoritative procurement channel and retain its receipt.",
  ].join("\n");
  return buildZip([
    { name: "bid-response.txt", content: encoder.encode(input.content) },
    { name: "manifest.json", content: encoder.encode(JSON.stringify(input.manifest, null, 2)) },
    { name: "README.txt", content: encoder.encode(readme) },
  ]);
}
