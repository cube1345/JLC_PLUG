[简体中文](./README.md) | [English](#) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# Header Silk

An extension for JLCEDA / EasyEDA Pro PCB editor that generates silkscreen labels for pin headers from the nets attached to their pads.

## Features

- Detects the selected header component, or resolves the parent header from a selected pad.
- Extracts compact silkscreen labels from pad net names and falls back to pin numbers such as `P1`, `P2` when no net is available.
- Analyzes header orientation, row grouping, and single-row or dual-row layouts automatically.
- Provides a configuration panel for font, units, layer, font size, stroke width, placement side, rotation, offset, shell outline, and inverted text.
- Shows a preview in the panel and places the whole silkscreen set as one combined object at the current mouse position.

## Workflow

1. In PCB editor, select one header component, or any pad that belongs to that header.
2. Open the top menu `Header Silk > Generate Header Silk...`.
3. Adjust parameters in the panel and check the preview.
4. Move the mouse cursor to the target position on the PCB canvas.
5. Click `Generate at Mouse Position` to place the generated silkscreen group.

![](./images/image1.png)

![](./images/image2.png)

## Configuration Options

- Font: choose the font used to render the silkscreen text.
- Units: switch numeric input and display between `mil` and `mm`.
- Layer: follow the component side automatically, or force top or bottom silkscreen.
- Font size and stroke width: control the overall size and thickness of the text.
- Relative placement and rotation: define which side of the header the labels appear on and whether rotation is automatic or fixed.
- Offset: control the distance between the labels and the header body.
- Shell outline: add an outline around the whole generated label group.
- Invert: render the text with an inverted visual style.

## Limits

- Works only inside the PCB editor.
- Processes one header at a time; selecting multiple components will trigger a warning.
- Requires readable pad and net data from the selected component.
- Placement uses the current mouse position on the PCB canvas, so the cursor must already be over the target area before generation.

## Development

Requirements:

- Node.js `>= 20.17.0`
- JLCEDA / EasyEDA Pro extension runtime `^3.0.0`

Build locally:

```bash
npm install
npm run build
```

The build output is a `.eext` package under `build/dist/`, which can be imported into JLCEDA / EasyEDA Pro for installation and testing.

## Project Layout

- `src/index.ts`: extension entry, menu registration, and panel launch.
- `iframe/header-silk.html`: configuration panel markup.
- `iframe/js/header-silk.js`: header analysis, preview, parameter handling, and silkscreen generation logic.
- `iframe/css/header-silk.css`: panel styling.
- `build/packaged.ts`: packaging script that produces the `.eext` file.
- `locales/`: translation resources for extension metadata and prompts.

## Reference

- JLCEDA Pro API guide: https://prodocs.lceda.cn/cn/api/guide/

## License

Released under Apache-2.0. See [LICENSE](./LICENSE).
