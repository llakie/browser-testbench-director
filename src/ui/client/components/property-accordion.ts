import { defineComponent } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';
import template from '../templates/property-accordion.html?raw';

export const PropertyAccordion = defineComponent({
    name: 'PropertyAccordion',
    props: {
        title: { type: String, required: true },
        preview: { type: String, default: '' },
        group: { type: String, default: '' },
        open: { type: Boolean, default: false },
        testId: { type: String, default: '' },
        summaryTestId: { type: String, default: '' },
    },
});

TemplateRegistry.attach(PropertyAccordion, template);
