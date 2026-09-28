import { createApp } from 'vue';

import { EditorWorkspace } from './components/editor-workspace.js';
import editorWorkspaceTemplate from './templates/editor-workspace.html?raw';
import { TemplateRegistry } from './core/template-registry.js';

TemplateRegistry.attach(EditorWorkspace, editorWorkspaceTemplate);
createApp(EditorWorkspace).mount('#app');
