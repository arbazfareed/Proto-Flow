# Plugins, permissions, and the SDK

Open **Manage Plugins** to install or enable a plugin package. Review its manifest and requested permissions before granting access. ProtoFlow runs plugins in an isolated iframe; they cannot access wallet credentials, JWTs, native APIs, or network connections. Only explicitly granted project data is sent to an extension.

Permissions are limited to declared capabilities such as reading project data or registering commands. Disable or uninstall a plugin you no longer trust. Plugin files and manifests should come from sources you trust.

Developers can use the local `plugin-sdk` package and its README for extension types and examples. Test a plugin with minimal permissions and a non-sensitive project.
