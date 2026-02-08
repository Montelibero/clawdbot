# Telegram MTProto Methods and Bot Access

Short reference for `telegram-user` raw access (`telegram_user_raw`).

## Full method list

- Official MTProto methods index (all methods):  
  `https://core.telegram.org/methods`
- GramJS high-level client methods (`TelegramClient`):  
  `https://gram.js.org/beta/classes/TelegramClient.html`
- GramJS raw API usage (`Api.*` via `client.invoke`):  
  `https://gram.js.org/`

## How to check bot availability for any method

1. Open method page: `https://core.telegram.org/method/<methodName>`  
   Example: `https://core.telegram.org/method/messages.getHistory`
2. Look for one of these lines:
- `Both users and bots can use this method`
- `Only users can use this method`
- Sometimes method notes include bot-only restrictions in parameter docs/errors.

## Quick table (common operations)

| Method | Bot access | Link |
|---|---|---|
| `messages.getHistory` | No (users only) | `https://core.telegram.org/method/messages.getHistory` |
| `messages.getMessages` | Yes | `https://core.telegram.org/method/messages.getMessages` |
| `messages.sendMessage` | Yes | `https://core.telegram.org/method/messages.sendMessage` |
| `messages.updatePinnedMessage` | Yes | `https://core.telegram.org/method/messages.updatePinnedMessage` |
| `channels.editTitle` | Yes | `https://core.telegram.org/method/channels.editTitle` |
| `channels.editForumTopic` | Yes | `https://core.telegram.org/method/channels.editForumTopic` |
| `messages.readHistory` | No (users only) | `https://core.telegram.org/method/messages.readHistory` |

## Notes

- `BOT_METHOD_INVALID` usually means the method is user-only in MTProto.
- For bot mode history fetch, use ID-based reads (`messages.getMessages`) instead of range history (`messages.getHistory`).
