import packageJson from "../package.json";

/** The running ProtoFlow version, from package.json (or VITE_APP_VERSION for release builds). */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION?.trim() || packageJson.version;
