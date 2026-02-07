# Telegram User (MTProto) Channel Plugin

This plugin connects a **Telegram user account** via MTProto (GramJS). It is separate from the Telegram Bot API channel.

## Config (JSON5)

```json5
{
  channels: {
    "telegram-user": {
      enabled: true,
      apiId: 123456,
      apiHash: "YOUR_API_HASH",
      // Optional: override session storage path
      // sessionFile: "/home/node/.clawdbot/credentials/telegram-user/default.session",
      dmPolicy: "pairing",
      allowFrom: ["*"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["*"],
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

## Login (Agent Tool)

The plugin exposes a tool `telegram_user_login`:

1) Send a login code:
```
{ "action": "sendCode", "phoneNumber": "+1234567890" }
```

2) Sign in using the code:
```
{ "action": "signIn", "phoneCode": "12345" }
```

The session string is stored at:
```
~/.clawdbot/credentials/telegram-user/<accountId>.session
```

You can also save a known session string directly:
```
{ "action": "saveSession", "sessionString": "<string session>" }
```

## Notes

- 2FA/password-based logins are **not** handled yet. If your account requires a password, generate a session string externally and use `saveSession`.
- Media sending is not implemented yet (text only).
