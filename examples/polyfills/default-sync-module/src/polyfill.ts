/**
 * Polyfill entrypoint — installs the Context sync extension on
 * `Context.prototype` and registers the default sync module as the active
 * runtime. Importing this module patches the global Context class.
 */

export * from './index.js';

import { installContextSyncExtension } from '@living-web/context-sync';
import { installSyncModule } from '@living-web/sync-module';
import { defaultSyncModule } from './broadcast-module.js';

installContextSyncExtension();
installSyncModule(defaultSyncModule);
