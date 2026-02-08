# Docker YAML Editor

A self-contained, browser-based YAML editor built specifically for Docker Compose and Docker Stack files. Provides real-time validation, context-aware autocomplete, syntax highlighting, and inline documentation — all with zero external dependencies.

## Features

- **Real-time YAML validation** against the Docker Compose v3.x specification
- **Context-aware autocomplete** for keys and values based on cursor position
- **Syntax highlighting** with distinct colors for keys, strings, numbers, booleans, comments, etc.
- **Inline documentation** via tooltips showing descriptions, types, and valid values
- **Light and dark themes** with automatic OS-level detection
- **Line numbers** with error indicators on problematic lines
- **Resizable editor** area
- **Zero dependencies** — a single JS file and a single CSS file

## Quick Start

Include the CSS and JS files in your HTML page:

```html
<link rel="stylesheet" href="docker-yaml-editor.css">
<script src="docker-yaml-editor.js"></script>
```

Create a container element and initialize the editor:

```html
<div id="editor"></div>
<script>
  const editor = DockerYamlEditor.init('#editor', {
    theme: 'auto',
    initialValue: 'version: "3.8"\nservices:\n  web:\n    image: nginx:latest\n',
    tabSize: 2,
    lineNumbers: true
  });
</script>
```

Open `test-page.html` in a browser to see a full working demo with sample Docker Compose files.

## Options

| Option         | Type     | Default | Description                              |
|----------------|----------|---------|------------------------------------------|
| `theme`        | `string` | `auto`  | `'light'`, `'dark'`, or `'auto'`         |
| `initialValue` | `string` | `''`    | Initial YAML content                     |
| `tabSize`      | `number` | `2`     | Number of spaces per indentation level   |
| `lineNumbers`  | `boolean`| `true`  | Show or hide the line number gutter      |

## API

```javascript
// Get / set content
const yaml = editor.getValue();
editor.setValue(newYaml);

// Validation
const isValid = editor.isValid;    // boolean
const errors  = editor.getErrors(); // array of error objects

// Events
editor.on('change', (data) => {
  // data.value   - current YAML string
  // data.isValid - validation result
});

editor.on('validate', (data) => {
  // data.errors  - array of { line, column, message, severity }
  // data.isValid - validation result
});

// Theme
editor.setTheme('dark');

// Focus / cleanup
editor.focus();
editor.destroy();
```

### Error object

```javascript
{
  line: number,
  column: number,
  message: string,
  severity: 'error' | 'warning'
}
```

## Schema Coverage

The editor validates against the **Docker Compose v3.x** specification (v3.0–v3.9):

- **Top-level keys:** `version`, `services`, `networks`, `volumes`, `secrets`, `configs`
- **Service configuration:** 60+ keys including `image`, `build`, `ports`, `volumes`, `environment`, `deploy`, `healthcheck`, `secrets`, `configs`, and more
- **Deploy / Swarm mode:** `mode`, `replicas`, `placement`, `resources`, `restart_policy`, `update_config`, `rollback_config`
- **Networking:** `ports`, `expose`, `networks`, `dns`, `extra_hosts`, `network_mode`

## Theming

All colors are exposed as CSS custom properties on `.docker-yaml-editor`. Override them to match your own design:

```css
.docker-yaml-editor {
  --dye-bg: #1e1e1e;
  --dye-text: #d4d4d4;
  --dye-key-color: #9cdcfe;
  /* see docker-yaml-editor.css for the full list */
}
```

## File Overview

| File                      | Description                                  |
|---------------------------|----------------------------------------------|
| `docker-yaml-editor.js`  | Editor implementation (parser, schema, validator, autocomplete, UI) |
| `docker-yaml-editor.css` | Styling and theme definitions                |
| `test-page.html`         | Interactive demo with sample Compose files   |
| `valid-stack.yaml`       | Example Docker Stack file                    |

## Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge). No build step or transpilation required.

## License

MIT
