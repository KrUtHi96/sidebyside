# SideBySide - Classic Split Design System

## Overview

The Classic Split design system provides a clean, professional interface for document comparison. It prioritizes clarity, accessibility, and familiarity while maintaining a modern aesthetic suitable for professional document review workflows.

---

## Design Principles

1. **Clarity First** - Content and differences should be immediately scannable
2. **Familiar Patterns** - Use conventional UI patterns to minimize learning curve
3. **Professional Restraint** - Subtle colors and clean lines for document-heavy workflows
4. **Accessibility** - WCAG 2.1 AA compliant contrast ratios and interactive elements

---

## Color System

### Primary Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#667eea` | Primary actions, active states, links |
| `--color-primary-hover` | `#5a6fd6` | Primary button hover |
| `--color-primary-subtle` | `#667eea15` | Active backgrounds, highlights |

### Semantic Colors (Diff States)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-added` | `#22c55e` | Added text, additions indicator |
| `--color-added-bg` | `#dcfce7` | Added text background |
| `--color-added-text` | `#166534` | Added text color |
| `--color-removed` | `#ef4444` | Removed text, deletions indicator |
| `--color-removed-bg` | `#fee2e2` | Removed text background |
| `--color-removed-text` | `#991b1b` | Removed text color |
| `--color-changed` | `#f59e0b` | Modified/changed indicator |
| `--color-changed-bg` | `#fef3c7` | Changed highlight background |
| `--color-changed-text` | `#92400e` | Changed text color |

### Neutral Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-primary` | `#ffffff` | Main content backgrounds |
| `--color-bg-secondary` | `#f5f5f5` | Page background, subtle fills |
| `--color-bg-tertiary` | `#f3f4f6` | Code/paragraph numbers |
| `--color-border` | `#e0e0e0` | Dividers, borders |
| `--color-border-light` | `#e5e5e5` | Subtle separators |
| `--color-text-primary` | `#1a1a1a` | Headings, important text |
| `--color-text-secondary` | `#374151` | Body text |
| `--color-text-tertiary` | `#6b7280` | Labels, metadata |
| `--color-text-muted` | `#9ca3af` | Placeholders, disabled |

---

## Typography

### Font Stack

```css
--font-family-base: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 
                    'Helvetica Neue', Arial, sans-serif;
--font-family-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 
                    monospace;
```

### Type Scale

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| **Logo** | 18px | 700 | 1.2 | Brand logo |
| **H1** | 24px | 600 | 1.3 | Page titles |
| **H2** | 18px | 600 | 1.3 | Section headers |
| **H3** | 14px | 600 | 1.4 | Sidebar titles |
| **Body** | 14px | 400 | 1.7 | Paragraph text |
| **Body Small** | 13px | 400 | 1.5 | Secondary content |
| **Caption** | 12px | 400 | 1.4 | Metadata, labels |
| **Label** | 11px | 600 | 1.2 | Badges, tags |
| **Mono** | 12px | 500 | 1.4 | Paragraph numbers |

### Typography Patterns

```css
/* Paragraph Numbers */
.paragraph-num {
  font-family: var(--font-family-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  background: var(--color-bg-tertiary);
  padding: 2px 8px;
  border-radius: 4px;
}

/* Panel Labels */
.panel-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

/* Section Navigation */
.section-item {
  font-size: 13px;
  font-weight: 400;
  color: var(--color-text-secondary);
}

.section-item.active {
  font-weight: 500;
  color: var(--color-primary);
}
```

---

## Spacing System

### Base Unit

Base unit: **4px**

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Tight spacing |
| `--space-2` | 8px | Icon gaps, small padding |
| `--space-3` | 12px | Component internal spacing |
| `--space-4` | 16px | Standard padding |
| `--space-5` | 20px | Section padding |
| `--space-6` | 24px | Large padding |
| `--space-8` | 32px | Major section gaps |
| `--space-10` | 40px | Content area padding |

### Layout Spacing

```css
/* Header */
--header-height: 56px;
--header-padding-x: 20px;

/* Sidebar */
--sidebar-width: 280px;
--sidebar-collapsed-width: 48px;
--sidebar-padding: 12px;

/* Panels */
--panel-padding: 24px;
--panel-header-height: 48px;

/* Content */
--content-max-width: 800px;
--paragraph-gap: 20px;
```

---

## Component Library

### Buttons

#### Primary Button
```css
.btn-primary {
  padding: 8px 20px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn-primary:hover {
  background: var(--color-primary-hover);
}
```

#### Secondary Button
```css
.btn-secondary {
  padding: 6px 16px;
  border: 1px solid var(--color-border);
  background: white;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.btn-secondary:hover {
  background: var(--color-bg-secondary);
}
```

### File Input (Dashed)
```css
.file-input {
  padding: 8px 16px;
  border: 1px dashed #ccc;
  border-radius: 6px;
  font-size: 13px;
  color: #666;
  background: #fafafa;
  cursor: pointer;
  transition: all 0.15s ease;
}

.file-input:hover {
  border-color: var(--color-primary);
  background: #f0f4ff;
}
```

### Dropdown/Select
```css
.select {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: white;
  color: var(--color-text-secondary);
  cursor: pointer;
}
```

### Collapse Button
```css
.collapse-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: var(--color-bg-secondary);
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}

.collapse-btn:hover {
  background: #e8e8e8;
}
```

### Section Navigation Items
```css
.section-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 2px;
  border-left: 3px solid transparent;
  transition: background 0.15s ease;
}

.section-item:hover {
  background: var(--color-bg-secondary);
}

.section-item.active {
  background: var(--color-primary-subtle);
  color: var(--color-primary);
  font-weight: 500;
}

/* Change Indicators */
.section-item.added { border-left-color: var(--color-added); }
.section-item.removed { border-left-color: var(--color-removed); }
.section-item.changed { border-left-color: var(--color-changed); }
```

### Diff Text Highlights
```css
/* Removed Text */
.text-removed {
  background: var(--color-removed-bg);
  color: var(--color-removed-text);
  text-decoration: line-through;
  padding: 2px 0;
}

/* Added Text */
.text-added {
  background: var(--color-added-bg);
  color: var(--color-added-text);
  padding: 2px 0;
}

/* Changed/Modified Text */
.text-changed {
  background: var(--color-changed-bg);
  color: var(--color-changed-text);
  padding: 2px 0;
}
```

### Badges/Labels
```css
.panel-label {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.panel-label.base {
  background: var(--color-bg-tertiary);
  color: var(--color-text-tertiary);
}

.panel-label.compared {
  background: #dbeafe;
  color: #2563eb;
}
```

### Legend Items
```css
.legend {
  padding: 10px 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: flex;
  gap: 16px;
  font-size: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.legend-dot.added { background: var(--color-added); }
.legend-dot.removed { background: var(--color-removed); }
.legend-dot.changed { background: var(--color-changed); }
```

### Sync Indicator
```css
.sync-indicator {
  padding: 8px 16px;
  background: #1a1a1a;
  color: white;
  border-radius: 8px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sync-dot {
  width: 8px;
  height: 8px;
  background: var(--color-added);
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

## Layout Structure

### Z-Index Scale

| Layer | Z-Index | Elements |
|-------|---------|----------|
| Background | 0 | Page background |
| Content | 10 | Panels, sidebar |
| Navigation | 50 | Header |
| Floating | 100 | Legend, sync indicator |
| Overlay | 200 | Modals, tooltips |

### Layout Grid

The layout uses a **fixed three-zone structure**:

```
┌─────────────────────────────────────────────────────────────┐
│  Header (56px)                                               │
├──────────┬──────────────────────────────┬───────────────────┤
│          │                              │                   │
│ Sidebar  │     Panel 1 (Base)           │   Panel 2         │
│ (280px)  │                              │   (Compared)      │
│          │                              │                   │
│ Collapse │                              │                   │
│ → 48px   │                              │                   │
│          │                              │                   │
└──────────┴──────────────────────────────┴───────────────────┘
```

### Responsive Behavior

| Breakpoint | Behavior |
|------------|----------|
| **≥1280px** | Full layout, 280px sidebar |
| **1024-1279px** | Reduced panel padding, 240px sidebar |
| **768-1023px** | Collapsed sidebar by default, touch targets 44px |
| **<768px** | Single column, toggle between documents |

---

## Icons & Visual Elements

### Iconography

Use **line icons** at 16px, 20px, 24px sizes:
- Upload: 📄 or upload icon
- Download/Export: 📥 or download icon
- Collapse: ◀ / ▶
- Search: 🔍
- Settings: ⚙

### Logo

```css
.logo-icon {
  width: 24px;
  height: 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 6px;
}
```

---

## Shadows & Effects

### Shadow Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle elevation |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.1)` | Cards, floating elements |
| `--shadow-lg` | `0 4px 16px rgba(0,0,0,0.12)` | Modals, overlays |

### Transitions

| Element | Duration | Easing |
|---------|----------|--------|
| Button hover | 150ms | ease |
| Sidebar collapse | 300ms | ease |
| Color change | 150ms | ease |
| Scroll sync | 50ms | linear |

---

## Accessibility Guidelines

### Color Contrast

- Text on white: Minimum 4.5:1 (AA)
- Large text on white: Minimum 3:1
- Interactive elements: Minimum 3:1 against adjacent colors

### Focus States

```css
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Keyboard Navigation

- All interactive elements must be keyboard accessible
- Tab order follows visual flow (left sidebar → panel 1 → panel 2)
- Escape closes expanded/collapsed states

---

## Implementation Notes

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-primary: #667eea;
  --color-primary-hover: #5a6fd6;
  --color-added: #22c55e;
  --color-removed: #ef4444;
  --color-changed: #f59e0b;
  
  /* Spacing */
  --header-height: 56px;
  --sidebar-width: 280px;
  --panel-header-height: 48px;
  
  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 300ms ease;
}
```

### Tailwind Configuration

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#667eea',
          hover: '#5a6fd6',
          subtle: 'rgba(102, 126, 234, 0.08)',
        },
        diff: {
          added: '#22c55e',
          'added-bg': '#dcfce7',
          'added-text': '#166534',
          removed: '#ef4444',
          'removed-bg': '#fee2e2',
          'removed-text': '#991b1b',
          changed: '#f59e0b',
          'changed-bg': '#fef3c7',
          'changed-text': '#92400e',
        }
      },
      spacing: {
        'header': '56px',
        'sidebar': '280px',
        'panel-header': '48px',
      }
    }
  }
}
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-12 | Initial design system for Classic Split |

---

*This design system is a living document. Update as the product evolves.*
