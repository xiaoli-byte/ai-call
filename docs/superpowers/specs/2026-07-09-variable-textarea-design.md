# Variable Textarea Design

## Goal

Upgrade dialog-node text inputs so script authors can insert global variables by typing `${` and choosing from a dropdown. Inserted variables are shown as highlighted display-name tokens, saved as `${key}`, and must render correctly at runtime.

## Scope

- Apply to dialog-node text fields: fixed script text, question prompt, AI system prompt, and AI prompt.
- Variable candidates come only from global config `globalVariables`.
- Save inserted placeholders as `${key}`.
- Keep existing unknown placeholders editable and preserve them during rendering.
- Preserve backwards compatibility for existing `{key}` and `{{key}}` templates.

## Interaction

`VariableTextArea` wraps the existing textarea styling with a lightweight `contenteditable` editor and adds variable suggestions. When the user types `${`, the component opens a dropdown near the editor. The query is the text after `${` up to the caret. Candidates are filtered by variable `key` and `label`.

After a variable is selected, the editor displays a highlighted token using the variable `label` / display name. The serialized node value remains `${key}` so runtime rendering and persisted flow data continue to use the stable variable identifier. Existing `${key}` text is rendered as a display-name token when the key exists in global variables; unknown placeholders stay as plain text.

Keyboard support:

- Arrow down/up changes the highlighted candidate.
- Enter or Tab inserts the highlighted candidate.
- Escape closes the dropdown.

Mouse support:

- Clicking a candidate inserts `${key}`.

If no candidate matches, the dropdown shows an empty state. Users can still type any placeholder manually; the editor does not block unresolved variable names.

## Data Flow

`DialogForm` reads `globalVariables` through `useGlobalConfig()` and passes them to `VariableTextArea`. The component remains controlled through `value` and `onChange`, so existing node update behavior is unchanged.

## Runtime Rendering

`fillTemplate` and the Python voice-agent flow executor both support `${key}`. They also continue to support `{key}` and `{{key}}` so historical flows and seeded templates keep working. Missing variables remain unchanged in the original placeholder format.

## Verification

- Type-check `@ai-call/shared`.
- Type-check `@ai-call/dashboard`.
- Run focused dashboard unit tests for global-variable display.
- Run the voice-agent test suite if the local Python environment is available.
