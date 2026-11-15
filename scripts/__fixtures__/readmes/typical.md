<!-- markdownlint-disable MD033 -->
<p align="center">
  <img src="https://raw.githubusercontent.com/acme/widget/main/logo.png" alt="Widget logo" width="120">
</p>

<h1 align="center">Widget</h1>

[![npm](https://img.shields.io/npm/v/widget.svg)](https://www.npmjs.com/package/widget) [![CI](https://github.com/acme/widget/actions/workflows/ci.yml/badge.svg)](https://github.com/acme/widget/actions) | [![License: MIT][license-badge]][license-url]

**Widget** is a *tiny* state manager for [React](https://react.dev) apps,
inspired by [Zustand](https://github.com/pmndrs/zustand "Zustand on GitHub") and
[Jotai][jotai].

## Install

```bash
npm install widget
git clone https://github.com/acme/widget.git
```

## Usage

Create a store with `createStore`:

    import { createStore } from "widget";
    const store = createStore({ count: 0 });

Then read it in components. See <https://widget.dev/docs> for more.

| Feature   | Widget | Redux |
| --------- | :----: | ----: |
| Tiny      |   yes  |    no |
| Devtools  |   yes  |   yes |

> Note: Widget &amp; friends need React 18 or later.

- Works with **React Native**
- Plays well with [immer](https://github.com/immerjs/immer/tree/main/src#readme)
    - nested items stay

---

Made with ❤ by <a href="https://github.com/acme">Acme</a>. Docs: https://widget.dev/guide.

[jotai]: https://github.com/pmndrs/jotai
[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg
[license-url]: https://opensource.org/licenses/MIT
