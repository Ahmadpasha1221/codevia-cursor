# UX Design

## Visual identity

* Primary accent: violet/purple `#7C3AED`.
* Background: neutral warm white in light mode, deep neutral charcoal in dark mode.
* Surfaces: slightly contrasting neutral tones.
* Text: dark neutral in light mode, light neutral in dark mode.
* Semantic status colors are used only for error, warning, and success.

## Main layout

```
┌──────────────────────────────────┐
│ Agent                       • Ready│
├──────────────────────────────────┤
│                                  │
│ Session History                  │
│                                  │
│ > Fix authentication bug         │
│   Add employee validation        │
│   Refactor API client            │
│                                  │
├──────────────────────────────────┤
│                                  │
│ Agent Activity                   │
│                                  │
│ ✓ Analyzed repository            │
│ ✓ Read auth/service.ts           │
│ ✓ Found failing test             │
│ ⟳ Editing authentication logic   │
│                                  │
├──────────────────────────────────┤
│                                  │
│ Ask the agent...                 │
│                                  │
│                                  │
│                         [ Send ] │
└──────────────────────────────────┘
```

## Interaction principles

1. Current task is prioritized.
2. Agent progress streams into activity.
3. User input is always visible.
4. Permissions appear before dangerous operations.
5. Configuration is secondary and reachable from settings.

## Composer

The composer supports multiline prompts, Enter to send, Shift+Enter for newline, and indicators for the current file and selection.

## Diff experience

File changes are shown with filename, additions, deletions, and options to open or review changes. Git actions remain explicit.
