import { defineComponent } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';
import template from '../templates/property-field.html?raw';

export const PropertyField = defineComponent({
    name: 'PropertyField',
    props: {
        label: {
            type: String,
            required: true,
        },
    },
});

TemplateRegistry.attach(PropertyField, template);
