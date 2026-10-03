import template from '../templates/mobile-project-menu.html?raw';
import { defineWorkspaceSection } from './workspace-section.js';

export const MobileProjectMenu = defineWorkspaceSection({
    name: 'MobileProjectMenu',
    template,
    bindings: [
        'browserTestbenchLifecycleLabel',
        'browserTestbenchRunning',
        'browserTestbenchTransitioning',
        'browserTestbenchUrl',
        'closeMobileMenu',
        'executionRunning',
        'mobileMenuOpen',
        'newProject',
        'openMcpSetup',
        'openProjectSettings',
        'openProject',
        'saveProject',
        'savingProject',
        't',
        'toggleBrowserTestbench',
        'toggleMobileMenu',
    ],
});
