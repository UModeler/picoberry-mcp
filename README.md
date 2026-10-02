<p align="center">
  <img src=".github/logo.png" alt="PicoBerry" width="96" height="96">
</p>

<h1 align="center">PicoBerry MCP Server</h1>

Generate **3D models, images, and animations** for game and 3D workflows from any
MCP client — Claude Code, Cursor, Claude Desktop, Cline — with no HTTP glue. A thin
wrapper over the [PicoBerry](https://picoberry.ai) `/v1` API, so you get PicoBerry's
multi-engine pipeline directly inside your agent. Several 3D and image engines
sit behind one API; call `list_models` for the live set and each engine's cost.
Generated assets are drafts — useful for prototyping and iteration, and can be
reviewed or refined for your project.

📖 **Full reference:** [API + MCP docs](https://api.picoberry.ai/docs/mcp) · [PicoBerry API](https://api.picoberry.ai/docs)

> **There's no separate subscription for the MCP or the API.** Generation spends
> the same prepaid PicoBerry credits as the web app, per engine, at rates you can
> read with `list_models` before you spend anything. (Using the API does require
> a completed purchase — see [Get an API key](#get-an-api-key).)

## Install

No install needed — run it with `npx`:

```jsonc
// Claude Code:  .mcp.json   ·   Claude Desktop:  claude_desktop_config.json
{
  "mcpServers": {
    "picoberry": {
      "command": "npx",
      "args": ["-y", "@picoberry/mcp-server"],
      "env": {
        "PICOBERRY_API_KEY": "pb_live_xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Cursor uses the same shape in `~/.cursor/mcp.json`.

### Get an API key

Sign in at <https://picoberry.ai>, open the **[API Keys](https://picoberry.ai/dashboard/api-keys)**
tab in your dashboard, and hit **Create key**. The key is shown once — copy it
immediately and treat it like a password.

API access needs a completed purchase: a subscription **or a one-off credit
pack**. A purchase entitles you permanently — you don't need a *current*
subscription. (An active paid subscription works too, of course.)

### Environment variables

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `PICOBERRY_API_KEY` | ✅ | — | `pb_live_...` |
| `PICOBERRY_API_BASE` | — | `https://api.picoberry.ai` | leave unset unless you were given a different host |

## Tools

| Tool | What it does |
|------|--------------|
| `list_models` | Engines + credit cost for a category (`3d` / `image` / `parts-board` / `remesh` / `texture` / `animate`). Call before generating — don't hardcode engines. |
| `list_animation_presets` | Animation preset ids (engine-specific), with optional substring filter. |
| `get_credits` | Current credit balance. |
| `generate_image` | Text → image (+ optional reference image URLs). |
| `generate_3d_from_text` | Text → 3D model (GLB). |
| `generate_3d_from_image` | Image → 3D model. Single: `image_url` or local `image_path`. Multi-view (2–4 views, higher fidelity): `image_urls` or `image_paths`, ordered [front, left, back, right] — tripo\*/meshy6/hunyuan-3.x only. |
| `parts_board` | Decompose one image into an exploded parts-board image (server-fixed engine). Input `asset_id`, `image_url`, or local `image_path`; feed the result to `generate_3d_from_image` for a parts-separated mesh. |
| `remesh` | Retopologize an existing 3D asset → new asset. |
| `texture` | Re-texture (PBR) an existing 3D asset → new asset. |
| `animate` | Auto-rig + animate an existing 3D character → new asset. |
| `get_asset` | Status + result URLs for one asset. |
| `wait_for_asset` | Poll until an asset finishes (or times out), then return it. |
| `list_my_assets` | Browse your generated assets. |
| `download_asset` | Export a completed 3D asset (`glb` / `fbx` / `obj`) → signed URL. |

## How generation works

Generation is **asynchronous**:

1. `generate_3d_from_text({ prompt })` → returns an asset `{ id }`.
2. `wait_for_asset({ asset_id: id })` → polls until `taskStatus === 2` (succeeded).
3. Read the result URL from `files.model` (GLB) or `files.image` (PNG).

`taskStatus`: `0` pending · `1` processing · `2` succeeded · `3` failed. Result
URLs are signed and short-lived — download promptly. Errors come back with an
actionable message (e.g. an unknown engine returns the list of valid names).

## Example (in an agent)

> "Make a low-poly treasure chest, retopo it to 3k tris, and give me a Unity FBX."

```
list_models(category="3d")                         → pick an engine
generate_3d_from_text(prompt="low-poly treasure chest")  → { id: A }
wait_for_asset(asset_id=A)                          → taskStatus 2
remesh(asset_id=A, polycount=3000)                  → { id: B }
wait_for_asset(asset_id=B)
download_asset(asset_id=B, format="fbx", texture_preset="unity")  → signed URL
```

## Use it alongside Blender MCP

Run this next to [`blender-mcp`](https://github.com/ahujasid/blender-mcp) and the
agent can generate with PicoBerry, then import into Blender in one flow:

```jsonc
{
  "mcpServers": {
    "picoberry": { "command": "npx", "args": ["-y", "@picoberry/mcp-server"], "env": { "PICOBERRY_API_KEY": "pb_live_..." } },
    "blender":   { "command": "uvx", "args": ["blender-mcp"] }
  }
}
```

## Develop

```bash
npm install
npm run build      # tsc → dist/
PICOBERRY_API_KEY=pb_live_... npm start
```

## Release

Run **Actions → Publish → Run workflow** (or push a `v*` tag). It publishes to
npm and then to the official MCP registry, in that order — the registry
validates by fetching the package's npm metadata and matching its `mcpName`
against `server.json`'s `name`, so npm has to land first. A guard step checks
every invariant (name/version agreement, namespace casing, version not already
on npm) *before* anything is published, because npm versions are immutable and a
failed half-publish burns the number.

Bump `version` in **both** `package.json` and `server.json` (`version` and
`packages[0].version`) — the guard fails the run if they disagree.

**One-time setup — no secrets.** Both publishes authenticate over the workflow's
GitHub OIDC token (`id-token: write`). There is nothing to store or rotate.

The only step is telling npm to trust this workflow. On npmjs.com go to
**@picoberry/mcp-server → Settings → Trusted publishing → GitHub Actions** and
enter:

| Field | Value |
|-------|-------|
| Organization or user | `UModeler` |
| Repository | `picoberry-mcp` |
| Workflow filename | `publish.yml` |
| Environment name | *(leave empty)* |
| Allowed actions | `npm publish` |

The workflow filename must match exactly — it is part of what npm verifies.

The MCP registry needs no setup at all: `mcp-publisher` exchanges the Actions
OIDC token, and the registry grants `io.github.<repository_owner>/*` from the
token's `repository_owner` claim. That covers `io.github.UModeler/picoberry-mcp`
and avoids the interactive browser login (which additionally requires org Owner).

> Trusted Publishing needs **npm >= 11.5.1**, so the workflow runs on **Node 24**
> (npm 11.x). Node 22 still bundles npm 10.9 and would fail — the `node-version`
> pin is load-bearing. A guard step fails the run early if the runner ever ships
> an older npm.

> The namespace is compared **byte-exactly** — `io.github.UModeler/...`, matching
> the GitHub org's login. A lowercased `io.github.umodeler/...` is rejected 403.

**After publishing**, claim the [Glama listing](https://glama.ai/mcp/servers/UModeler/picoberry-mcp)
— unclaimed servers get limited discoverability, and `awesome-mcp-servers` gates
its PRs on a Glama badge in CI.

## License

MIT
