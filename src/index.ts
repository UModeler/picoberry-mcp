#!/usr/bin/env node
/**
 * PicoBerry MCP server — exposes PicoBerry's /v1 generation API as MCP tools.
 *
 * Thin wrapper: each tool maps to one REST call, unwraps the response envelope,
 * and returns JSON text the agent reads. Generation is asynchronous —
 *   generate_* / remesh / texture / animate  →  { id }
 *   →  wait_for_asset(id)  (or poll get_asset)  until taskStatus === 2
 *   →  read files.model (GLB) / files.image (PNG).
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { PicoBerryClient, PicoBerryError } from "./client.js";

const API_KEY = process.env.PICOBERRY_API_KEY;
// Default to the documented, branded host. `saas-api.umodeler.com` serves the
// same API and was the previous default, but it appears in no public doc — a
// registry install that omits PICOBERRY_API_BASE (it is optional) would have
// been silently pinned to a hostname nobody could look up, and would break the
// day that host is retired.
const API_BASE =
  process.env.PICOBERRY_API_BASE?.replace(/\/+$/, "") ??
  "https://api.picoberry.ai";

if (!API_KEY) {
  console.error(
    "[picoberry-mcp] Missing PICOBERRY_API_KEY.\n" +
      "  Create a key at https://picoberry.ai → Profile → API Keys, then set it in\n" +
      '  your MCP config env, e.g. { "env": { "PICOBERRY_API_KEY": "pb_live_..." } }.',
  );
  process.exit(1);
}

const client = new PicoBerryClient(API_KEY, API_BASE);

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** Run a tool body, mapping PicoBerry/unexpected errors into an actionable text result. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof PicoBerryError) {
      return fail(`PicoBerry error${e.code ? ` [${e.code}]` : ""}: ${e.message}`);
    }
    return fail(`Unexpected error: ${(e as Error).message}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = new McpServer({ name: "picoberry", version: "0.1.4" });

/* ------------------------------ Discovery ------------------------------ */

server.tool(
  "list_models",
  "List available generation engines/models and their credit cost for a category. " +
    "Call this before generating instead of hardcoding engine names. Returns " +
    "[{ name, label, cost, paidOnly, ... }] — use `name` as the engine/model value.",
  { category: z.enum(["3d", "image", "parts-board", "remesh", "texture", "animate"]).default("3d") },
  async ({ category }) =>
    run(async () => (await client.request("GET", "/v1/models", { query: { category } })).data),
);

server.tool(
  "list_animation_presets",
  "List animation preset ids for the `animate` tool. Presets are engine-specific " +
    "(Tripo ~97 / Meshy ~675) — pick one from the SAME engine you animate with. " +
    "Optionally filter with a case-insensitive substring.",
  {
    engine: z.enum(["tripo", "meshy"]).default("tripo"),
    search: z
      .string()
      .optional()
      .describe("case-insensitive filter on the preset name/category"),
  },
  async ({ engine, search }) =>
    run(async () => {
      const { data } = await client.request<Array<Record<string, unknown>>>(
        "GET",
        "/v1/animations",
        { query: { engine } },
      );
      if (!search) return data;
      const q = search.toLowerCase();
      return data.filter((p) => JSON.stringify(p).toLowerCase().includes(q));
    }),
);

server.tool(
  "get_credits",
  "Get the current PicoBerry credit balance and plan for the authenticated key.",
  {},
  async () => run(async () => (await client.request("GET", "/v1/credits")).data),
);

/* ----------------------------- Generation ------------------------------ */

server.tool(
  "generate_image",
  "Generate a 2D image from a text prompt (async). Returns an asset { id }; then call " +
    "wait_for_asset (or poll get_asset) until taskStatus=2 and read files.image (PNG URL). " +
    "Costs credits — see list_models(category='image'). Omit `model` for the default. " +
    "Up to 4 reference image URLs can guide the result (best with nano-banana).",
  {
    prompt: z.string().max(5000),
    model: z
      .string()
      .optional()
      .describe("engine name from list_models(category='image')"),
    aspect_ratio: z.string().optional().describe('e.g. "1:1", "16:9", "9:16"'),
    reference_image_urls: z.array(z.string().url()).max(4).optional(),
  },
  async ({ prompt, model, aspect_ratio, reference_image_urls }) =>
    run(
      async () =>
        (
          await client.request("POST", "/v1/images", {
            json: {
              prompt,
              ...(model ? { model } : {}),
              ...(aspect_ratio ? { aspectRatio: aspect_ratio } : {}),
              ...(reference_image_urls ? { referenceImages: reference_image_urls } : {}),
            },
          })
        ).data,
    ),
);

server.tool(
  "generate_3d_from_text",
  "Generate a game-ready 3D model (GLB) from a text prompt (async). Returns an asset " +
    "{ id }; call wait_for_asset (or poll get_asset) until taskStatus=2 and read " +
    "files.model (GLB URL). Costs credits — see list_models(category='3d'). Omit `engine` " +
    "for the default.",
  {
    prompt: z.string().max(1024).describe("≤1024 chars (Tripo engine limit)"),
    engine: z
      .string()
      .optional()
      .describe("engine name from list_models(category='3d')"),
    polycount: z.number().int().positive().optional(),
    texture: z.boolean().default(true),
  },
  async ({ prompt, engine, polycount, texture }) =>
    run(
      async () =>
        (
          await client.request("POST", "/v1/models/from-text", {
            json: {
              prompt,
              ...(engine ? { engine } : {}),
              ...(polycount ? { polycount } : {}),
              texture,
            },
          })
        ).data,
    ),
);

server.tool(
  "generate_3d_from_image",
  "Generate a 3D model (GLB) from one image, or from 2–4 views of the same subject " +
    "(multi-view → higher-fidelity geometry), async. Single: `image_url` (any public " +
    "http/https image, or a prior generation's files.image) OR `image_path` (a local file, " +
    "uploaded directly — no hosting needed). Multi-view: `image_urls` OR `image_paths`, " +
    "ordered [front, left, back, right] (2–4 views). Multi-view is only supported by tripo*, " +
    "meshy6, and hunyuan-3.x engines — others return 400. Local files win over URLs. Then " +
    "wait_for_asset and read files.model. Costs credits — see list_models(category='3d').",
  {
    image_url: z.string().url().optional().describe("single hosted image URL"),
    image_path: z
      .string()
      .optional()
      .describe("absolute path to a single local image file (≤20MB)"),
    image_urls: z
      .array(z.string().url())
      .min(2)
      .max(4)
      .optional()
      .describe("multi-view: 2–4 hosted image URLs, ordered [front, left, back, right]"),
    image_paths: z
      .array(z.string())
      .min(2)
      .max(4)
      .optional()
      .describe(
        "multi-view: 2–4 local image file paths (each ≤20MB), ordered [front, left, back, right]",
      ),
    engine: z.string().optional(),
    polycount: z.number().int().positive().optional(),
    texture: z.boolean().default(true),
  },
  async ({ image_url, image_path, image_urls, image_paths, engine, polycount, texture }) =>
    run(async () => {
      // Resolve source images with the same precedence as the backend facade:
      // local files > hosted URLs, and multi-view arrays > single fields.
      const paths = image_paths?.length
        ? image_paths
        : image_path
          ? [image_path]
          : [];
      const urls = image_urls?.length ? image_urls : image_url ? [image_url] : [];
      if (!paths.length && !urls.length) {
        throw new PicoBerryError(
          "Provide one of: image_url / image_path (single), or image_urls / image_paths (2–4 views).",
        );
      }
      // Local files → multipart. Single uses the `image` part, multi-view `images`.
      if (paths.length) {
        const form = new FormData();
        const field = paths.length > 1 ? "images" : "image";
        for (const p of paths) {
          form.append(field, new Blob([await readFile(p)]), basename(p));
        }
        if (engine) form.append("engine", engine);
        if (polycount) form.append("polycount", String(polycount));
        form.append("texture", String(texture));
        return (await client.request("POST", "/v1/models/from-image", { form })).data;
      }
      // Hosted URLs → JSON. Single uses `imageUrl`, multi-view `imageUrls`.
      const json = {
        ...(urls.length > 1 ? { imageUrls: urls } : { imageUrl: urls[0] }),
        ...(engine ? { engine } : {}),
        ...(polycount ? { polycount } : {}),
        texture,
      };
      return (await client.request("POST", "/v1/models/from-image", { json })).data;
    }),
);

server.tool(
  "parts_board",
  'Decompose one reference image into an exploded "parts board" image (async) — the ' +
    "subject laid out as separated components on one canvas. Input: `asset_id` (an existing " +
    "IMAGE asset you own), `image_url` (a public http/https image), OR `image_path` (a local " +
    "file, uploaded directly). Engine/resolution/prompt are server-fixed — no params. Returns " +
    "an asset { id }; call wait_for_asset (or poll get_asset) until taskStatus=2 and read " +
    "files.image (the board PNG). Feed that image to generate_3d_from_image for a " +
    "parts-separated mesh. Costs 80 credits — see list_models(category='parts-board'). " +
    "Precedence when several are set: image_path > asset_id > image_url.",
  {
    asset_id: z
      .string()
      .optional()
      .describe("id of an existing IMAGE asset you own to decompose"),
    image_url: z.string().url().optional().describe("public http/https source image URL"),
    image_path: z
      .string()
      .optional()
      .describe("absolute path to a local image file (≤20MB), uploaded directly"),
  },
  async ({ asset_id, image_url, image_path }) =>
    run(async () => {
      if (!asset_id && !image_url && !image_path) {
        throw new PicoBerryError(
          "Provide one of: asset_id, image_url, or image_path.",
        );
      }
      // Precedence mirrors the backend facade: local file > asset_id > image_url.
      if (image_path) {
        const form = new FormData();
        form.append("image", new Blob([await readFile(image_path)]), basename(image_path));
        return (await client.request("POST", "/v1/images/parts-board", { form })).data;
      }
      const json = asset_id ? { assetId: asset_id } : { imageUrl: image_url };
      return (await client.request("POST", "/v1/images/parts-board", { json })).data;
    }),
);

/* --------------------------- Post-processing --------------------------- */

server.tool(
  "remesh",
  "Retopologize an existing 3D asset into a NEW asset (async). Costs credits — see " +
    "list_models(category='remesh') (pb-remesh is cheapest). wait_for_asset → files.model.",
  {
    asset_id: z.string(),
    engine: z.string().optional(),
    polycount: z.number().int().positive().optional(),
  },
  async ({ asset_id, engine, polycount }) =>
    run(
      async () =>
        (
          await client.request("POST", `/v1/assets/${asset_id}/remesh`, {
            json: {
              ...(engine ? { engine } : {}),
              ...(polycount ? { polycount } : {}),
            },
          })
        ).data,
    ),
);

server.tool(
  "texture",
  "Re-texture an existing 3D asset (PBR) into a NEW asset (async). Describe the desired " +
    "look in `prompt`. Costs credits — see list_models(category='texture'). " +
    "wait_for_asset → files.model.",
  {
    asset_id: z.string(),
    prompt: z.string().optional(),
    engine: z.string().optional(),
  },
  async ({ asset_id, prompt, engine }) =>
    run(
      async () =>
        (
          await client.request("POST", `/v1/assets/${asset_id}/texture`, {
            json: {
              ...(prompt ? { prompt } : {}),
              ...(engine ? { engine } : {}),
            },
          })
        ).data,
    ),
);

server.tool(
  "animate",
  "Auto-rig an existing 3D character asset and apply an animation, producing a NEW asset " +
    "(async). Pick `preset` from list_animation_presets for the SAME engine. Costs credits " +
    "— see list_models(category='animate'). wait_for_asset → files.model.",
  {
    asset_id: z.string(),
    preset: z.string().optional(),
    engine: z.string().optional(),
  },
  async ({ asset_id, preset, engine }) =>
    run(
      async () =>
        (
          await client.request("POST", `/v1/assets/${asset_id}/animate`, {
            json: {
              ...(preset ? { preset } : {}),
              ...(engine ? { engine } : {}),
            },
          })
        ).data,
    ),
);

/* ----------------------------- Asset access ---------------------------- */

server.tool(
  "get_asset",
  "Get a generation's status + result. taskStatus: 0=pending 1=processing 2=succeeded " +
    "3=failed. When succeeded, files.{model,image,thumbnail,textures} hold signed result " +
    "URLs (short TTL — download promptly). On failure, read errorDetail.",
  { asset_id: z.string() },
  async ({ asset_id }) =>
    run(async () => (await client.request("GET", `/v1/assets/${asset_id}`)).data),
);

server.tool(
  "wait_for_asset",
  "Poll an asset until it finishes (taskStatus 2 or 3) or the timeout elapses, then " +
    "return the final asset. Use right after generate_* / remesh / texture / animate. " +
    "3D generations can take several minutes.",
  {
    asset_id: z.string(),
    timeout_seconds: z.number().int().positive().max(1800).default(600),
    poll_interval_seconds: z.number().int().positive().max(60).default(3),
  },
  async ({ asset_id, timeout_seconds, poll_interval_seconds }) =>
    run(async () => {
      const deadline = Date.now() + timeout_seconds * 1000;
      for (;;) {
        const { data } = await client.request<{ taskStatus?: number }>(
          "GET",
          `/v1/assets/${asset_id}`,
        );
        if (data.taskStatus === 2 || data.taskStatus === 3) return data;
        if (Date.now() >= deadline) {
          return { timedOut: true, waitedSeconds: timeout_seconds, lastState: data };
        }
        await sleep(poll_interval_seconds * 1000);
      }
    }),
);

server.tool(
  "list_my_assets",
  "List your generated assets (newest first, owner-scoped) for browsing/sync. " +
    "Filter by category (3d/image/…) or keyword.",
  {
    category: z.string().optional(),
    keyword: z.string().optional(),
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(100).default(20),
  },
  async ({ category, keyword, page, limit }) =>
    run(async () => {
      const { data, totalCount } = await client.request<unknown[]>("GET", "/v1/assets", {
        query: { page, limit, category, keyword },
      });
      return { assets: data, totalCount };
    }),
);

server.tool(
  "download_asset",
  "Export a completed 3D asset and get a short-lived signed download URL. glb = a single " +
    "self-contained file. fbx/obj download as a .zip bundle (model + textures; + Unity " +
    ".meta files when texture_preset='unity') — unzip before importing. For Unity use fbx " +
    "(there is no built-in glb importer).",
  {
    asset_id: z.string(),
    format: z.enum(["glb", "fbx", "obj"]).default("glb"),
    texture_preset: z.enum(["standard", "unity"]).optional(),
    name: z.string().optional(),
  },
  async ({ asset_id, format, texture_preset, name }) =>
    run(
      async () =>
        (
          await client.request("POST", `/v1/assets/${asset_id}/download`, {
            json: {
              format,
              ...(texture_preset ? { texturePreset: texture_preset } : {}),
              ...(name ? { name } : {}),
            },
          })
        ).data,
    ),
);

/* --------------------------------- Boot -------------------------------- */

async function main() {
  await server.connect(new StdioServerTransport());
  // stdout is the MCP transport — all logging must go to stderr.
  console.error(`[picoberry-mcp] connected · base=${API_BASE}`);
}

main().catch((e) => {
  console.error("[picoberry-mcp] fatal:", e);
  process.exit(1);
});
