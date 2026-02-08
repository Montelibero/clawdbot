# Telegram User (MTProto) Channel Plugin

IMPORTANT: THIS EXTENSION IS PRIMARILY FOR BOTS. DO NOT USE IT FOR USER ACCOUNTS UNLESS YOU
UNDERSTAND THE RISKS. USER LOGINS VIA PHONE NUMBER ARE SUPPORTED ONLY AT YOUR OWN RISK.
SECURITY WARNING: OPENING DMs OR GROUPS WITHOUT PAIRING/ALLOWLIST CAN LET STRANGERS TRIGGER
YOUR AGENT AND ACCESS CONNECTED TOOLS. ONLY DO THIS IF YOU KNOW EXACTLY WHY YOU NEED IT.

This plugin connects a Telegram account via MTProto (GramJS). It is separate from the Telegram Bot
API channel. The preferred use is MTProto bot auth; user logins are a fallback.

## Config (JSON5)

```json5
{
  channels: {
    "telegram-user": {
      enabled: true,
      apiId: 123456,
      apiHash: "YOUR_API_HASH",
      // Optional: use bot token (MTProto bot auth, RECOMMENDED)
      // botToken: "123456:ABCDEF",
      // DANGEROUS: enables full raw MTProto client access tool
      // allowRawApi: true,
      // Optional: override session storage path
      // sessionFile: "/home/node/.clawdbot/credentials/telegram-user/default.session",
      // Secure defaults: pairing + empty allowlists
      dmPolicy: "pairing",
      allowFrom: [],
      groupPolicy: "allowlist",
      groupAllowFrom: [],
    }
  },
  plugins: {
    entries: {
      "telegram-user": { enabled: true }
    }
  }
}
```

Environment variable fallbacks:
- `TELEGRAM_USER_API_ID`
- `TELEGRAM_USER_API_HASH`
- `TELEGRAM_USER_BOT_TOKEN`

## Login (Agent Tool)

The plugin exposes a tool `telegram_user_login`:

IMPORTANT: THIS IS PRIMARILY FOR BOTS. USER LOGINS VIA PHONE NUMBER ARE NOT RECOMMENDED.

If you want to open access:
1) You must explicitly change `dmPolicy` and/or allowlists.
2) Confirm twice that you understand the risk of unsolicited messages.
3) Expect abusive/hostile traffic if you open access broadly.

1) Send a login code:
```
{ "action": "sendCode", "phoneNumber": "+1234567890" }
```

2) Sign in using the code (USER LOGIN, NOT RECOMMENDED):
```
{ "action": "signIn", "phoneCode": "12345" }
```

The session string is stored at:
```
~/.clawdbot/credentials/telegram-user/<accountId>.session
```

You can also save a known session string directly (USER LOGIN, NOT RECOMMENDED):
```
{ "action": "saveSession", "sessionString": "<string session>" }
```

## History (Agent Tool)

Fetch recent messages from a chat:
```
{ "action": "history", "chatId": "<chatId or @username>", "hours": 24, "limit": 200 }
```

Note: in bot mode (`botToken`), use `ids` form below. `limit` history is user-account mode only.
`hours` and `limit` accept numbers or numeric strings (for XML/string-based tool transports).

Fetch exact message IDs (high-level GramJS method, works for bot mode too):
```
{ "action": "history", "chatId": "<chatId or @username>", "ids": [123, 124, 125] }
```

If your tool transport passes parameters as strings (for example XML `<parameter>`), these also work:
```
{ "action": "history", "chatId": "-1001767165598", "ids": "[4099]" }
```
```
{ "action": "history", "chatId": "-1001767165598", "ids": "4099,4100" }
```

## Raw MTProto (Agent Tool)

Tool: `telegram_user_raw` (disabled by default).

Enable explicitly in config:
```json5
{
  channels: {
    "telegram-user": {
      allowRawApi: true
    }
  }
}
```

Invoke any MTProto API constructor:
```json
{
  "action": "invoke",
  "acknowledgeRisk": true,
  "apiMethod": "channels.EditTitle",
  "params": { "channel": -1001234567890, "title": "New title" }
}
```

Call any high-level TelegramClient method:
```json
{
  "action": "callClient",
  "acknowledgeRisk": true,
  "clientMethod": "getMessages",
  "args": ["@mychat", { "ids": [123, 124] }]
}
```

## Notes

- PRIMARY USE CASE: MTProto bot auth via `botToken`.
- 2FA/password-based user logins are **not** handled yet. If your account requires a password,
  generate a session string externally and use `saveSession` (NOT RECOMMENDED).
- Media sending is not implemented yet (text only).
- MTProto bot mode works via `botToken`, but permissions are still bot-limited.
