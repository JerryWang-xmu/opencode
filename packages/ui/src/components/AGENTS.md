# packages/ui/src/components/

Shared SolidJS component library consumed by `packages/app` and `packages/desktop` via `@opencode-ai/ui/<name>`.

## File Organization

Flat directory, kebab-case. Each component is a trio of files:

| File | Purpose |
|------|---------|
| `name.tsx` | Component implementation |
| `name.css` | Styles (data-attribute selectors, not classes) |
| `name.stories.tsx` | Storybook story (CSF3 format) |

Pure logic helpers live in `.ts` files alongside their components (e.g. `markdown-stream.ts`, `message-part-text.ts`). Tests are `.test.ts` next to the file they test. No barrel `index.ts`. Consumers import individual components.

Subdirectories exist only for icon sprite collections: `app-icons/`, `file-icons/`, `provider-icons/`. Each has a generated `types.ts` listing available icon names.

## Import Pattern

Package exports map `@opencode-ai/ui/<name>` directly to `./src/components/<name>.tsx`:

```ts
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
```

## Component Conventions

- **Kobalte wrappers**: Most interactive components wrap `@kobalte/core` primitives. Import as `Kobalte`, extend `ComponentProps<typeof Kobalte>`, and add custom props on top.
- **`splitProps`**: Always split custom props from native/Kobalte props. Pass the rest through with `{...rest}`.
- **Data attributes for styling**: Components set `data-component="name"` on the root element and `data-slot="name-part"` on internal elements. CSS targets these selectors, not class names.
- **Variant/size via data attributes**: `data-variant`, `data-size`, etc. drive CSS branching.
- **Theme tokens**: CSS uses `var(--token-name)` custom properties from `../theme/`. Never hardcode colors.

```tsx
// Typical structure
export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList"])
  return (
    <Kobalte {...rest} data-component="button" data-size={split.size || "normal"}>
      {props.children}
    </Kobalte>
  )
}
```

## Icon System

`icon.tsx` defines all UI icons as inline SVG path strings in a `const icons` object. At runtime, a hidden SVG sprite sheet is injected into `document.body` via `ensureSprite()`. Icon names are typed as `keyof typeof icons`. To add an icon, add an entry to the `icons` object.

Provider/file/app icons use separate sprite systems in their respective subdirectories with `vite-plugin-icons-spritesheet`.

## Storybook

All `.stories.tsx` files start with `// @ts-nocheck` (known debt, 55 files). Stories use CSF3 format:

```tsx
// @ts-nocheck
import { Button } from "./button"

const docs = `### Overview\n...\n`

export default {
  title: "UI/Button",       // Always "UI/<ComponentName>"
  id: "components-button",  // Always "components-<kebab-name>"
  component: Button,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
}

export const Primary = { args: { variant: "primary" } }
```

Each story includes a `docs` markdown string covering: Overview, API, Variants, Behavior, Accessibility, Theming.

## Context Dependencies

Components may use `useI18n()` (localized strings), `useDialog()` (programmatic dialogs), or `useMarked()` (markdown config) from `../context/`.
