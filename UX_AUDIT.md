# Duelette UX Audit

**Date:** 2026-11-14
**Scope:** live site https://forteveriti.tail8331b7.ts.net/duelette/, audited in Chrome (start screen, wheel, one trivia round).
**Not covered:** the mobile layout (not rendered; the CSS has a 700px breakpoint), the Draw, Code and Chaos challenges, the ranking tab contents, and multiplayer (no strangers were paired).
**Mode:** report only, based on the rendered page and its DOM, not on the source code.

## Summary

| Severity | Count |
|---|---|
| 4 Catastrophe | 0 |
| 3 Major | 1 |
| 2 Minor | 6 |
| 1 Cosmetic | 3 |
| **Total** | **10** |

Severity scale: 4 means users cannot complete tasks, 1 is cosmetic only.

## Quick wins

1. Make trivia answers show right or wrong before advancing (severity 3).
2. Label every number on the game screen (severity 2).
3. Add share-preview tags so shared links look good (severity 2).

## Findings

### [3] Trivia gives no readable answer feedback
- **Principle:** visibility of system status.
- **What was seen:** `2` was pressed on the first question, "Trading goods directly without money is called" (Barter). One second later the screen showed a different question, and the round ended with "0/3 right".
- **Impact:** players cannot tell whether an answer registered or was correct. They cannot learn from mistakes, and a missed keypress looks like a wrong answer.
- **Fix:** hold the screen for about 600 to 800 ms, highlight the chosen option green or red, and show the correct one.
- **Caveat:** the screen was sampled only about once a second, so confirm this against the source before acting on it.

### [2] No visible way to leave a run
- **Principle:** user control and freedom.
- **What was seen:** during a run the logo click did nothing and "World ranking" looked dimmed. No quit or restart control was found.
- **Impact:** a player who wants out has to reload and lose the run.
- **Fix:** add a "Quit run" button, with a confirmation only when points are at stake.

### [2] Unlabelled numbers and jargon
- **Principle:** match with the real world, and recognition over recall.
- **What was seen:** a bare number (85, 45, 95) sits next to the question timer bar. The red and blue score pills have no labels, and "X4 POT" is never explained.
- **Impact:** new players cannot tell whether the number is seconds or points.
- **Fix:** add units ("85 pts" or "8s") and short tooltips, and spell out "Score x4".

### [2] The sound toggle is ambiguous
- **Principle:** consistency and visibility of status.
- **What was seen:** the button reads "SOUND ON" but reports `aria-pressed="false"`. It is unclear whether the label shows the state or the action.
- **Impact:** screen-reader users hear a contradiction, and sighted users guess.
- **Fix:** use "Sound: On" or "Sound: Off" with `aria-pressed` matching, or an icon with a clear label.

### [2] Confetti and particles cover the question text
- **Principle:** perceptibility.
- **What was seen:** stars and confetti drift across the question while the clock is running.
- **Impact:** the first seconds of every jackpot question are harder to read.
- **Fix:** stop or fade the particles when the challenge card opens.

### [2] Small tap targets and tiny hint text
- **Principle:** affordances and accessibility.
- **What was seen:** the header buttons are about 35 px tall. The keyboard hint line at the bottom of the start screen is very small.
- **Impact:** thumbs miss them on phones.
- **Fix:** make the header buttons at least 44 px, and make the hint line legible.

### [2] Weak structure and no share preview
- **Principle:** structure and accessibility.
- **What was seen:** there is no `<main>`, the screens are unlabelled regions with no subheadings, and there are no Open Graph tags.
- **Impact:** screen-reader landmark navigation is poor, and a game spread by link shows a bare preview when shared.
- **Fix:** wrap the content in `<main>`, give each screen a heading and `aria-label`, and add `og:title`, `og:description` and `og:image`.

### [1] The small helper text may be low contrast
The green "This name is yours on this device" line and the purple-grey card descriptions look light on the cream background. Check them with a contrast checker and aim for 4.5:1.

### [1] "World ranking" is dimmed during a run with no reason given
A short tooltip fixes it.

### [1] The challenge card floats mid-screen with large empty areas on wide displays
Cosmetic, not urgent.

## Strengths

- **Strong identity and hierarchy:** the big logo, two distinct start buttons ("Solo run" and "Find a match") and a clear visual order.
- **Good microcopy and tone:** "OUCH.", the badge toast, and "NEXT SPIN" as the one dominant button on the result card.
- **Flexibility:** keyboard shortcuts for spinning (Space), answering (1 to 4) and running code (Ctrl+Enter).
- **Accessibility basics:** labelled name input, `aria-pressed` on the critter buttons, a 4 px focus outline, `prefers-reduced-motion` respected, and tab semantics on the ranking screen.
