import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';

type Dictionary = Record<string, string>;
type Parameters = Readonly<Record<string, string | number>>;

const dictionaries: Record<'de' | 'en', Dictionary> = { de, en };

export class Translator {
    static readonly locale: 'de' | 'en' = navigator.language.toLowerCase().startsWith('de')
        ? 'de'
        : 'en';

    static text(key: string, parameters: Parameters = {}): string {
        const template = dictionaries[this.locale][key] ?? dictionaries.en[key] ?? `[${key}]`;
        return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_match, name: string) =>
            String(parameters[name] ?? `{${name}}`),
        );
    }
}
