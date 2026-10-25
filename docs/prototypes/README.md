# Agent Hub UI prototype

Static prototype for the Agent Hub web client. It uses mock providers and sessions. No backend is required.

## Run

From the repository root:

```sh
python3 -m http.server 4174 --bind 0.0.0.0 --directory docs/prototypes
```

Open <http://127.0.0.1:4174>.

## What to try

- Switch between Inbox, Sessions, Search, Providers, and Settings.
- Open a session from the inbox or session list.
- Approve or deny the OpenCode permission card.
- Answer the Hermes question.
- Send a message in the chat composer.
- Create a new session with the plus button.
- Toggle the theme with the sun/moon button.
- Resize the browser to a phone width to see the mobile navigation.
- On mobile, open a session and tap the details icon.

## Scope

The prototype covers the information architecture, visual language, and key flows from `docs/ui-ia.md`. It does not call real provider APIs. Data resets on reload.
