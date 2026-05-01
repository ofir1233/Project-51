# P51 — Vision Document

> A SaaS for AI-generated, taste-aware, embeddable Three.js web animations.
>
> Today: the **Lab** — one creation flow ("pair point cloud") proving the loop.
> Tomorrow: the **platform** — a Recipe-driven runtime where every creation type plugs in.

Last revised: 2026-05-01 · Status: Phase A in progress · Owner: Ofir

---

## 1. The one-line pitch

**P51 is a creative tool that turns a prompt + reference photos into an interactive Three.js scene that learns what its user finds beautiful.**

Each scene comes out of a 6-agent chain (architect → prompt-writer → generator → critic → refiner → judge) and renders as a point cloud whose elements are detected, grouped, and given mouse-driven reactions the user choreographs.

The output ships as a portable scene that can be embedded anywhere a `<script>` runs.

---

## 2. The problem

Three.js / WebGL is the most expressive medium on the web — particles, point clouds, shader effects, scroll-driven 3D scenes — but it lives behind a 6-month learning curve. Designers can't author it directly.

Today's options:

| Path | Trade-off |
|---|---|
| **Hand-coded Three.js** | Maximum control, weeks per scene, requires GLSL/JS proficiency |
| **Spline / Unicorn Studio** | No-code WebGL, but every scene is hand-authored (no AI), no taste model, limited interactivity primitives |
| **Rive** | Beautiful state-machine animations, but vector-based (not WebGL), limited to UI-scale interaction |
| **Stock animations / templates** | Cheap and fast, but generic — your hero looks like everyone else's |

There's no tool that produces **personalized**, **AI-generated**, **interactive** WebGL scenes that get **better as you use them**.

That's the wedge.

---

## 3. The product

A web-based studio with three named modes:

```
   CREATE  ──►  CHOREOGRAPH  ──►  STAGE
   generate     group · react     preview · ship
```

### CREATE
The user types a goal, optionally attaches reference photos. They click RUN CHAIN. A 6-agent pipeline runs:

1. **Architect** — plans the scene structure (which layers, what reactions)
2. **Prompt Writer** — composes the image prompt with style vocabulary tuned to the renderer
3. **Generator** — image-to-image with Gemini / Imagen / DALL-E
4. **Style Critic** — scores axes (palette, composition, fidelity, halftone density, brand-aesthetic)
5. **Prompt Refiner** — addresses gaps, runs another generation
6. **Aesthetic Judge** — final gate, predicts user satisfaction using few-shot from the user's prior 👍/👎 labels

The user reviews the finalist in an Approve overlay. Approve → next mode. Improve → text feedback feeds the refiner for one more pass.

### CHOREOGRAPH
The accepted image is auto-analyzed for elements (faces, building, crowd, objects). The user drags elements into named, color-coded **Groups** and assigns each group **Reactions** from a fixed menu:

- **Tint** — color shift on hover
- **Scatter** — cursor pushes points away
- **Pull** — cursor attracts points toward it
- **Pulse** — slow continuous breath
- **Reveal** — group dim by default, full opacity on hover
- **Parallax** — drift speed tied to scroll

Reactions are combinable, each with intensity 0–100%. The result is a **scene graph** — a JSON document linked to the generation.

### STAGE
The image is sampled into a Three.js point cloud. Per-vertex attributes encode each point's group membership and reaction intensities. The shader honors them at runtime — hover one region, only that group reacts.

The user tunes density / point-size / cutoff / colors live, then **promotes** the scene to live (today: replaces a file in `p51/assets/`; later: publishes to a public URL with embed code).

---

## 4. The MOAT — what's defensible

Four things, layered:

1. **The 6-agent chain.** Each agent has a specialized system prompt that encodes hard-won knowledge about what produces good-for-this-renderer outputs. (E.g.: the Prompt Writer uses "Op-Art" vocabulary because plain "halftone" leaves faces white.)

2. **The Aesthetic Judge with user-labeled few-shot.** Every generation the user labels becomes context for the next Judge run. No retraining, no fine-tuning — the model gets sharper as the user uses the tool. **This is the "moat that compounds."** A user who has labeled 50 generations has a personal taste signal that no competitor can replicate cold.

3. **Element-aware per-group reactions.** The combination of (a) AI-detected element bounding boxes, (b) drag-to-group editor, (c) per-vertex attribute baking is a unique pipeline. Existing tools either don't have AI detection (Unicorn) or don't tie it to per-group shader behavior (Spline).

4. **The Recipe abstraction (Phase B).** Each "creation type" is a self-contained plugin. We ship multiple Recipes; users discover and use them; eventually third parties publish their own. Network effect on the supply side.

The first three are *moats now*. The fourth is *the moat we build*.

---

## 5. The Recipe abstraction

The pivot from product → platform.

Today's lab is hardcoded for "pair point cloud." For the SaaS, **every creation type is a Recipe** — a self-contained plugin that the lab runtime executes generically.

### Recipe manifest

```js
{
  id:               "pair-point-cloud",
  title:            "Two-figure halftone point cloud",
  thumbnail:        "/recipes/pair/cover.jpg",
  author:           "@p51",
  version:          "1.0.0",
  pricing:          "free" | { tier: "pro" },

  // 1. INTAKE — what the user provides
  inputSchema: {
    refs:           "image[]   2-3 photos",
    goal:           "string    free-text"
  },

  // 2. AGENT CHAIN — pluggable, ordered
  chain:        ["architect", "prompt-writer", "generator",
                 "style-critic", "prompt-refiner", "aesthetic-judge"],
  agentPrompts: { /* per-agent system prompts, recipe-specific */ },

  // 3. SCENE STRUCTURE — what gets detected and grouped
  elementSchema: ["face", "torso", "background", "object"],
  defaultGroups: [...],

  // 4. SHADER + REACTIONS — what runs in the browser
  renderer:      "point-cloud",
  reactions:     ["tint","scatter","pull","pulse","reveal","parallax"],
  tunables:      { density: {min:1, max:6, default:2}, ... },

  // 5. EXPORT — embed code, asset bundle
  export: {
    formats:      ["embed-iframe", "npm-package", "raw-html"],
    licenseTerms: "..."
  }
}
```

### Why this matters

- A new creation type is a folder, not a fork.
- The lab UI never changes when a Recipe changes — only the Recipe does.
- Third parties write Recipes without touching our core.
- A/B testing prompts and shaders becomes versioning Recipes.
- Pricing logic lives in one place (lookup the active Recipe's `pricing` field).

### Future Recipes (validation candidates)

- **Scroll-driven topographic landscape** — image → terrain heightmap → camera flythrough on scroll
- **Audio-reactive logo cloud** — logo + audio file → point cloud that pulses to the track
- **Brand-color particle system** — brand kit JSON → particle field with brand palette
- **Vector morphing storyboard** — sketches → Rive-style interpolation
- **Editorial portrait gallery** — N photos → halftone gallery with hover bios

If we ship 3 Recipes that all feel coherent under the same UI, the abstraction is right.

---

## 6. Phased roadmap

```
PHASE A · LAB v1.5                            ★ NOW
   Single Recipe, local-only, single user.
   Goal: prove the loop produces output good enough that the user actually
   wants to use it.

PHASE B · RECIPE SDK
   Multiple Recipes, still local-only.
   Goal: prove the abstraction holds. Build a 2nd Recipe end-to-end.

PHASE C · CLOUD
   Multi-tenant hosted version. Auth, workspaces, per-user generation queue.
   Goal: get to first 100 paying users.

PHASE D · EMBED & EXPORT
   Public URLs, iframe embed, npm package generator.
   Goal: scenes leave the lab and live on real customer sites.

PHASE E · MARKETPLACE
   Third-party Recipe authoring, Stripe Connect rev share.
   Goal: supply-side scaling — more Recipes than we can write ourselves.

PHASE F · COLLAB
   Shared workspaces, comments, role-based access, brand-token injection.
   Goal: enterprise/agency tier.
```

### Phase A — Lab v1.5 (this sprint, ~1 week)

**Where we are. Two parallel tracks:**

**Track A — UX polish (small batch, ~2h)**
- Fix `[hidden] { display: none !important; }` bug
- Mode breadcrumbs with funnel direction + step indicator
- Compose: collapse advanced settings, single primary action
- Live status pill ("iter 2/3 · critic · 23s")
- Full-window drop target for ref uploads
- Empty-state RUN EXAMPLE button with seeded prompt
- Variants: chain produces N=4 candidates instead of 1, user picks

**Track B — Recipe groundwork (~3-4h)**
- Define Recipe manifest schema + TypeScript-flavored types
- Move existing pair-point-cloud bits into `server/recipes/pair-point-cloud/`
- Add `recipe_id` column to `chain_runs` and `generations`
- Build a Recipe registry the orchestrator queries
- Lab dispatches to the active Recipe (still only one for now)

**Exit criteria for Phase A:**
- 5 production-quality scenes generated and promoted to the live site without manual edits
- Aesthetic Judge accuracy ≥ 70% match to user's actual rating
- Daily-use friction is low enough the user *wants* to keep iterating

### Phase B — Recipe SDK (next 2-3 sprints)

- Build a 2nd Recipe (suggestion: "Scroll-driven landscape" — different shader, different agent chain, different element schema)
- Recipe-picker screen
- Per-Recipe asset namespacing (each Recipe's outputs go into its own folder)
- CLI command `npm run lab:new-recipe` to scaffold a Recipe
- Migrate existing local data to be Recipe-aware (or backfill `recipe_id = "pair-point-cloud"`)

**Exit criteria for Phase B:**
- Two Recipes coexist in the same lab
- Switching Recipes is one click; no data loss
- A 3rd Recipe could be authored in <1 day by following the SDK

### Phase C — Cloud (next month)

- Postgres in place of SQLite (Neon or Supabase)
- Object storage (Cloudflare R2 or AWS S3) for images
- Auth (Clerk recommended; integrates fast)
- Workspaces — each user has their own DB scope
- Background queue for chain runs (Cloudflare Queues or BullMQ on Upstash)
- Cost tracking per user (Gemini API spend)
- Free tier (10 generations/month) + Pro tier ($19/mo for unlimited)
- The local lab still works for self-hosters

**Exit criteria for Phase C:**
- 100 paying users
- Cloud generation latency p95 ≤ 90 seconds
- 0 data-loss incidents in 30 days

### Phase D — Embed & export

- Each finalized scene gets a public URL: `cloud.p51.app/s/<slug>`
- iframe embed code for Webflow/Framer/anywhere
- npm package generator (vite-built bundle, scoped to the user)
- "Open in CodePen" button for quick share
- Customer-facing dashboards: impressions, hover engagement, time-on-scene
- Free tier carries a "Made with P51" watermark; Pro removes it

**Exit criteria for Phase D:**
- 10 customers have embedded P51 scenes on their public sites
- Embed JS bundle size ≤ 80kb gzipped

### Phase E — Marketplace

- Recipe CLI: `p51 init my-recipe` scaffolds the folder
- Recipe registry (a small npm-style package store)
- Author signup, Stripe Connect for rev share
- Curation: featured Recipes, leaderboards
- Rev share: 70/30 in author's favor (industry standard for marketplaces)
- Discovery: search, categories, demo galleries

**Exit criteria for Phase E:**
- 20 third-party Recipes published
- Top-3 third-party Recipes have together generated more revenue than the bottom 50% of first-party

### Phase F — Collab (later)

- Shared workspaces, role-based access (viewer / editor / owner)
- Comments on generations, generations grouped into projects
- Brand tokens (Figma-style) injected into Recipes
- Approval workflows (designer → director sign-off)
- Audit log
- SSO for enterprise

---

## 7. Validation hypotheses

Before committing to Phase C and beyond, three product hypotheses to test on Phase A users:

### H1 · Output quality
*Does the agent chain produce scenes that beat hand-crafted alternatives?*

**Test:** A designer in Spline/Unicorn vs. our chain, both given the same prompt + 30 minutes. Compare results blind with 5 reviewers.
**Pass:** ≥3/5 reviewers prefer the P51 output.

### H2 · The taste-learning loop
*Do users actually label generations? Does the Judge improve?*

**Test:** Track week-1 usage. % of finalists that get a 👍/🤷/👎. % match between Judge prediction and user's actual final rating.
**Pass:** ≥30% of finalists labeled in week 1 AND Judge accuracy hits ≥70% by generation 30.

### H3 · Market for the output
*Is there a market for embeddable WebGL animations as a service?*

**Test:** Interview 10 designers/agencies. Are they currently paying for Spline/Unicorn or commissioning custom dev for hero animations? At what price points?
**Pass:** ≥4/10 say "I'd pay $19+/mo for unlimited custom WebGL hero animations" with willingness to commit.

If H1 is weak → double down on Recipe quality before adding Recipes.
If H2 is weak → the Judge isn't the moat we thought; reposition around speed of iteration.
If H3 is weak → reconsider the business model. Maybe sell to agencies, not designers. Or sell the agent platform to other tool-builders.

---

## 8. Current state of the lab (snapshot)

**What works:**
- Local Express server on `127.0.0.1:5173` serves both the public site (`/p51/synthesis`) and the lab (`/p51/lab.html`)
- SQLite DB with 11 tables (generations, agent_runs, judgments, snapshots, approvals, scene_graphs, element_detections, improvement_feedback, chain_runs, kv, tags)
- 6-agent chain with SSE streaming
- Approve overlay, Improve loop with refine-once
- Element auto-detection via Gemini vision
- CHOREOGRAPH editor with bounding-box overlay, groups, 6 reactions
- STAGE mode with multi-group point cloud (per-vertex attributes for group membership and reaction intensities)
- Snapshot/promote/restore for live asset swapping
- Reference upload (drag-drop or file picker)
- Brand-aligned UI matching `p51/tokens.css`

**Known issues:**
- `[hidden] { display: none !important; }` bug — choreograph columns leak into CREATE mode
- No "Run Example" empty state
- Compose layout could use clearer hierarchy
- History cards are dense but not toggleable

**What's stubbed but not yet polished:**
- Status pill — descriptive run state ("iter 2/3 · critic")
- Mode breadcrumbs — currently equal-weight tabs
- Variants — chain runs once, not N candidates

---

## 9. Immediate next sprint

This week's plan, in order:

### Day 1 — Ship Track A (UX small batch, ~2h)
1. `[hidden] { display: none !important; }` to lab.css
2. Mode breadcrumbs with funnel arrows + subtitles
3. Compose panel: primary RUN CHAIN, advanced settings collapsed
4. Live status pill driven by SSE state
5. Full-window drop target for ref uploads
6. Empty-state RUN EXAMPLE button with seeded prompt

### Day 2-3 — Ship Track B (Recipe extraction, ~4h)
1. Define `RecipeManifest` schema in `server/recipes/_types.mjs`
2. Move pair-point-cloud assets into `server/recipes/pair-point-cloud/`:
   - `manifest.json`
   - `agents/architect.mjs`, `prompt-writer.mjs`, etc. (move from `server/agents/`)
   - `renderer.mjs` (move from `p51/lab/pointcloud-multigroup.mjs`)
   - `presets.json`
3. Add `recipe_id` to relevant DB tables (migration)
4. Recipe registry at `server/recipes/index.mjs`
5. Orchestrator dispatches to active Recipe's chain
6. Lab UI shows Recipe name in the strip (just one for now)

### Day 4-5 — Variants (chain produces N candidates)
1. Add `runVariants` config to chain endpoint (default N=4)
2. Run generator N times in parallel within each iteration
3. Critic scores each, refiner sees the best, judge picks
4. Approve overlay shows all N as a comparison grid
5. User picks winner OR types feedback for the whole batch

### Day 6-7 — Validation prep
1. Generate 10 different scenes end-to-end, label them
2. Measure Judge accuracy on a held-out test set
3. Document any sharp edges that should be smoothed before showing to anyone external

**Exit:** the lab is good enough that you'd show it to a designer friend without apologizing.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Lab** | The local control surface (`/p51/lab.html`). The runtime that executes Recipes. |
| **Recipe** | A self-contained plugin defining one creation type. Manifest + agents + renderer + presets. |
| **Chain** | The sequenced agent pipeline a Recipe runs. Today: 6 agents. |
| **Generation** | One image produced by the chain. Persisted to `.lab/generations/`, indexed in DB. |
| **Element** | An auto-detected (or manually-added) bounding box on a generation. Has a label and confidence. |
| **Group** | A user-defined set of elements with a color and a list of reactions. The choreograph unit. |
| **Reaction** | A behavioral primitive (tint / scatter / pull / pulse / reveal / parallax). Group-scoped, intensity 0–100. |
| **Scene Graph** | The persisted JSON document combining elements + groups + reactions for one generation. |
| **Tunable** | A live-adjustable shader parameter (density, point size, cutoff, palette). Persisted in `kv` table. |
| **Approval** | A snapshot-then-swap operation that promotes a generation into a live asset slot. |
| **Snapshot** | A timestamped frozen copy of a live asset. Used for one-click rollback. |
| **Judge** | The 6th agent. Predicts good/bad/meh on a generation using the user's prior labels as few-shot. |
| **Promote** | Move a generation from the lab into the public site's assets. Always snapshots first. |

---

## 11. Open questions (parking lot)

Things to revisit later, not blocking:

- **Do we own the model layer?** Today: thin wrapper over Gemini. If Gemini prices change or quality regresses, switch to Imagen 4 or DALL-E 3 via the provider abstraction. The agent prompts are model-agnostic enough.
- **What's the smallest possible Recipe?** Could a Recipe be just a system prompt + a CSS-vars-only renderer, no shader? That would let non-coders author Recipes.
- **Embeddability vs. ownership.** If we host the rendered scenes, we own the runtime. If we npm-package them, the customer owns it. Different business models. Probably ship both.
- **Open-source the runtime?** Could be a moat (community Recipes, GitHub stars) or could be a foot-gun (forks). Decide before Phase E.
- **Privacy of generations.** Today everything is local. Cloud means user images + generations live on our servers. GDPR/CCPA implications. Probably need a "delete my data" flow before Phase C ships.
- **Cost model.** Gemini API at scale is non-trivial. Need to track per-user spend and gate it. Free tier should consume ≤$0.50/user/month at our cost.

---

## 12. North Star

> Six months from now, a designer who has never written GLSL should be able to produce a hero animation that beats anything on Awwwards — in 5 minutes — using a Recipe written by someone they've never met.

If we get there, we win.

---

**Last touched:** 2026-05-01 by Claude + Ofir.
**Next review:** after Phase A exit criteria are met.
