# Palabra Pura — Chatbot Interface

A web interface for a RAG chatbot that helps people who are beginning their walk of faith.

## Why this exists

When you start getting to know God and living by His Word, questions come up every day.
*Why does God allow bad things to happen? How do I pray in tongues?* But you can't always go
to church or reach a mentor at any hour.

This chatbot answers those questions using the teachings from the ministry's videos — and it
always shows **the Bible passage** and **the source video, cued to the exact minute**, so the
person can open their own Bible and see it for themselves. It doesn't replace Scripture; it
leads you to it.

This repository holds the **front end**: the chat interface, the example questions, and the
source card that surfaces the passage and the video. The ingestion pipeline, the vector
database, and the answering backend live outside this repo.

## Running it locally

⚠️ **Do not open `index.html` by double-clicking it.** ES6 modules are blocked over the
`file://` protocol and the page will render blank. It must be served over HTTP.

```bash
npx serve .
# or
python3 -m http.server 8000
```

VS Code's **Live Server** extension works too.

## Connecting the backend

The interface ships in **demo mode**: it answers with sample content so it can be shown
without a backend. To connect it to the real chatbot, either:

- Click **"Demo · Conectar"** in the header and paste the endpoint URL, or
- Set `endpoint` in `js/config.js`:

```js
endpoint: "https://YOUR-PROJECT.supabase.co/functions/v1/chat",
```

### API contract

The endpoint receives:

```json
{ "question": "¿Qué significa nacer de nuevo?" }
```

And returns:

```json
{
  "answer": "The answer text",
  "passage": { "reference": "Juan 3:16", "text": "Porque de tal manera..." },
  "video": {
    "title": "El nuevo nacimiento",
    "episode": 3,
    "youtube_id": "abc123XYZ_1",
    "start_second": 132
  }
}
```

`passage` and `video` are optional. From `start_second`, the interface builds the YouTube
link that jumps straight to that moment in the video.

## Architecture

```
├── index.html          Semantic markup only. No logic, no inline styles.
├── css/
│   ├── tokens.css      Design tokens — the single source of truth for the visual identity.
│   ├── base.css        Reset, typography, accessibility.
│   ├── layout.css      Header, hero, panels, footer.
│   ├── chat.css        Chat, messages, source card.
│   └── modal.css       Connection panel.
└── js/
    ├── main.js         Entry point. Wires modules together; does no work itself.
    ├── config.js       Endpoint, example questions, copy.
    ├── services/
    │   └── ChatService.js   The only layer that talks to the network.
    ├── ui/
    │   ├── ChatView.js      Renders messages.
    │   ├── SourceCard.js    Bible passage + video card.
    │   ├── Composer.js      Input field.
    │   ├── ExampleChips.js  Starter questions.
    │   └── ConnectModal.js  Endpoint connection dialog.
    ├── data/
    │   └── demoResponses.js Sample answers for demo mode.
    └── utils/
        ├── dom.js           DOM helpers.
        └── format.js        HTML escaping, timestamps, links.
```

### Principles

- **One responsibility per module.** `ChatView` paints. `ChatService` talks to the network.
  `main.js` connects them. Nobody does anybody else's job.
- **The UI knows nothing about the network.** Swapping the backend means touching one file.
- **All text is escaped** before it reaches the DOM — including whatever the backend returns.
- **The visual identity lives in `tokens.css`.** Change a token, and it propagates everywhere.

## Roadmap

- **Embeddable widget** for the church website. The `js/` layer is reused as-is; only the
  shell changes — a floating bubble instead of a full page. That's why `ChatView`,
  `ChatService`, and `SourceCard` know nothing about the page around them.
- **Verified Bible text.** Passage references are drawn from what the pastor actually says in
  the transcript, never invented by the model. Serving the verse text from a stored
  Reina-Valera table would guarantee it is quoted faithfully.

## Notes

Sample verses in demo mode are from the Reina-Valera 1909 edition (public domain).
