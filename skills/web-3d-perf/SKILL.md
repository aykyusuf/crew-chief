---
name: web-3d-perf
description: Frame-budget rules for 3D and heavy canvas work on the web (React Three Fiber, Three.js, WebGL): pixel-ratio cap, pause when offscreen or hidden, instancing, disposal, lazy loading, reduced-motion fallback, and how to measure. Use when building or reviewing a 3D scene, a shader background or a canvas animation, and always under the immersive UI profile.
---

# Web 3D performance

Written for crew-chief in its own words. The goal is a scene that holds its frame rate on a mid-range laptop and a phone, costs nothing while nobody sees it, and still works for people who ask for less motion. Every rule below is checkable: when you finish, go through the list and name the ones you could not meet.

## 0. Real 3D only

Under the immersive profile the hero or main scene must be real 3D: Three.js/WebGL, with react-three-fiber when the project is React. A CSS or SVG imitation (layered gradients, rotated divs, a looped video of a scene) is not acceptable. If you cannot build real 3D (a stated constraint, no WebGL available), say so explicitly in your report with the reason, and do not substitute without saying.

## 1. Set the budget first

Before writing the scene, write down (in the profile's `perfBudget` or the PR notes):
- target frame time: 16.6 ms for 60 fps (8.3 ms for 120 Hz screens, but do not promise it);
- a draw-call ceiling (about 100 on desktop, 50 on phones is a sane start), a triangle ceiling, a texture memory ceiling;
- the weakest device you care about.

A scene with no number is a scene nobody can call too slow.

## 2. Render only what is needed

- **Cap the pixel ratio.** `dpr={[1, 2]}` in R3F, or `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`. Rendering at 3x on a phone costs 2.25 times the pixels of 2x and nobody sees the difference. Drop to 1.25 or lower if frames are late (R3F's `PerformanceMonitor` can step it down and up).
- **Render on demand** when the scene is mostly still: `frameloop="demand"` and call `invalidate()` after a change. A constantly running loop for a static product shot burns a battery for nothing.
- **Pause when it cannot be seen.** Stop the loop when the canvas is offscreen (`IntersectionObserver`) and when the tab is hidden (`document.visibilityState`, or `frameloop="never"` while hidden). Resume cleanly, without a time jump: use the clock delta, clamp it (about 0.05 s), and never advance animation by wall-clock time.
- **Do per-frame work in the frame callback**, not in React state. Never call `setState` inside `useFrame`; write to refs, uniforms, or instance matrices. One state update per frame re-renders the tree and ruins the budget.
- Do not allocate in the loop: no `new Vector3()`, `clone()`, array or object literals inside `useFrame`. Create the scratch objects once outside and reuse them.

## 3. Cut the work the GPU does

- **Instance repeats.** The same mesh more than a few times is one `InstancedMesh` (or drei `Instances`), updated through the instance matrix, not hundreds of meshes. Merge static geometry that never moves on its own (`BufferGeometryUtils.mergeGeometries`).
- **Share geometry and materials.** One geometry and one material object per kind, not one per mesh. Different material objects mean extra draw calls and extra shader programs.
- **Keep shadows, transmission, and post-processing deliberate.** Each is a full extra pass. Bake static shadows and lighting into textures where you can; use one or two real lights; limit the shadow map size; add post effects one at a time and measure each.
- **Textures:** use compressed GPU formats (KTX2/Basis) for anything large, power-of-two sizes, no larger than it will appear (a 4096 map on a 300 px object is waste), mipmaps on. Prefer a texture atlas over many small ones.
- **Models:** compress meshes (Draco or Meshopt), strip unused attributes, decimate what is far away, and use level of detail where the camera range is wide.
- **Shaders:** keep fragment shaders short; avoid branching on varying values and loops with a runtime bound; do not recompute in the fragment what the vertex stage can give you.

## 4. Free what you stop using

Three.js does not free GPU memory when a JavaScript reference disappears.
- When a scene, route or object goes away, call `dispose()` on its geometries, materials, textures and render targets (drei and R3F dispose automatically for objects they mount; anything you create by hand with `new` is yours).
- Check the result: `renderer.info.memory` (geometries, textures) and `renderer.info.render` (calls, triangles) must return to their earlier numbers after leaving and re-entering a screen. A count that only grows is a leak.
- One WebGL context per page where possible; browsers drop old contexts when many exist.

## 5. Load it late

- The 3D bundle is heavy: load it with a dynamic import (`next/dynamic` with `ssr: false`, or `React.lazy`) only where the scene appears, not in the main bundle.
- Show a lightweight placeholder (a poster image of the same size, so the layout does not jump) until the scene is ready; load models and textures after the first paint, with a progress state.
- Do not mount the canvas until it is near the viewport.

## 6. Respect reduced motion and weak hardware

- `prefers-reduced-motion: reduce` must change the result: show a still frame (or render once with `frameloop="demand"`), stop camera drift, parallax and autoplay, keep only motion the user starts.
- Provide a fallback when WebGL is missing or the context is lost: a static image, not a blank box. Listen for `webglcontextlost` and `webglcontextrestored`.
- Keep the page usable without the scene: text, links and controls live in the DOM, not inside the canvas; give the canvas an accessible name or mark it decorative.

## 7. Measure, do not guess

1. Open the browser's Performance panel, record 5 to 10 seconds of the real interaction, and look at the frame bars and the main-thread and GPU rows. Frames over the budget are the work list.
2. Use Stats (`stats.js`, or drei `Stats`) for a live frame time, and `renderer.info` for draw calls, triangles and memory.
3. Test with CPU throttling (4x) and a phone, not only the development machine; throttle the GPU by a smaller window and a larger pixel ratio.
4. Change one thing at a time and re-measure. Keep the number you saw in the report ("120 draw calls to 18 after instancing; 9.8 ms per frame").

## Checklist before you report done

- [ ] A written budget exists (frame time, draw calls, memory, weakest device).
- [ ] Pixel ratio is capped; on-demand rendering is used when the scene is mostly still.
- [ ] The loop stops offscreen and in a hidden tab, and resumes without a time jump.
- [ ] No `setState` and no allocation inside the frame callback.
- [ ] Repeats are instanced; geometry and materials are shared.
- [ ] Created resources are disposed; `renderer.info.memory` returns to baseline after a route change.
- [ ] The scene loads lazily with a same-size placeholder.
- [ ] `prefers-reduced-motion` gives a still or minimal result; there is a no-WebGL fallback; the page works without the canvas.
- [ ] A measurement from the performance panel or `renderer.info` is quoted in the report; if none was taken, the report says `not verified`.
