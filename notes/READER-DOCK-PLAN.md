# Unified reader controls

Status: proposed layout, reviewed with Astra; not implemented.

Use one attached footer shared by Guided tour, Read aloud and document answers.
The PDF and visual board end above it. Replace the separate floating question
bar, playback capsule and distant agent with one coherent interaction area.
Preserve the existing themes, SVG icons, sphere, word synchronization and engines.

## Layout

The seek timeline runs across the footer's top edge. Below it, show a transcript
row only when the user selected Bottom player or Both. The control row groups
the reading-mode selector, transport, elapsed time and Audio on the left; the
question field fills the remaining space, with the sphere directly beside it.

The sphere's speech bubble opens above that same anchor. Actual work messages
and activity history remain available in every transcript setting. No empty
caption track or additional playback controller is created.

Use the existing panel/background/text/accent tokens. Resting controls should
occupy roughly 80 px; the optional two-line transcript adds about 50 px. Keep the
question input around 44 px high and sphere around 56 px on a wide reader.

## Reading modes and transcript settings

| Mode | Bottom player | Agent bubble | Both |
| --- | --- | --- | --- |
| Guided tour | Tour narration below the paper | Current tour sentence above the sphere | Both surfaces |
| Read aloud | Source-faithful narration below the paper | Current reading sentence above the sphere | Both surfaces |
| Answer | Answer narration below the paper | Current answer sentence above the sphere | Both surfaces |

Both reading modes retain annotations, visuals and playback. Read aloud retains
cleaned source text, explanations of non-prose objects, caching and preparation
ahead. Questions temporarily use the same player. Returning restores the source
mode, checkpoint and camera through the existing answer-return handling.

Make the current mode explicit in a Guided tour / Read aloud selector in the
playback group. During an answer, also identify which reading mode is paused.
The Document/Tour sidebar tabs remain navigation.

## Responsive behavior and disclosures

- Below about 980 px of reader width, use two attached rows: playback above,
  question field and sphere below. Below about 560 px, use compact controls and
  group secondary question options rather than squeezing the input.
- Audio contains voice, speed, mute and keyboard help. Keep immediate access to
  region selection and microphone/send; group language and conversation history
  in a labeled options disclosure where space is tight.
- The question tray opens upward from the field; activity opens upward from the
  sphere. Coordinate which surface is expanded without changing narration state.
  Suppress automatic speech peeks while the question tray is expanded.
- Bound expanded panels to available reader height and scroll their contents.
  Keep input and playback usable in short windows and with the mobile keyboard.
- The footer spans the complete reader when the visual board opens. Moving the
  board must not reposition the composer or sphere or obscure the plot.

## Implementation sequence

1. Keep one ControlBar/Timeline implementation and add slots for reading mode,
   composer and companion. Support the shared shell without a playable tour.
2. Move the existing AskPanel and AgentActivity instances out of BoardSplit into
   that shell, keeping them mounted across modes and transcript preferences.
   Keep CoachCard with the stage. Permit manual questions in Read aloud too.
3. Add an explicit footer presentation for AskPanel and docked placement for the
   companion. Preserve their request, streaming, selection, voice and history
   logic. Coordinate expanded surfaces with UI state only.
4. Replace superseded floating-position styles instead of stacking overrides.
   Remove unused BoardSplit activity reservations and collision helpers only
   after confirming they have no remaining consumers.

## Acceptance

Verify both reading modes and answers with all three transcript settings in
dark/light themes. Check a wide reader, a sidebar-reduced reader, a 390 px phone
and a short window. Verify board transitions, long questions, selected regions,
audio/help popups, activity history and preparation failures. Ask during both
modes, play/pause/seek the answer and return to the prior position. Check Space,
arrow seeking, slash focus, Escape and text-entry keyboard isolation. Screenshots
must show one attached interaction area with no resting controls over the PDF.
