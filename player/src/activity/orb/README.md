# Fluid ink renderer

This renderer and its GLSL are local PaperTour code. The design and architecture references inspected for this implementation are:

- [weeeha/AI-Orb, Ink material and style guide](https://github.com/weeeha/AI-Orb/tree/22ce1d007dcb20a541be2d71b7122d788b2f2c3a): a pigmented medium, subtle grain, rigid circular boundary, and motion inside the field. No shader source from this project is included.
- [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation/tree/a2d292931f19d9b3b9f564e23e6c32729d2121c3): GPU advection and alternating framebuffer architecture. No source from this project is included.
- [GPU Gems, Chapter 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu): semi-Lagrangian transport of a previous-frame dye field.

The local implementation uses two 128×128 floating-point pigment buffers, midpoint backtracing, bilinear sampling, and an evolving analytic divergence-free velocity field. It transports and mixes real previous-frame pigment. It is a decorative advection model, not a full Navier–Stokes pressure/velocity solver. There is no geometry shading, shell, bloom, angular-sector material, globally rotating layer, or animation reset.

Idle simulation speed is 0.04; work eases toward 0.14 and speaking toward 0.30. Narration word callbacks add finite visual modulation up to 0.05, not measured audio amplitude. RequestAnimationFrame follows the display cadence (60Hz on a standard desktop display). Idle continues very slowly; reduced motion draws a still. Hidden/offscreen instances suspend and release all resources on disposal. Without floating-point framebuffer support, the GPU-rendered initial ink field stays static; without WebGL2, the CSS fallback is static.

The noise texture is generated locally by `noise.ts`. No external image, credentials, runtime requests, or additional package is needed.
