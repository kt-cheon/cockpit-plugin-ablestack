---
id: Expandable section
section: components
cssPrefix: pf-c-expandable-section
---## Examples

### Hidden

```html
<div class="pf-c-expandable-section">
  <button type="button" class="pf-c-expandable-section__toggle" aria-expanded="false">
    <span class="pf-c-expandable-section__toggle-icon">
      <i class="fas fa-angle-right" aria-hidden="true"></i>
    </span>
    <span class="pf-c-expandable-section__toggle-text">Show more</span>
  </button>
  <div class="pf-c-expandable-section__content" hidden>This content is visible only when the component is expanded.</div>
</div>
```

### Expanded

```html
<div class="pf-c-expandable-section pf-m-expanded">
  <button type="button" class="pf-c-expandable-section__toggle" aria-expanded="true">
    <span class="pf-c-expandable-section__toggle-icon">
      <i class="fas fa-angle-right" aria-hidden="true"></i>
    </span>
    <span class="pf-c-expandable-section__toggle-text">Show less</span>
  </button>
  <div class="pf-c-expandable-section__content">This content is visible only when the component is expanded.</div>
</div>
```

## Documentation

### Accessibility

| Attribute               | Applied to                              | Outcome                                                                                                        |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `aria-expanded="true"`  | `.pf-c-expandable-section__toggle`      | Indicates that the expandable section content is visible. **Required**                                         |
| `aria-expanded="false"` | `.pf-c-expandable-section__toggle`      | Indicates the the expandable section content is hidden. **Required**                                           |
| `hidden`                | `.pf-c-expandable-section__content`     | Indicates that the expandable section content element is hidden. Use with `aria-expanded="false"` **Required** |
| `aria-hidden="true"`    | `.pf-c-expandable-section__toggle-icon` | Hides the icon from screen readers. **Required**                                                               |

### Usage

| Class                                   | Applied to                         | Outcome                                                  |
| --------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| `.pf-c-expandable-section`              | `<div>`                            | Initiates the expandable section component. **Required** |
| `.pf-c-expandable-section__toggle`      | `<button>`                         | Initiates the expandable section toggle. **Required**    |
| `.pf-c-expandable-section__toggle-text` | `<span>`                           | Initiates the expandable toggle text. **Required**       |
| `.pf-c-expandable-section__toggle-icon` | `<span>`                           | Initiates the expandable toggle icon. **Required**       |
| `.pf-c-expandable-section__content`     | `<div>`                            | Initiates the expandable section content. **Required**   |
| `.pf-m-expanded`                        | `.pf-c-expandable-section`         | Modifies the component for the expanded state.           |
| `.pf-m-active`                          | `.pf-c-expandable-section__toggle` | Forces display of the active state of the toggle.        |
