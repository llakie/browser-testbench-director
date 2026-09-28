# Director-Projektformat

Director-Projekte werden als UTF-8-kodierte JSON-Dateien mit der Endung `.btd.json` gespeichert. `format` und `version` bilden die stabile Formatkennung. Version 7 enthält `input`- und `capability`-Nodes, genau eine `website`-Root-Node, ausführbare `layer`-, `javascript`-, `browser-action`- und `browser-wait`-Nodes sowie explizite Verbindungen. Version 5 und 6 werden beim Öffnen einmalig auf Version 7 migriert; ältere Versionen werden nicht unterstützt.

```json
{
    "format": "browser-testbench-director",
    "version": 7,
    "name": "Guess the Price",
    "viewport": {
        "width": 360,
        "height": 640
    },
    "output": {
        "width": 1080,
        "height": 1920
    },
    "browserSession": {
        "target": {
            "browser": null,
            "deviceKind": null
        },
        "localOrigins": null,
        "permissions": [],
        "language": "",
        "locale": ""
    },
    "nodes": [
        {
            "id": "camera-image",
            "type": "input",
            "name": "Kartenfoto",
            "position": null,
            "accept": "image/jpeg,image/png,image/webp",
            "required": true,
            "prepare": {
                "modules": [
                    "projects/guess-the-price/prepare/orient-camera.mjs",
                    "projects/guess-the-price/prepare/camera.mjs"
                ]
            }
        },
        {
            "id": "story-font",
            "type": "input",
            "name": "Story-Schrift",
            "position": null,
            "accept": ".ttf,font/ttf",
            "required": true
        },
        {
            "id": "camera-capability",
            "type": "capability",
            "name": "Virtuelle Kamera",
            "position": null,
            "capability": "camera"
        },
        {
            "id": "website-root",
            "type": "website",
            "name": "Website",
            "position": null,
            "url": "https://www.binderium.com/"
        },
        {
            "id": "prepare-website",
            "type": "javascript",
            "name": "Prepare website",
            "position": null,
            "source": "const card = await director.waitFor('#card');\ncard.dataset.ready = 'true';"
        },
        {
            "id": "wait-for-camera-choice",
            "type": "browser-wait",
            "name": "Auf Kameraauswahl warten",
            "position": null,
            "condition": "element",
            "selector": "[data-testid=\"select-camera-source\"]",
            "value": "/price-check/value",
            "script": "return true;",
            "timeoutMs": 30000,
            "omitFromRecording": true
        },
        {
            "id": "open-camera",
            "type": "browser-action",
            "name": "Kamera öffnen",
            "position": null,
            "action": "click",
            "selector": "[data-testid=\"select-camera-source\"]"
        },
        {
            "id": "layer-guess-price",
            "type": "layer",
            "name": "Guess the Price",
            "position": null,
            "placement": {
                "reference": {
                    "type": "viewport"
                },
                "horizontal": "center",
                "vertical": "center"
            },
            "playback": {
                "durationMs": 0,
                "removeAfter": false
            },
            "source": {
                "html": "<section id=\"guess-price-layer\"></section>",
                "css": "#guess-price-layer { width: min(90vw, 32rem); }",
                "javascript": "await director.wait(500);\ndocument.querySelector('#guess-price-layer').textContent = 'Play';"
            }
        }
    ],
    "connections": [
        {
            "id": "camera-image--camera-capability",
            "source": "camera-image",
            "target": "camera-capability"
        },
        {
            "id": "camera-capability--website-root",
            "source": "camera-capability",
            "target": "website-root"
        },
        {
            "id": "story-font--website-root",
            "source": "story-font",
            "target": "website-root"
        },
        {
            "id": "website-root--prepare-website",
            "source": "website-root",
            "target": "prepare-website"
        },
        {
            "id": "prepare-website--wait-for-camera-choice",
            "source": "prepare-website",
            "target": "wait-for-camera-choice"
        },
        {
            "id": "wait-for-camera-choice--open-camera",
            "source": "wait-for-camera-choice",
            "target": "open-camera"
        },
        {
            "id": "open-camera--layer-guess-price",
            "source": "open-camera",
            "target": "layer-guess-price"
        }
    ]
}
```

Jede Node- und Verbindungs-ID muss innerhalb eines Projekts eindeutig sein. Eine Verbindung verweist mit `source` und `target` auf vorhandene Nodes. Der ausführbare Workflow ab der Website-Root bleibt linear. Beliebig viele Input-Nodes dürfen direkt in die Website-Root oder in eine Capability führen. Eine verbundene Capability besitzt genau einen Input und führt anschließend in die Website-Root. Die Reihenfolge im `nodes`-Array beeinflusst die Ausführung nicht.

`viewport` beschreibt ausschließlich den Layout-Viewport in CSS-Pixeln. Responsive Breakpoints, `vw`, `vh` und DOM-Messungen verwenden diese Größe. `output` beschreibt davon unabhängig die Pixelmaße des exportierten Videos. Beispielsweise bildet `360 × 640` CSS-Pixel mit einer Ausgabe von `1080 × 1920` ein 9:16-Smartphone bei effektiv dreifacher Pixeldichte ab. Die Vorschau wird mit `viewport` gerendert; die Aufnahme wird beim Export auf `output` normalisiert.

`input`-Nodes beschreiben beliebig viele generische Laufzeit-Dateien, ohne deren lokale Inhalte in die Projektdatei einzubetten. Eine Auswahl wird content-addressiert unter `projects/.director-assets/` gespeichert; `file` enthält im JSON lediglich Asset-Pfad, Dateiname, MIME-Typ, Größe und SHA-256. Beim erneuten Öffnen stellt der Director die geprüfte Datei automatisch wieder her. Der Dateiselektor und die aktuelle Auswahl sind direkt in der Diagramm-Node sichtbar; MIME-Typen, Pflichtfeld und Prepare-Module liegen in den Node-Eigenschaften. Verbundene Input-Nodes werden vor der Website validiert und vorbereitet. `required: true` verhindert die Ausführung, solange keine Datei gewählt wurde. Optional enthält `prepare.modules` eine geordnete Pipeline aus `.mjs`-Modulen unter `projects/`. Jedes Modul exportiert `async prepare({ sourcePath, targetPath })`, schreibt die vorbereitete Datei nach `targetPath` und gibt `{ filename, contentType }` zurück; seine Ausgabe wird zur Eingabe des nächsten Moduls. Der Director selbst kennt keine projektspezifischen Transformationen.

Eine `capability`-Node beschreibt, wie die Browserumgebung einen verbundenen Input bereitstellt. Die zunächst unterstützte Capability `camera` verbindet einen Bild-Input als virtuelle Kamera mit der Website. Daraus leitet der Director Kameraberechtigung, Medieninjektion und Target-Kompatibilität automatisch ab. Auf mobilen Targets kann Browser Testbench das Bild nativ injizieren; Desktop-Browser verwenden dafür die reloadfeste Director-Shell. Aufnahmeziele müssen zusätzlich Viewport-Recording unterstützen. Die Datei selbst bleibt Eigentum der vorgeschalteten Input-Node.

`browserSession.target` filtert die Target-Auswahl optional nach Browser und Device-Art. `localOrigins`, zusätzliche `permissions`, `language` und `locale` werden in die Browser-Testbench-Session übernommen. Anforderungen aus Capability-Nodes müssen dort nicht doppelt konfiguriert werden.

Im Szenengraph wird eine Verbindung vom orangefarbenen Ausgang einer Node zum grauen Eingang der nächsten Node gezogen. Ein Klick auf den Mittelpunkt einer Verbindung wählt sie aus; anschließend kann sie mit dem Papierkorb im Graph-Header oder mit `Entf`/`Backspace` gelöscht werden. Nodes, die von der Website-Root aus nicht erreichbar sind, werden gestrichelt dargestellt und bei der Workflow-Wiedergabe übersprungen.

`position: null` bedeutet, dass ELK die Node automatisch anordnet. Neue und duplizierte Nodes beginnen in diesem Zustand. Erst wenn eine Node tatsächlich verschoben wird, speichert der Director ihre feste `{ "x": …, "y": … }`-Position. Manuell platzierte Nodes bleiben bei späteren automatischen Neuberechnungen unangetastet. Der Auto-Layout-Button setzt alle Positionen wieder auf `null`. ELK Layered verteilt lange Workflows mit Graph-Wrapping kompakt auf mehrere Zeilen; JointJS routet Verbindungen orthogonal und weicht anderen Nodes aus. Die Workflow-Reihenfolge bleibt unverändert.

Die `url` der Website-Root wird hinter den Layern geladen. Eine `javascript`-Node läuft im Dokument dieser Website; Layer-JavaScript läuft dagegen im Overlay-Dokument. `browser-wait` wartet mit einem positiven `timeoutMs` auf die konfigurierte Bedingung `element`, `url` oder `script`. Ein Script-Wait wird wiederholt, bis er einen wahrheitswertigen Rückgabewert liefert. `browser-action` führt anschließend die konfigurierte Interaktion aus; derzeit wird `click` unterstützt. Beide Node-Typen verwenden in der Remote-Vorschau die nativen Browser-Testbench-Endpunkte.

`placement` richtet den Layer-Inhalt innerhalb einer Bezugsfläche aus. `horizontal` akzeptiert `left`, `center` oder `right`, `vertical` akzeptiert `top`, `center` oder `bottom`. Zusammen ergeben beide Angaben das 3×3-Ausrichtungsraster. `reference` wählt die Bezugsfläche:

- `{ "type": "viewport" }` verwendet den gesamten Viewport.
- `{ "type": "layer", "nodeId": "…" }` verwendet den Content-Container einer vorherigen Layer-Node. Solange dieser sichtbar ist, folgt die Geometrie live; nach dem Entfernen wird das letzte gültige Rechteck des aktuellen Laufs verwendet.
- `{ "type": "dom", "selector": "…" }` verwendet das erste passende Element im Website-DOM. Der Editor kann den Selector über Browser Testbench auswählen.

Die Runtime positioniert dafür einen eigenen Anchor-Container. Sie verändert `transform` des eigentlichen Layer-Contents nicht, sodass es vollständig für Layer-Animationen verfügbar bleibt. Ein nicht messbares Ziel erzeugt einen Ausführungsfehler. Gemessene Rechtecke gehören nur zum aktuellen Lauf und werden nicht im Projekt gespeichert.

Die Abmessungen des Inhalts bleiben Sache des Layer-CSS. HTML, CSS und JavaScript werden unverändert als Strings erhalten und für die Vorschau in einem isolierten `iframe` zusammengesetzt. Unbekannte Formate, Versionen, Positionierungen oder unvollständige Layer-Quellen werden beim Laden abgelehnt.

`playback.durationMs` hält einen Layer nach seinem JavaScript für die angegebene Dauer sichtbar. Bei `removeAfter: true` entfernt die Runtime anschließend sowohl Overlay als auch zugehörigen Style. Im Catch-up wird die Haltedauer übersprungen, Mount, JavaScript, Rückgabewert und Cleanup werden aber weiterhin ausgeführt. Mit `durationMs: 0` und `removeAfter: false` bleibt ein Layer wie bisher bestehen.

## Wiedergabe und Runtime

- **Node abspielen** lädt die Website neu, führt alle Vorgänger mit `director.speed === "catchup"` aus, spielt nur die gewählte Node live und hält anschließend an. Die Auswahl einer Node allein verändert den Browserzustand nicht.
- **Auf aktuellem Zustand ausführen** führt als sekundäre Entwickleraktion nur die gewählte Node ohne Reset aus.
- **Workflow abspielen** lädt die Website neu und führt alle Nodes live aus.
- **Workflow aufnehmen** öffnet eine frische Browser-Testbench-Session, zeichnet den Viewport während der vollständigen Workflow-Wiedergabe auf und exportiert ein auf `output.width` × `output.height` normalisiertes MP4.

Die Runtime stellt Layer- und JavaScript-Nodes `director.wait(milliseconds)`, `director.waitFor(selector, timeout?)`, `director.results` und `director.inputs` bereit. `director.inputs` ist eine unveränderliche Zuordnung der gewählten Nicht-Kamera-Dateien zu Data-URLs. `director.wait` wartet bei Live-Wiedergabe real und kehrt im Catch-up sofort zurück. `waitFor` und eigenständige `browser-wait`-Nodes bleiben auch im Catch-up echte Zustandsbedingungen. Bei `omitFromRecording: true` läuft eine `browser-wait`-Node real ab, ihr Zeitabschnitt wird aber nicht in den Videoexport übernommen. Mit `false` bleibt die Wartezeit Teil des Exports. Eigenständig verwendete globale Timer werden bewusst nicht manipuliert. Dadurch bleibt beliebiges JavaScript verständlich; nur explizit über die Runtime beschriebene Zeit kann sicher beschleunigt werden.

Jede ausführbare Node darf einen JSON-kompatiblen Wert zurückgeben. Die Runtime speichert ihn unter ihrer Node-ID. Nachfolgende Layer- und JavaScript-Nodes greifen beispielsweise mit `director.results['recognized-card'].cardName` darauf zu. Ein Gesamtworkflow und die primäre Node-Wiedergabe beginnen mit einem leeren Ergebniskontext; Vorgänger bauen ihn beim Catch-up erneut auf. Nur die sekundäre Entwickleraktion läuft mit den Ergebnissen des aktuellen Seitenzustands. Beim Navigieren oder Neuladen der Website wird der Kontext verworfen.

`director.root` verweist in einer Layer-Node auf deren Inhaltswurzel, in einer JavaScript-Node ist es `null`. `director.document` verweist auf das jeweils gesteuerte Dokument. Websites wie Binderium, die eine Einbettung mit `frame-ancestors 'none'` beziehungsweise `X-Frame-Options: DENY` verhindern, können in der lokalen iframe-Vorschau nicht als Hintergrund erscheinen. Die Browser-Testbench-Vorschau öffnet solche Websites stattdessen als Hauptdokument und injiziert Layer und JavaScript über WebDriver direkt in die Seite.
