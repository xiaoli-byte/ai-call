# Dashboard Style Architecture

This app uses SCSS Modules as the default boundary for route and component styles.

## File Placement

- Route styles live next to the route entry: `app/<route>/<route>.module.scss`.
- Root route styles live in `app/page.module.scss`.
- Component styles live next to the component: `<component>.module.scss`.
- Route-private components can live under `app/<route>/_components/`.
- Shared reusable components live under `components/<domain>/`.

## Global CSS Scope

`app/globals.css` is reserved for:

- Design tokens and base element defaults.
- App shell layout shared by `client-layout`.
- Reusable primitives that are intentionally global, such as `.btn`, `.card`, `.badge`, `.form-*`, `.table-*`.
- Unavoidable third-party overrides, such as React Flow DOM classes.

Do not add page-specific or component-specific selectors to `globals.css`.

## SCSS Module Rules

- Prefer camelCase class names so they are ergonomic from TypeScript.
- Avoid styling by broad descendant selectors unless the selector is fully owned by the module.
- Avoid inline styles for repeatable UI states; move them into the page or component module.
- Keep animations local to the module that uses them.
- Use shared primitives from `globals.css` only when they are intentionally reusable across pages.

## Transitional Legacy Scope

Large legacy pages can temporarily keep their existing inner class names by wrapping them under a local CSS Module root:

```scss
.page :global(.legacy-class) {
  /* scoped legacy style */
}
```

This keeps the selector from leaking across the app while allowing a gradual JSX migration. New components should use direct module class references instead.
