// Lightweight module: no external dependencies.
// Holds the cached Telegram owner ID so dock.ts can read it without importing pairing-store.
let _cachedOwner: string | undefined;

export function getTelegramOwner(): string | undefined {
  return _cachedOwner;
}

export function setTelegramOwner(id: string | undefined): void {
  _cachedOwner = id;
}
