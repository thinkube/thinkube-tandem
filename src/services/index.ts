/**
 * Services barrel export
 */

export { ClaudeConfigService } from "./ClaudeConfigService";
export { PluginService } from "./PluginService";
export type {
  PluginInfo,
  Marketplace,
  InstalledPlugin,
  PluginCreationOptions,
  PluginTemplate,
} from "./PluginService";
export {
  getTemplates,
  getTemplate,
  generateTemplateFiles,
} from "./PluginTemplates";
export type {
  PluginTemplate as TemplateDefinition,
  TemplateFile,
} from "./PluginTemplates";
