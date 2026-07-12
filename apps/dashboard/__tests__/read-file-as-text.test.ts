import { describe, expect, it } from 'vitest';
import { readFileAsText } from '@/lib/outbound/import-parser';

function makeBlob(bytes: number[] | Uint8Array): Blob {
  const array = Array.isArray(bytes) ? bytes : Array.from(bytes);
  const buffer = new Uint8Array(array).buffer;
  return { arrayBuffer: () => Promise.resolve(buffer) } as unknown as Blob;
}

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function utf16LeBytes(text: string): number[] {
  const bytes: number[] = [0xFF, 0xFE];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes.push(code & 0xFF, (code >> 8) & 0xFF);
  }
  return bytes;
}

// GBK 编码:常见中文字符的预计算字节(从 GB2312/GBK 码表)
// 张=D5C5, 三=C8FD, 示=CABE, 例=C0FD, 公=B9AB, 司=CBBE, 号=BAC5, 码=C2EB, 客=BFCD, 户=BBA7
const GBK_TABLE: Record<string, [number, number]> = {
  '张': [0xD5, 0xC5],
  '三': [0xC8, 0xFD],
  '示': [0xCA, 0xBE],
  '例': [0xC0, 0xFD],
  '公': [0xB9, 0xAB],
  '司': [0xCB, 0xBE],
  '号': [0xBA, 0xC5],
  '码': [0xC2, 0xEB],
  '客': [0xBF, 0xCD],
  '户': [0xBB, 0xA7],
};

function gbkBytes(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      bytes.push(code);
    } else {
      const gbk = GBK_TABLE[ch];
      if (gbk) bytes.push(gbk[0], gbk[1]);
      else throw new Error(`No GBK mapping for: ${ch}`);
    }
  }
  return bytes;
}

describe('readFileAsText', () => {
  it('decodes UTF-8 without BOM', async () => {
    const text = 'phone,name\n1001,张三';
    const blob = makeBlob(utf8Bytes(text));
    expect(await readFileAsText(blob)).toBe(text);
  });

  it('decodes UTF-8 with BOM (strips BOM)', async () => {
    const text = 'phone,name\n1001,张三';
    const blob = makeBlob([0xEF, 0xBB, 0xBF, ...utf8Bytes(text)]);
    expect(await readFileAsText(blob)).toBe(text);
  });

  it('decodes GBK file (WPS default save) — the regression case', async () => {
    const text = 'phone,name\n1001,张三';
    const blob = makeBlob(gbkBytes(text));
    expect(await readFileAsText(blob)).toBe(text);
  });

  it('decodes GBK with Chinese headers and data', async () => {
    const text = '号码,客户\n1001,张三';
    const blob = makeBlob(gbkBytes(text));
    expect(await readFileAsText(blob)).toBe(text);
  });

  it('decodes UTF-16 LE with BOM', async () => {
    const text = 'phone,name\n1001,张三';
    const blob = makeBlob(utf16LeBytes(text));
    expect(await readFileAsText(blob)).toBe(text);
  });

  it('prefers UTF-8 when no replacement chars (pure ASCII)', async () => {
    const text = 'phone,name\n1001,John';
    const blob = makeBlob(utf8Bytes(text));
    expect(await readFileAsText(blob)).toBe(text);
  });

  it('handles empty file', async () => {
    const blob = makeBlob([]);
    expect(await readFileAsText(blob)).toBe('');
  });
});
