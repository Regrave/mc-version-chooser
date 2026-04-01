import { faCubes } from '@fortawesome/free-solid-svg-icons';
import { Extension, ExtensionContext } from 'shared';
import AdminConfigPage from './AdminConfigPage.tsx';
import VersionChooserPage from './VersionChooserPage.tsx';

class McVersionChooser extends Extension {
  public cardConfigurationPage = AdminConfigPage;

  public initialize(ctx: ExtensionContext): void {
    ctx.extensionRegistry.routes.addServerRoute({
      name: 'Version Chooser',
      icon: faCubes,
      path: '/version-chooser',
      element: VersionChooserPage,
      permission: 'files.create',
    });
  }
}

export default new McVersionChooser();
