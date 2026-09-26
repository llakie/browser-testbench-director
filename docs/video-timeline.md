# Video Timeline

`src` enthält den wiederverwendbaren Timeline-Core für Browser-Testbench-Videos. Eine Production beschreibt einen unveränderlichen Graph aus lazy aktivierten Timelines. Jede Timeline besitzt einen Trigger, einen Layer und eine lokale deterministische Zeitachse.

Der Core ist in TypeScript implementiert und stellt bereit:

- Graphvalidierung mit Zyklus- und Layer-Konfliktprüfung;
- `sequence`, `parallel`, `repeat`, `delay`, `hold`, `mark` und Actions;
- Browser-Waits als Trigger und Browser-Actions im Ablauf;
- automatische Trennung von Runtime und sichtbarer Medienzeit;
- Event-Log und Schnittintervalle für FFmpeg;
- isolierte DOM-Overlays mit Viewport-, Element- und Overlay-Anchors;
- Audio-Clip-Nodes mit Zuordnung zur finalen Medienzeit;
- FFmpeg-Mix für mehrere zeitversetzte Audio-Clips.
- explizite Viewport-Aufnahmen und zeitgenaue Marks über Browser Testbench 0.5;
- zentrale `VideoUtilities` für FFmpeg und einen vollständigen Timeline-Videoexport;
- Production-Compiler für TypeScript sowie `.scss`-, `.css`- und `.html`-Imports als Strings.
- automatische Einbettung lokaler Fonts aus CSS/SCSS und chunkweiser Transfer großer DOM-Assets.
- typisierte, auslagerbare Browser-Scripts für `evaluate` und `waitForScript`.

```ts
import {
    browser,
    defineProduction,
    graph,
    hold,
    overlay,
    sequence,
    timeline,
    TimelineRunner,
    wait,
} from './index.js';

const production = defineProduction({ id: 'demo' });
const flow = graph(
    timeline({
        id: 'intro',
        layer: 'story',
        trigger: wait.element('[data-testid="ready"]'),
        run: overlay.text({
            id: 'title',
            layer: 'story',
            text: 'Los geht es!',
            duration: 1500,
            anchor: { selector: '[data-testid="subject"]', point: 'top' },
        }),
    }),
    timeline({
        id: 'continue',
        layer: 'control',
        after: ['intro'],
        run: sequence(browser.click('[data-testid="continue"]'), hold(500)),
    }),
);

const result = await new TimelineRunner({ production, graph: flow, session }).run({ overlays });
```

`TimelineRecording` startet nach dem Seiten-Setup eine explizite Browser-Testbench-Aufnahme mit `scope: 'viewport'`, setzt native Start- und Endmarks und stoppt die Aufnahme vor dem Session-Cleanup. `RecordingTimeMapper` bildet die Timeline-Millisekunden direkt aus den von Browser Testbench gelieferten Aufnahmezeiten auf Video-Sekunden ab.

`VideoUtilities` kapselt den verbleibenden FFmpeg-Prozess. `TimelineVideoRenderer` übernimmt Schnittintervalle, Zielformat, Padding, Encoding, Audio-Mix, temporäre Dateien und die Prüfung des Ergebnisses. Die Viewport-Aufnahme benötigt keine nachträgliche Pixelkalibrierung und keinen Crop.

Styles und Templates bleiben als eigene Quelldateien neben einer Production:

```ts
import template from './overlay.html';
import plainStyles from './base.css';
import themeStyles from './theme.scss';
```

`ProductionCompiler` bündelt die TypeScript-Production vor der Ausführung. CSS und HTML werden unverändert als Strings exportiert; SCSS wird zuerst mit Sass kompiliert. Das temporäre ESM-Bundle liegt neben der Production, damit `import.meta.url` weiterhin auf deren Asset-Verzeichnis zeigt, und wird nach dem Lauf über `CompiledProduction.dispose()` entfernt.

Fonts werden normal relativ oder über einen Paketpfad referenziert. Der Compiler löst `.otf`, `.ttf`, `.woff` und `.woff2` auf und bettet sie als Data-URL in das gebaute Stylesheet ein:

```scss
@font-face {
    font-family: 'Story Display';
    src: url('./fonts/story-display.woff2') format('woff2');
}
```

`DomAssetInstaller` installiert die importierten Styles und Templates im Browser. Große Inhalte überträgt er automatisch in begrenzten Chunks; Productions benötigen dafür keine Base64-, Window- oder Transferlogik.

Browserlogik liegt in separaten `*.browser.ts`-Modulen. `BrowserScript.define` hält Ein- und Rückgabe typisiert und erzeugt die von Browser Testbench benötigte Script-Quelle. `BrowserScriptRunner` führt sie aus:

```ts
// scripts/read-title.browser.ts
import { BrowserScript } from '../src/index.js';

export const readTitle = BrowserScript.define<{ selector: string }, string>(
    'demo.read-title',
    ({ selector }) => document.querySelector(selector)?.textContent?.trim() ?? '',
);

const title = await new BrowserScriptRunner(session).run(readTitle, {
    selector: '[data-testid="title"]',
});
await session.waitForScript(isReady.source, [], timeout);
```

Eine Browserfunktion ist selbstständig und erhält alle variablen Werte über ihren Input. Sie greift nicht auf Closures oder Node-APIs zu. Allgemeine Browser-Scripts liegen beim Framework-Feature, projektspezifische DOM-Logik bleibt im `scripts`-Verzeichnis der Production.

## Entwicklung

Der öffentliche Vertrag wird strikt typgeprüft. Die Tests laufen direkt aus den TypeScript-Quellen über `tsx`:

```bash
npm run typecheck:timeline
npm run test:timeline
```
