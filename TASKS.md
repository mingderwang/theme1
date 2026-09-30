# AGENTS.md

## Project

This project builds a **procedural 3D landscape and generative environment**.

The goal is to generate explorable virtual environments algorithmically rather than relying primarily on hand-authored scenes.

Core concepts:

* Procedural terrain
* Procedural vegetation
* Procedural trees
* Procedural rocks and natural objects
* Procedural materials and textures
* Procedural lighting and atmosphere
* Theme-driven world generation
* Realistic-looking natural environments
* Optional artistic rendering styles, including monochrome

The project should favor deterministic, reproducible generation from a seed.

---

## Terminology

Use these terms consistently:

* **Procedural generation** — generation from algorithms and rules.
* **Procedural graphics** — algorithmically generated visual content.
* **Procedural 3D** — procedural generation of 3D geometry and scenes.
* **Procedural landscape generation** — generation of terrain and natural landscapes.
* **Procedural environment generation** — generation of complete environments.
* **Procedural modeling** — algorithmic generation of geometry.
* **Procedural vegetation** — algorithmic generation and placement of plants.
* **Procedural tree generation** — algorithmic generation of tree structures.
* **Procedural materials** — algorithmically generated surface appearance.
* **Procedural texturing** — algorithmically generated textures.
* **Generative art** — artistic work produced partly or entirely by algorithms.

Do not use "procedural" simply to mean "random".

A procedural system should be controlled by explicit rules and parameters. Randomness may be used, but it should normally be seedable.

---

## Core Architecture

The conceptual architecture is:

```
Theme
  |
  v
World Generator
  |
  +-- Terrain Generator
  |
  +-- Vegetation Generator
  |
  +-- Tree Generator
  |
  +-- Rock/Object Generator
  |
  +-- Material Generator
  |
  +-- Atmosphere / Lighting
  |
  v
Rendered Environment
  |
  v
Interactive Exploration
```

Keep these systems modular.

Do not put terrain generation, tree generation, rendering, and theme logic into one large module.

---

## Design Principles

### 1. Determinism

The same seed and configuration should produce the same world whenever practical.

Example:

```
seed + theme + world parameters
              |
              v
         deterministic
         world output
```

Avoid using uncontrolled global randomness.

Prefer a seeded random-number generator.

---

### 2. Separate Generation from Rendering

World generation should describe the world.

Rendering should display the world.

For example:

```
WorldGenerator
    -> Terrain
    -> Trees
    -> Rocks
    -> Water

Renderer
    -> Geometry
    -> Materials
    -> Lighting
    -> Camera
```

Do not make procedural algorithms depend unnecessarily on rendering implementation details.

---

### 3. Theme Is Data

Themes should be represented as configuration rather than hard-coded visual behavior.

Example:

```ts
interface WorldTheme {
  name: string
  terrain: TerrainTheme
  vegetation: VegetationTheme
  materials: MaterialTheme
  atmosphere: AtmosphereTheme
  lighting: LightingTheme
  rendering: RenderingTheme
}
```

A theme may control:

* terrain scale
* mountain frequency
* erosion strength
* vegetation density
* tree species
* tree size
* rock density
* moisture
* elevation limits
* fog
* lighting
* color palette
* rendering style

---

## Terrain

Start with procedural height fields.

Possible techniques:

* Perlin noise
* Simplex noise
* fractal Brownian motion (fBm)
* domain warping
* erosion simulation
* ridged noise
* biome masks

Avoid adding complex erosion simulation until the basic terrain pipeline is stable.

Terrain should expose useful information to other generators:

```ts
interface TerrainSample {
  height: number
  slope: number
  normal: Vector3
  moisture: number
  temperature: number
}
```

Vegetation placement should use terrain

