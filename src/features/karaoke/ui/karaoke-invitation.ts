import { parseKaraokeAddress } from '../lan/secure-channel';

export const KARAOKE_INVITE_ADDRESS_LIMIT = 128;

export function formatKaraokeInviteText(address: string, roomCode: string): string {
  return `地址：${address}\n房号：${roomCode}`;
}

export function readKaraokeInviteText(text: string): {address: string; roomCode?: string} | null {
  if (text.length > 512) return null;
  const lines = text.trim().split(/\r?\n/u);
  let address: string | undefined;
  let roomCode: string | undefined;

  for (const line of lines) {
    const code = line.trim().match(/^(?:(?:六位)?(?:房间码|房间号|房号)\s*[：:]\s*)?(\d{6})$/u)?.[1];
    if (code) {
      if (roomCode && roomCode !== code) return null;
      roomCode = code;
      continue;
    }
    const candidate = line.replace(/^\s*(?:房主地址|局域网地址|地址)\s*[：:]\s*/u, '').replace(/：/gu, ':').trim();
    if (!candidate || candidate.length > KARAOKE_INVITE_ADDRESS_LIMIT) continue;
    let parsed: ReturnType<typeof parseKaraokeAddress>;
    try {
      parsed = parseKaraokeAddress(candidate);
    } catch {
      continue;
    }
    const canonical = `${parsed.endpoint}#${parsed.publicKey}`;
    if (address && address !== canonical) return null;
    address = canonical;
  }

  return address ? {address, roomCode} : null;
}
