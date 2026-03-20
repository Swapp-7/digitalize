# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**digitalize** is a client-side image processing web application built with vanilla JS, HTML, and CSS. No build tools, no frameworks, no dependencies — everything runs directly in the browser.

## Visual Design System

The UI follows a strict **New Wave / Retro-80s terminal aesthetic**:

- **Background**: Near-black (`#0a0a0a` or similar)
- **Font**: Monospace — `Fira Code`, `Courier New`, or `monospace` fallback
- **Accent colors**: Phosphor green (`#00ff41`), cyan (`#00ffff`), or magenta (`#ff00ff`) for borders, buttons, and highlights
- **Style language**: CRT scanlines, glowing borders (`box-shadow` with accent color), uppercase labels, blinking cursors

## Layout Architecture

Two-panel layout:
- **Left/Center**: Large `<canvas>` area for image display and processing
- **Right**: Sidebar panel for controls (filters, adjustments, export)

## Core Architecture

All logic lives in plain `.js` files loaded via `<script>` tags (no modules unless explicitly introduced). The canvas element is the single source of truth for the current image state.

**Image input methods:**
1. Drag & drop onto the canvas zone
2. Click-to-upload `<input type="file">` (hidden, triggered by a styled button)

**Image processing pipeline** (to be built):
- Load image onto an offscreen canvas or directly onto the main canvas using `drawImage()`
- Apply filters by reading pixel data with `getImageData()`, manipulating the `data` array, and writing back with `putImageData()`
- Each filter is a pure function: `(imageData) => imageData`

## File Conventions

- `index.html` — entry point, all markup
- `style.css` — all styles, single file
- `main.js` — app init, event wiring
- `filters.js` — pure filter functions operating on `ImageData`
- `ui.js` — DOM helpers, sidebar rendering (if complexity warrants splitting)
