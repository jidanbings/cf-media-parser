// ========================================
// SimpleZip — 轻量 ZIP 打包工具
// 功能: 在 Cloudflare Workers 环境中生成 ZIP 文件
// ========================================

export class SimpleZip {
  constructor() {
    this.files = [];
  }

  addFile(name, data) {
    this.files.push({ name, data });
  }

  generate() {
    const parts = [];
    const dirEntries = [];
    let offset = 0;

    for (const file of this.files) {
      const name = file.name.replace(/\\/g, '/');
      const nameBytes = new TextEncoder().encode(name);
      const crc = this.crc32(file.data);

      // Local file header
      const localHeader = new Uint8Array(30 + nameBytes.length);
      let p = 0;
      localHeader[p++] = 0x50; localHeader[p++] = 0x4B; // PK
      localHeader[p++] = 0x03; localHeader[p++] = 0x04; // Local file header signature
      localHeader[p++] = 0x0A; localHeader[p++] = 0x00; // Version needed
      localHeader[p++] = 0x00; localHeader[p++] = 0x00; // General purpose bit flag
      localHeader[p++] = 0x00; localHeader[p++] = 0x00; // Compression method (store)
      localHeader[p++] = 0x00; localHeader[p++] = 0x00; // Last mod time
      localHeader[p++] = 0x00; localHeader[p++] = 0x00; // Last mod date
      this.writeLE32(localHeader, p, crc); p += 4;
      this.writeLE32(localHeader, p, file.data.length); p += 4; // Compressed size
      this.writeLE32(localHeader, p, file.data.length); p += 4; // Uncompressed size
      this.writeLE16(localHeader, p, nameBytes.length); p += 2;
      this.writeLE16(localHeader, p, 0); p += 2; // Extra field length
      for (let i = 0; i < nameBytes.length; i++) localHeader[p++] = nameBytes[i];

      dirEntries.push({ nameBytes, crc, size: file.data.length, offset });
      parts.push(localHeader);
      parts.push(file.data);
      offset += localHeader.length + file.data.length;
    }

    const dirOffset = offset;

    // Central directory entries
    for (const entry of dirEntries) {
      const dirEntry = new Uint8Array(46 + entry.nameBytes.length);
      let p = 0;
      dirEntry[p++] = 0x50; dirEntry[p++] = 0x4B;
      dirEntry[p++] = 0x01; dirEntry[p++] = 0x02; // Central directory header signature
      dirEntry[p++] = 0x0A; dirEntry[p++] = 0x00; // Version made by
      dirEntry[p++] = 0x0A; dirEntry[p++] = 0x00; // Version needed
      dirEntry[p++] = 0x00; dirEntry[p++] = 0x00; // General purpose bit flag
      dirEntry[p++] = 0x00; dirEntry[p++] = 0x00; // Compression method
      dirEntry[p++] = 0x00; dirEntry[p++] = 0x00; // Last mod time
      dirEntry[p++] = 0x00; dirEntry[p++] = 0x00; // Last mod date
      this.writeLE32(dirEntry, p, entry.crc); p += 4;
      this.writeLE32(dirEntry, p, entry.size); p += 4;
      this.writeLE32(dirEntry, p, entry.size); p += 4;
      this.writeLE16(dirEntry, p, entry.nameBytes.length); p += 2;
      this.writeLE16(dirEntry, p, 0); p += 2; // Extra field length
      this.writeLE16(dirEntry, p, 0); p += 2; // File comment length
      this.writeLE16(dirEntry, p, 0); p += 2; // Disk number start
      this.writeLE16(dirEntry, p, 0); p += 2; // Internal file attributes
      this.writeLE32(dirEntry, p, 0); p += 4; // External file attributes
      this.writeLE32(dirEntry, p, entry.offset); p += 4;
      for (let i = 0; i < entry.nameBytes.length; i++) dirEntry[p++] = entry.nameBytes[i];
      parts.push(dirEntry);
    }

    const dirSize = offset - dirOffset;

    // End of central directory record
    const eocd = new Uint8Array(22);
    let p = 0;
    eocd[p++] = 0x50; eocd[p++] = 0x4B;
    eocd[p++] = 0x05; eocd[p++] = 0x06; // EOCD signature
    eocd[p++] = 0x00; eocd[p++] = 0x00; // Disk number
    eocd[p++] = 0x00; eocd[p++] = 0x00; // Disk where central directory starts
    this.writeLE16(eocd, p, dirEntries.length); p += 2;
    this.writeLE16(eocd, p, dirEntries.length); p += 2;
    this.writeLE32(eocd, p, dirSize); p += 4;
    this.writeLE32(eocd, p, dirOffset); p += 4;
    this.writeLE16(eocd, p, 0); p += 2; // Comment length
    parts.push(eocd);

    // Concatenate all parts
    let totalSize = 0;
    for (const part of parts) totalSize += part.length;
    const result = new Uint8Array(totalSize);
    let pos = 0;
    for (const part of parts) { result.set(part, pos); pos += part.length; }
    return result;
  }

  writeLE16(arr, offset, value) {
    arr[offset] = value & 0xFF;
    arr[offset + 1] = (value >> 8) & 0xFF;
  }

  writeLE32(arr, offset, value) {
    arr[offset] = value & 0xFF;
    arr[offset + 1] = (value >> 8) & 0xFF;
    arr[offset + 2] = (value >> 16) & 0xFF;
    arr[offset + 3] = (value >>> 24) & 0xFF;
  }

  crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}
