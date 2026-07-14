# PicoBerry MCP Server

Generate **game-ready 3D models, images, and animations** from any MCP client —
Claude Code, Cursor, Claude Desktop, Cline — with no HTTP glue. A thin wrapper
over the [PicoBerry](https://picoberry.ai) `/v1` API, so you get PicoBerry's
multi-engine pipeline (Tripo, Meshy, Hunyuan, …) directly inside your agent.

> Unity charges for its MCP behind a subscription. **PicoBerry's MCP is free —
> you only pay for what you generate**, per-engine, in credits you can see.

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

Sign in at <https://picoberry.ai> → avatar (top-right) → **Profile → API Keys**
→ **Create key**. The key is shown once — copy it immediately. Treat it like a
password. (API keys require a paid PicoBerry plan.)

### Environment variables

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `PICOBERRY_API_KEY` | ✅ | — | `pb_live_...` |
| `PICOBERRY_API_BASE` | — | `https://saas-api.umodeler.com` | point at dev with `https://saas-dev-api.umodeler.com` |

## Tools

| Tool | What it does |
|------|--------------|
| `list_models` | Engines + credit cost for a category (`3d` / `image` / `remesh` / `texture` / `animate`). Call before generating — don't hardcode engines. |
| `list_animation_presets` | Animation preset ids (engine-specific), with optional substring filter. |
| `get_credits` | Current credit balance + plan. |
| `generate_image` | Text → image (+ optional reference image URLs). |
| `generate_3d_from_text` | Text → 3D model (GLB). |
| `generate_3d_from_image` | Image → 3D model. Pass `image_url` or a local `image_path`. |
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
generate_3d_from_text(prompt="low-poly treasure chest, game ready")  → { id: A }
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

## License

MIT
