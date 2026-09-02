# Nekote Blog

Publish notes and their referenced assets from your vault to a [Nekote Blog](https://nekote.blog)
site. Maintained by the Nekote Blog team.

Pick one folder in your vault as the content root, write as usual, and run a single command to
publish. Obsidian-flavored syntax is converted to standard Markdown on the way out. Nothing is ever
written back into your vault by the publish step.

## Requirements

- Obsidian 1.11.4 or later (the plugin stores its device token in `App.secretStorage`).
- A Nekote Blog account and a blog. See [Disclosures](#disclosures) below.
- Desktop (macOS, Windows, Linux) and mobile (iOS, Android). The plugin uses no Node.js or Electron
  API.

## Usage

1. Open the plugin settings and connect to your blog. Your default browser opens an approval page on
   the Nekote Blog dashboard; approve the device there.
2. In settings, choose one folder as the **content root**.
3. Run **Nekote Blog: Publish** from the command palette, or use the ribbon icon.

Inside the content root, `posts/` holds blog posts and `pages/` holds standalone pages. Subfolders are for
your own organization and do not affect public URLs. Use the `draft` property in frontmatter to
switch between published and draft.

Before anything is uploaded, the plugin shows how many notes are published, drafted, or in error,
and how much data will be sent. It asks for an extra confirmation on the first publish, when the
content root changes, when many files would be deleted, and when another device has published since
your last run.

## Disclosures

### An account is required

The plugin does nothing until it is connected to a blog, which requires a Nekote Blog account. See
[nekote.blog/pricing](https://nekote.blog/pricing) for current plans.

### Network use

The plugin talks to one remote service: the Nekote Blog sync API at `api.nekote.blog`. There is no
setting for an arbitrary URL, so your device token cannot be pointed somewhere else.

All network activity is started by you. There is no request on startup, no background timer, and no
automatic sync on save. Requests happen only when you connect to a blog, refresh the connection
status, or run **Nekote Blog: Publish**. Once a publish is running, the plugin polls the API until
that publish finishes.

Connecting opens `dash.nekote.blog` in your browser so you can approve the device.

### What is sent

- Markdown under `posts/` and `pages/` inside your content root, with Obsidian-flavored syntax
  (wikilinks, embeds, callouts) converted to standard Markdown. Frontmatter is sent as written.
- Assets actually referenced by that Markdown, or by its `thumbnail` / `cover` properties.
- For each of those files: its path relative to the content root (assets: relative to the vault
  root), a SHA-256 hash, its size, and which assets and published notes it links to.
- A random vault identifier generated on first publish, the content root path, and the revision of
  your last publish, so the server can compute the difference.

### What is not sent

- Anything outside `posts/` and `pages/` in your content root. The rest of the vault is never read
  for publishing.
- Your vault name, and absolute paths on your machine.
- The body of notes that are not publish targets. A wikilink to one keeps its display text only.
- `.obsidian/` and other hidden configuration.

### Telemetry

The plugin contains no analytics, tracking, or crash-reporting code.

On the server side, operational logs are limited to a timestamp, device and blog identifiers,
counts, byte totals, status, and error codes. They do not contain note bodies, tokens, or local
paths. Long-lived secrets are stored only as hashes. See the
[privacy policy](https://nekote.blog/privacy) for how the data is handled.

### What is stored on your device

- The device token, and short-lived values used during approval, go into Obsidian's
  `App.secretStorage`. They stay on this device and in this vault, and are not synced.
- Non-secret settings go into the plugin's `data.json`: the connected blog and device names, the
  random vault identifier, the content root, and the revision of your last publish. Tokens are never
  written there.

### Removing your data

- **Disconnect this device** in the plugin settings revokes this device's token.
- Deleting a note from your content root and publishing again removes it from your blog.
- Deleting a blog or a Nekote Blog account happens on the Nekote Blog side. See the
  [privacy policy](https://nekote.blog/privacy) for how that data is handled.

### Writes to your vault

Publishing never modifies your vault. The plugin writes to it only when you ask it to:

- Inserting a frontmatter template into a new or moved note in a publish target folder (this can be
  turned off in settings, and is also available as a command).
- Writing a path into `thumbnail` or `cover` when you pick an image.
- Copying an image into your import folder when you choose to import one from your device.

## Development

```sh
pnpm install
pnpm run dev            # esbuild watch, emits main.js
pnpm run lint           # eslint + prettier
pnpm run typecheck
pnpm run test
pnpm run build          # production build, no sourcemap
pnpm run check:bundle   # asserts the bundle has no Node.js or Electron dependency
```

To run it in a vault, place `main.js`, `manifest.json`, and `styles.css` in
`.obsidian/plugins/nekote-blog/`.

To avoid copying them by hand, put the destination in a `.env` file at the repository root
(gitignored). `pnpm run build` copies the three files there after building. With nothing set it
copies nothing, so CI and releases are unaffected.

```sh
OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/nekote-blog
```

Reload Obsidian afterwards, either with **Reload app without saving** from the command palette or by
toggling the plugin off and on in Community plugins. To try it on a phone or tablet, let your vault
sync deliver that folder.

Assumptions that can only be confirmed on real devices are tracked in
[`docs/on-device-checks.md`](./docs/on-device-checks.md).

### Releasing

Bump the version in `manifest.json` and `versions.json` (`pnpm version <newversion>` updates both),
then push a tag in `x.y.z` form. GitHub Actions builds and creates a release with `main.js`,
`manifest.json`, and `styles.css` attached.

### API contract

The API contract with the server lives in the private `nekote-labs/nekote-blog` repository. This
repository keeps a copy of the schema and fixtures for the matching major version under
[`protocol/v1/`](./protocol/v1/), and depends on no private repository or npm package at runtime.
`tests/protocol-contract.test.ts` compares content hashes so the copy cannot drift unnoticed.

## License

MIT
