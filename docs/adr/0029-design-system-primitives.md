# 0029. The design system's primitives: native elements, and Base UI where they fall short

- Status: Accepted
- Date: 2026-11-21
- Decided by: the design-system task (issue #8), under records [0004](0004-quality-bar.md), [0007](0007-next-native-module-layout.md) and [0027](0027-supply-chain-guard.md)

## Context

About thirty screen tasks, built in parallel, assemble their screens from one design system, `src/lib/ui`, so that the app looks and behaves as one. The specs make it phone-first and accessible: one column with no sideways scroll (IHM-01), text that follows the phone's size (IHM-60), WCAG 2.2 AA contrast and touch targets (IHM-61, CL-IHM-08), explicit labels (IHM-62), long texts that wrap, portrait and landscape, and the phone's light or dark theme (IHM-63). The app runs Next.js 16 with React Server Components, Cache Components and typed routes, and every line passes a strict lint (record 0004).

The brief asked for an unstyled, accessible component library styled with Tailwind, chosen by these criteria, in this order: accessibility on keyboard, screen reader and touch; compatibility with React Server Components and the current Next.js; bundle size on a phone; maintenance activity; passing this repository's lint rules without blanket opt-outs. Three candidates were weighed.

| Criterion                         | React Aria Components                                                                          | Base UI                                                                            | shadcn/ui (Radix)                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Keyboard, screen reader and touch | The most thorough: its own press and focus handling, tested across screen readers              | The WAI-ARIA patterns, with focus trapping, focus return and inert outside content | Radix's patterns, as good for dialogs and tabs                                   |
| Server Components, Next.js 16     | Client components, marked as such                                                              | Client components, marked as such; one entry per component                         | Client components; the code is copied into the repository                        |
| Weight on a phone                 | The heaviest: every component brings shared state, interaction and internationalization layers | Light: each component is imported from its own path, over a small shared core      | Light primitives, plus the helpers that shadcn/ui adds (class merging, variants) |
| Maintenance                       | Active                                                                                         | Active: version 1 since December 2025, nine minor releases since                   | Radix active; shadcn/ui updates arrive by copying code again, by hand            |
| This repository's lint rules      | Library code, outside the lint                                                                 | Library code, outside the lint                                                     | Copied code that would have to pass every rule, component by component           |

Each candidate also wraps elements that the platform already makes accessible, often better on a phone: a native `<select>` opens the phone's own picker, a native checkbox or radio button needs no script to work, and a form of native controls submits before the page's code has loaded.

## Decision

- **Native HTML elements, styled with Tailwind, wherever the platform gives the accessible behavior:** buttons and links, text and password inputs, text areas, the select, checkboxes and radio buttons, the switch (a checkbox with the `switch` role), the file picker, tables and definition lists.
- **Base UI, `@base-ui/react`, for the patterns that the platform lacks or gets unevenly:** the modal dialog and the alert dialog (focus moved in and trapped, the page behind inert, Escape, focus returned to the opener) and the tabs (arrow keys between tabs, one tab stop). Each part is imported from its own path, such as `@base-ui/react/dialog`, and only inside `src/lib/ui`. Later parts that need it, such as the one-tap definition of `ui/figures` or the More menu, take their popover or menu from the same library.
- **Design tokens in the Tailwind theme**, in `src/app/globals.css`: Tailwind's own palette is removed, and the screens use the semantic colors only (`canvas`, `surface`, `ink`, `accent`, `danger`, the tones of notices), whose light and dark values meet WCAG 2.2 AA and follow the phone's setting; Tailwind's type scale in rem, which iOS sizes by its own text setting; a `touch` size of 2.75rem for targets; one focus ring.
- **Texts and formats stay outside:** every visible text of a component is a prop, which the screen takes from `@/lib/wording`, and no component writes a date or a number.

## Consequences

- The components of `src/lib/ui` are the only form controls, dialogs and notices that screens use; CLAUDE.md, "Design system", says how to use and extend them.
- The `Form` component sends its own data to its action, so React does not reset its fields: a refused save keeps the owner's input visible, as CL-IHM-18 asks, and its submit buttons know that the action runs. Its fields are validated by the server, whose messages are the app's own words: the browser's validation is off.
- Component tests run in jsdom with Testing Library, user-event and axe, which cannot measure contrast there; the end-to-end check of `/dev/ui` measures it in Chromium, in both themes, on a desktop and a phone.
- Base UI joins the dependencies at an exact version, under the seven-day rule of record 0027.

## What would change it

- Base UI stops being maintained, or a screen-reader defect in it goes unfixed: React Aria Components replaces it, behind the same components of `src/lib/ui`.
- The platform covers a pattern well on phones, such as a native dialog that every target browser closes on a tap outside: the native element replaces the Base UI part.
