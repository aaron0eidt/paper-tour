# Ink motion preview

`motion.gif` is an eight-second recording of the actual WebGL canvas in its
speaking state, with preview word callbacks. It is a review artifact, not an
animation asset loaded by the application. The live ink keeps evolving without
restarting a video or GIF loop.

The source capture contains 480 frames at approximately 60 fps. The GIF is reduced
to 24 fps for review. The production renderer follows display cadence and pauses
when hidden or offscreen; reduced motion draws a still.

The floating question composer and bottom player keep their existing positions.
The orb shows a playback button only when the bottom player is absent.
