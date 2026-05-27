/**
 * Polyfill entrypoint — installs the Graph sync extension on
 * `Graph.prototype` and registers the default sync module as the active
 * runtime. Importing this module patches the global Graph class.
 */

export * from './index.js';

import { installContextSyncExtension } from '@living-web/context-sync';
import { installSyncModule } from '@living-web/sync-module';
import { defaultSyncModule } from './broadcast-module.js';

installContextSyncExtension();
installSyncModule(defaultSyncModule);
